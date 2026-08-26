/* ------------------------------------------------------------------ */
/*  Axion chat-room coordinator (module-level logical state per room)  */
/*                                                                     */
/*  Axion owns the app's only authenticated WebSocket. This module     */
/*  keeps local message snapshots, durable outboxes, delivery state,   */
/*  and React subscriptions for each logical room.                     */
/* ------------------------------------------------------------------ */

import { saveMessage, getPendingOutbox, getPendingUnsyncedOutgoingMessages, getRoomsWithPendingOutgoingMessages, getMessagesByIdsForResend, MessageChanges, OutboxEntry, queueMessageUpdate, getPendingOutboxUpdates, ackOutboxUpdates, applyMessageChanges, setMessageSyncState, getMediaPointer, setMediaPointer, setOutboxExpectedPeers, setMessageTransferFailure, clearMessageTransferFailure, getMessageTransferFailure } from './localMessageStore';
import { uploadMedia, toMediaTransferFailure, type MediaType } from './mediaLane';
import type { MediaTransferFailure } from './mediaTransferPolicy';
import { useAppStore } from '../store/appStore';
import { ensureWsAlive, isNotifWsReady, reconnectWsNow, sendRawNotif, subscribeStatus } from './notificationWsManager';
import { applyMessageLifecycleEvent, mergeMessageById } from './messageLifecycle';
// An Axion acknowledgement can arrive before the sender's asynchronous local
// SQLite insert finishes. Keep the acceptance briefly so the insert cannot turn
// an already-accepted message back into a permanently retrying pending row.
const _earlyServerAcceptedMessageIds = new Set<string>();
const _serverAckTimers = new Map<string, ReturnType<typeof setTimeout>>();

function watchForServerAck(messageId: string): void {
  if (!messageId || _serverAckTimers.has(messageId)) return;
  _serverAckTimers.set(messageId, setTimeout(() => {
    _serverAckTimers.delete(messageId);
    console.warn('[Axion] server ACK timed out — reconnecting to retry', messageId);
    // The message is already durable in SQLite. Re-authentication runs the
    // normal pending-outbox flush, so no in-memory-only data is lost here.
    reconnectWsNow();
  }, 6_000));
}

function clearServerAckWatch(messageId: string): void {
  const timer = _serverAckTimers.get(messageId);
  if (timer) clearTimeout(timer);
  _serverAckTimers.delete(messageId);
}
/* ---- Timing constants ---- */
// A content update may legitimately wait for an offline group member.  Keep
// that durable outbox reliable without waking the radio every eight seconds
// until the member next opens Axonic (the timestamp reconciliation will also
// converge it then).
const INITIAL_UPDATE_RETRY_MS = 15_000;
const MAX_UPDATE_RETRY_MS = 5 * 60_000;

/* ---- Public types ---- */
export interface WsMessage {
  id: string;
  sender: string;
  sender_id: number;
  content: string;
  message_type: string;
  created_at: string;
  updated_at?: string;
  revision?: number;
  is_read?: boolean;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
  reply_to?: import('./localMessageStore').ReplyRef | null;
  /** Local file URI for media messages (voice / image / file). */
  file_uri?: string | null;
  /** Duration in milliseconds for voice / video messages. */
  duration_ms?: number | null;
  /** Sender-side: true while this message's media is still being uploaded
   *  (large media streamed as chunks). Cleared when the stream finishes. */
  uploading?: boolean;
  transfer_error_code?: string | null;
  transfer_error_message?: string | null;
}

/** Optional extra payload accepted by sendChatMessage for media messages. */
export interface SendExtras {
  /** Local file URI of the media (persisted). */
  file_uri?: string | null;
  /** Duration in milliseconds for voice / video (persisted). */
  duration_ms?: number | null;
  /** Audio MIME type — used by the receiver to pick a file extension. */
  audio_mime?: string | null;
  /** Image MIME type — used by the receiver to pick a file extension. */
  image_mime?: string | null;
  /** MIME type for video/document blobs. */
  media_mime?: string | null;
}

export type RoomStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface RoomSnapshot {
  messages: WsMessage[];
  readIds: Set<string>;
  pendingIds: Set<string>;
  deliveredIds: Set<string>;
  status: RoomStatus;
  reconnectCount: number;
  lastMutationAt: number;
  /** IDs affected by the latest SQLite-backed mutation batch. */
  lastMutationIds: string[];
}

type RoomListener = (snapshot: RoomSnapshot) => void;

/* ---- Internal room state ---- */
interface RoomState {
  authenticated: boolean;
  status: RoomStatus;
  messages: WsMessage[];
  readIds: Set<string>;
  pendingIds: Set<string>;
  deliveredIds: Set<string>;
  /** In-memory queue of updates not yet sent (also persisted to SQLite outbox). */
  pendingUpdates: Array<{ id: string; message_id: string; changes: MessageChanges }>;
  /** Update ids already handed to Axion; prevents a local event storm from
   * sending the exact same durable batch repeatedly before its ACK arrives. */
  inFlightUpdateIds: Set<string>;
  updateRetryTimer: ReturnType<typeof setTimeout> | null;
  /** Backoff for a durable update that still awaits an offline peer's ACK. */
  updateRetryDelay: number;
  reconnectCount: number;
  hasConnectedBefore: boolean;
  pendingFlushes: number[];
  /** Queued media-hydration resends (specific ids) for a recipient, awaiting WS open. */
  pendingResends: Array<{ recipientId: number; ids: string[] }>;
  /** User-requested retries. These preserve the original message id for dedupe. */
  pendingManualRetryIds: string[];
  lastMutationAt: number;
  lastMutationIds: string[];
  listeners: Set<RoomListener>;
  /** Pending teardown timer scheduled by subscribeRoom when listeners reach 0. */
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

/* ---- Module-level state (survives React unmounts) ---- */
const rooms = new Map<string, RoomState>();

// Axion is the single authenticated realtime transport for the app. Room state
// remains local because it owns the durable outbox, message snapshots and UI
// subscriptions; it no longer owns a physical WebSocket per room.
let _axionStatusUnsub: (() => void) | null = null;

function isAxionReady(): boolean {
  return isNotifWsReady();
}

export interface SendChatResult {
  messageId: string | null;
  state: 'sent' | 'queued' | 'failed';
  error?: MediaTransferFailure;
}

interface SendAttemptResult {
  sent: boolean;
  error?: MediaTransferFailure;
}

function flushAxionRoom(roomId: string, s: RoomState): void {
  const isReconnect = s.hasConnectedBefore && !s.authenticated;
  s.authenticated = true;
  if (isReconnect) s.reconnectCount += 1;
  s.hasConnectedBefore = true;
  // The chat UI reads both the logical room status and this authentication
  // flag.  Axion authenticates once for the whole app, so promote every open
  // logical room when that shared socket is ready as well.
  try { useAppStore.getState().setChatRoomAuthenticated(roomId, true); } catch {}
  setStatus(roomId, s, 'connected');
  _syncRoomPendingNow(roomId, s);
  sendRawNotif({ type: 'room_ready', room_id: roomId });
  if (s.pendingFlushes.length > 0) {
    const recipients = [...s.pendingFlushes];
    s.pendingFlushes = [];
    recipients.forEach((recipientId) => { void _doFlush(roomId, s, recipientId); });
  }
  if (s.pendingResends.length > 0) {
    const queued = [...s.pendingResends];
    s.pendingResends = [];
    queued.forEach(({ recipientId, ids }) => { void resendMessagesByIds(roomId, recipientId, ids); });
  }
  if (s.pendingManualRetryIds.length > 0) {
    const ids = [...s.pendingManualRetryIds];
    s.pendingManualRetryIds = [];
    ids.forEach((id) => { void retryOutgoingMessage(roomId, id); });
  }
}

function ensureAxionStatusListener(): void {
  if (_axionStatusUnsub) return;
  _axionStatusUnsub = subscribeStatus((status) => {
    rooms.forEach((s, roomId) => {
      if (status === 'connected' && isAxionReady()) {
        flushAxionRoom(roomId, s);
      } else if (status === 'connecting' || status === 'reconnecting') {
        s.authenticated = false;
        try { useAppStore.getState().setChatRoomAuthenticated(roomId, false); } catch {}
        setStatus(roomId, s, s.hasConnectedBefore ? 'reconnecting' : 'connecting');
      } else {
        s.authenticated = false;
        try { useAppStore.getState().setChatRoomAuthenticated(roomId, false); } catch {}
        setStatus(roomId, s, 'disconnected');
      }
    });
  });
}

let _myUserId: number | null = null;
let _myUsername = 'me';

/** Call this once after login so sendChatMessage can stamp messages correctly. */
export function setCurrentUserId(userId: number, username: string): void {
  _myUserId = userId;
  _myUsername = username;
}

/** Safe UUID v4 — works on all Hermes/Android versions without a polyfill */
function generateUUID(): string {
  try {
    // Available in Hermes ≥ 0.14 / RN ≥ 0.71
    return crypto.randomUUID();
  } catch {
    // Fallback for environments where crypto.randomUUID is unavailable
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/* ================================================================== */
/*  Internal helpers                                                   */
/* ================================================================== */

function createRoomState(): RoomState {
  return {
    authenticated: false,
    status: 'disconnected',
    messages: [],
    readIds: new Set(),
    pendingIds: new Set(),
    deliveredIds: new Set(),
    pendingUpdates: [],
    inFlightUpdateIds: new Set(),
    updateRetryTimer: null,
    updateRetryDelay: INITIAL_UPDATE_RETRY_MS,
    reconnectCount: 0,
    hasConnectedBefore: false,
    pendingFlushes: [],
    pendingResends: [],
    pendingManualRetryIds: [],
    lastMutationAt: 0,
    lastMutationIds: [],
    listeners: new Set(),
    disconnectTimer: null,
  };
}

function getOrCreate(roomId: string): RoomState {
  let s = rooms.get(roomId);
  if (!s) { s = createRoomState(); rooms.set(roomId, s); }
  return s;
}

function notifyListeners(roomId: string, state: RoomState) {
  if (state.listeners.size === 0) return;
  const snapshot: RoomSnapshot = {
    messages: state.messages,
    readIds: state.readIds,
    pendingIds: state.pendingIds,
    deliveredIds: state.deliveredIds,
    status: state.status,
    reconnectCount: state.reconnectCount,
    lastMutationAt: state.lastMutationAt,
    lastMutationIds: state.lastMutationIds,
  };
  state.listeners.forEach((fn) => { try { fn(snapshot); } catch { /* ignore */ } });
}

function setStatus(roomId: string, state: RoomState, status: RoomStatus) {
  state.status = status;
  try { useAppStore.getState().setChatRoomStatus(roomId, status); } catch {}
  notifyListeners(roomId, state);
}

function clearRoomRetryState(state: RoomState): void {
  if (state.updateRetryTimer) {
    clearTimeout(state.updateRetryTimer);
    state.updateRetryTimer = null;
  }
  state.inFlightUpdateIds.clear();
}

/** Send in-memory pending updates now (if connected). ACK deletes outbox rows. */
function _flushPendingUpdates(roomId: string, s: RoomState): void {
  if (s.pendingUpdates.length === 0) return;
  if (!isAxionReady()) return;
  const batch = s.pendingUpdates.filter((update) => !s.inFlightUpdateIds.has(update.id));
  if (!batch.length) return;
  try {
    const sent = sendRawNotif({
      type: 'message_update',
      room_id: roomId,
      updates: batch.map((u) => ({ id: u.id, message_id: u.message_id, changes: u.changes })),
    });
    if (!sent) return;
    batch.forEach((update) => s.inFlightUpdateIds.add(update.id));
    // A missing server/peer ACK must be retried eventually, but never in a
    // tight loop caused by unrelated inbound events or a stale deployment.
    if (!s.updateRetryTimer) {
      const retryAfterMs = s.updateRetryDelay;
      s.updateRetryTimer = setTimeout(() => {
        s.updateRetryTimer = null;
        s.updateRetryDelay = Math.min(s.updateRetryDelay * 2, MAX_UPDATE_RETRY_MS);
        s.inFlightUpdateIds.clear();
        _flushSQLiteOutbox(roomId, s).catch(() => {});
      }, retryAfterMs);
    }
    console.log('[ChatWsManager] sent', batch.length, 'pending updates for room', roomId);
  } catch {
    // Keep queued entries; they will be retried on next reconnect/flush.
  }
}

/** Load SQLite outbox entries persisted from previous sessions and send them. */
async function _flushSQLiteOutbox(roomId: string, s: RoomState): Promise<void> {
  try {
    const entries = await getPendingOutboxUpdates(roomId);
    const persistedIds = new Set(entries.map((entry) => entry.id));
    s.pendingUpdates = s.pendingUpdates.filter((entry) => persistedIds.has(entry.id));
    s.inFlightUpdateIds.forEach((id) => {
      if (!persistedIds.has(id)) s.inFlightUpdateIds.delete(id);
    });
    if (s.inFlightUpdateIds.size === 0 && s.updateRetryTimer) {
      clearTimeout(s.updateRetryTimer);
      s.updateRetryTimer = null;
    }
    if (s.inFlightUpdateIds.size === 0 && entries.length === 0) {
      s.updateRetryDelay = INITIAL_UPDATE_RETRY_MS;
    }
    if (!entries.length) return;
    if (!isAxionReady()) return;
    const have = new Set(s.pendingUpdates.map((u) => u.id));
    for (const e of entries) {
      if (!have.has(e.id)) s.pendingUpdates.push({ id: e.id, message_id: e.message_id, changes: e.changes });
    }
    _flushPendingUpdates(roomId, s);
  } catch { /* ignore */ }
}

function _ackPendingUpdates(roomId: string, s: RoomState, ids: string[], ackedByUserId?: number): void {
  if (!ids.length) return;
  // SQLite owns completion: an update stays queued until every planned peer
  // has acknowledged it. Removing it from memory here would lose retries.
  ackOutboxUpdates(ids, ackedByUserId).then(() => _flushSQLiteOutbox(roomId, s)).catch(() => {});
  console.log('[ChatWsManager] acked', ids.length, 'message updates for room', roomId);
}

/** Recover durable sends after an app process restart, even if their chat
 * screen has not been opened yet. */
export async function recoverPendingOutgoingMessages(): Promise<void> {
  if (_myUserId === null || !isAxionReady()) return;
  const roomIds = await getRoomsWithPendingOutgoingMessages(_myUserId);
  for (const roomId of roomIds) {
    const state = getOrCreate(roomId);
    flushAxionRoom(roomId, state);
  }
}

export function ackMessageUpdates(roomId: string, ids: string[], ackedByUserId?: number): void {
  if (!ids.length) return;
  const s = rooms.get(roomId);
  if (s) {
    _ackPendingUpdates(roomId, s, ids, ackedByUserId);
    return;
  }
  // Room not in memory (screen closed). Still clear SQLite outbox + sync flags.
  ackOutboxUpdates(ids, ackedByUserId).catch(() => {});
}

function _syncRoomPendingNow(roomId: string, s: RoomState): void {
  if (!isAxionReady()) return;
  _flushPendingUpdates(roomId, s);
  _flushSQLiteOutbox(roomId, s).catch(() => {});
  _retryPendingUnsyncedMessages(roomId, s).catch(() => {});
}

/* ================================================================== */
/*  Core connect                                                       */
/* ================================================================== */

export async function connectRoom(roomId: string): Promise<void> {
  const state = getOrCreate(roomId);

  // Axion is shared by every room. Opening a chat registers only a logical
  // room with the local outbox and never creates another WebSocket.
  ensureAxionStatusListener();
  if (isAxionReady()) {
    flushAxionRoom(roomId, state);
    return;
  }

  setStatus(roomId, state, state.hasConnectedBefore ? 'reconnecting' : 'connecting');
  await ensureWsAlive().catch(() => {});
  if (isAxionReady()) flushAxionRoom(roomId, state);
}

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/**
 * Subscribe to state updates for a room.
 * Registers the logical room with Axion and flushes its durable outbox.
 *
 * The returned unsubscribe function removes this listener. If it was the LAST
 * listener for the room we discard only its local state after a short grace
 * period. Axion itself remains connected for the whole authenticated app.
 */
export function subscribeRoom(roomId: string, listener: RoomListener): () => void {
  const s = getOrCreate(roomId);
  // If a pending disconnect was scheduled (from a recent unsubscribe), cancel it.
  if (s.disconnectTimer) {
    clearTimeout(s.disconnectTimer);
    s.disconnectTimer = null;
  }
  s.listeners.add(listener);
  void connectRoom(roomId);
  return () => {
    s.listeners.delete(listener);
    if (s.listeners.size === 0) {
      // Defer the disconnect briefly so a quick remount (navigation animation,
      // StrictMode double-invoke) doesn't churn the WebSocket.
      if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
      s.disconnectTimer = setTimeout(() => {
        s.disconnectTimer = null;
        // Re-check: a new subscriber may have arrived during the grace period.
        if (s.listeners.size === 0) {
          disconnectRoom(roomId);
        }
      }, 1500);
    }
  };
}

/**
 * Remove one logical room from the coordinator without closing Axion.
 */
export function disconnectRoom(roomId: string): void {
  const s = rooms.get(roomId);
  if (!s) return;
  if (s.disconnectTimer) { clearTimeout(s.disconnectTimer); s.disconnectTimer = null; }
  clearRoomRetryState(s);
  rooms.delete(roomId);
  try { useAppStore.getState().removeChatRoom(roomId); } catch {}
}

/** Disconnect all rooms. Call on logout. */
export function disconnectAllRooms(): void {
  rooms.forEach((_, id) => disconnectRoom(id));
  if (_axionStatusUnsub) {
    _axionStatusUnsub();
    _axionStatusUnsub = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Media delivery (Phase 2): out-of-band via HTTP                      */
/*                                                                     */
/*  Media (voice/image/video/document) is uploaded/downloaded over HTTP */
/*  backend over HTTP (see mediaLane.ts). The chat frame carries only a */
/*  lightweight pointer (media_id + md5 + metadata) — never the bytes.  */
/*  This keeps text fast (no head-of-line blocking) and sidesteps the   */
/*  Railway 1 MiB WS-frame ceiling entirely. See sendOutboxFrame below. */
/* ------------------------------------------------------------------ */

/**
 * Toggle the in-memory "uploading" flag on an outgoing media message so the
 * sender's bubble can show a spinner while its blob uploads over HTTP.
 */
function markUploading(s: RoomState, roomId: string, messageId: string, uploading: boolean): void {
  const idx = s.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  if (!!s.messages[idx].uploading === uploading) return;
  s.messages = [
    ...s.messages.slice(0, idx),
    { ...s.messages[idx], uploading },
    ...s.messages.slice(idx + 1),
  ];
  s.lastMutationAt = Date.now();
  s.lastMutationIds = [];
  notifyListeners(roomId, s);
}

function markTransferFailure(
  s: RoomState,
  roomId: string,
  messageId: string,
  failure: MediaTransferFailure | null,
): void {
  const idx = s.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  s.messages = [
    ...s.messages.slice(0, idx),
    {
      ...s.messages[idx],
      transfer_error_code: failure?.code ?? null,
      transfer_error_message: failure?.message ?? null,
    },
    ...s.messages.slice(idx + 1),
  ];
  s.lastMutationAt = Date.now();
  s.lastMutationIds = [messageId];
  notifyListeners(roomId, s);
}

function fallbackMediaMime(messageType: string, fileUri: string | null | undefined): string {
  const ext = fileUri?.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (messageType === 'video') return ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  if (messageType === 'document') {
    const types: Record<string, string> = {
      pdf: 'application/pdf', txt: 'text/plain', doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip',
    };
    return types[ext] ?? 'application/octet-stream';
  }
  return 'image/jpeg';
}

/**
 * Deliver one outgoing message over Axion. Media bytes travel over HTTP and the
 * shared realtime gateway carries only the lightweight message/pointer frame.
 */
async function sendOutboxFrame(
  s: RoomState,
  roomId: string,
  msg: {
    id: string;
    content: string | null;
    type: string;
    created_at: string;
    reply_to?: import('./localMessageStore').ReplyRef | null;
    duration_ms?: number | null;
    file_uri?: string | null;
  },
  opts?: { hydration?: boolean; audioMime?: string | null; imageMime?: string | null; mediaMime?: string | null },
): Promise<SendAttemptResult> {
  if (!isAxionReady()) return { sent: false };
  const isVoice = msg.type === 'voice';
  const isMedia = isVoice || msg.type === 'image' || msg.type === 'video' || msg.type === 'document';

  const base: Record<string, any> = {
    id: msg.id,
    message: msg.content,
    message_type: msg.type,
    created_at: msg.created_at,
    ...(msg.reply_to ? { reply_to: msg.reply_to } : {}),
    ...(msg.duration_ms != null ? { duration_ms: msg.duration_ms } : {}),
    ...(opts?.hydration ? { hydration: true } : {}),
  };

  if (isMedia) {
    // Out-of-band media: upload the blob once (HTTP), persist the pointer, then
    // send a lightweight pointer frame on the WS. The bytes NEVER ride the WS.
    let ptr = await getMediaPointer(msg.id);
    if (!ptr?.media_id) {
      if (!msg.file_uri) return { sent: false }; // nothing to upload yet — retried later
      const mime = isVoice ? (opts?.audioMime ?? 'audio/m4a') : (opts?.mediaMime ?? opts?.imageMime ?? fallbackMediaMime(msg.type, msg.file_uri));
      const mediaType: MediaType = msg.type === 'video' ? 'video' : msg.type === 'document' ? 'document' : isVoice ? 'voice' : 'image';
      markUploading(s, roomId, msg.id, true);
      await clearMessageTransferFailure(msg.id).catch(() => {});
      markTransferFailure(s, roomId, msg.id, null);
      try {
        const up = await uploadMedia({
          roomId,
          fileUri: msg.file_uri,
          mediaType,
          mime,
          messageId: msg.id,
          durationMs: msg.duration_ms ?? null,
        });
        ptr = { media_id: up.media_id, md5: up.md5, sha256: up.sha256, size: up.size_bytes, mime: up.mime };
        await setMediaPointer(msg.id, ptr);
      } catch (err) {
        const failure = toMediaTransferFailure(err);
        await setMessageTransferFailure(msg.id, failure.code, failure.message, !failure.retryable).catch(() => {});
        markTransferFailure(s, roomId, msg.id, failure);
        console.warn('[ChatWsManager] media upload failed, keeping pending', msg.id, failure.code, failure.status);
        markUploading(s, roomId, msg.id, false);
        return { sent: false, error: failure };
      }
      markUploading(s, roomId, msg.id, false);
    }
    // The upload may have taken a while — re-check Axion before sending.
    if (!isAxionReady()) return { sent: false };
    try {
      const sent = sendRawNotif({
        type: 'send_message',
        room_id: roomId,
        ...base,
        media_id: ptr.media_id,
        media_md5: ptr.md5,
        media_sha256: ptr.sha256,
        media_size: ptr.size,
        ...(isVoice ? { audio_mime: ptr.mime } : msg.type === 'image' ? { image_mime: ptr.mime } : { media_mime: ptr.mime }),
      });
      if (!sent) return { sent: false };
    } catch (err) {
      console.warn('[ChatWsManager] media pointer send failed', msg.id, err);
      return { sent: false };
    }
    watchForServerAck(msg.id);
    return { sent: true };
  }

  // Text — single frame.
  try {
    if (!sendRawNotif({ type: 'send_message', room_id: roomId, ...base })) return { sent: false };
  } catch (err) {
    console.warn('[ChatWsManager] frame send failed', msg.id, err);
    return { sent: false };
  }
  watchForServerAck(msg.id);
  return { sent: true };
}

/**
 * Send a chat message.
 * Always saves to local DB first, then attempts WS delivery.
 * Returns the client-generated UUID plus sent/queued/failed state.
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  messageType = 'text',
  replyTo: import('./localMessageStore').ReplyRef | null = null,
  extras: SendExtras | null = null,
): Promise<SendChatResult> {
  if (__DEV__) console.log('[ChatWsManager] sendChatMessage called — room:', roomId, '_myUserId:', _myUserId, 'type:', messageType);
  const msgId = generateUUID();
  const createdAt = new Date().toISOString();

  const fileUri = extras?.file_uri ?? null;
  const durationMs = extras?.duration_ms ?? null;
  const audioMime = extras?.audio_mime ?? null;
  const imageMime = extras?.image_mime ?? null;
  const mediaMime = extras?.media_mime ?? null;
  const isMediaMessage = messageType === 'voice' || messageType === 'image' || messageType === 'video' || messageType === 'document';

  // A reply can be composed immediately after a notification opens a room,
  // before React has mounted `useChat` and subscribed its logical room. Always
  // create the room state here so the message has an owner and can actively
  // establish the transport instead of remaining pending indefinitely.
  const s = getOrCreate(roomId);

  // Optimistically add to in-memory list IMMEDIATELY so UI updates without waiting for SQLite
  if (_myUserId !== null) {
    const optimisticMsg: WsMessage = {
      id: msgId,
      sender: _myUsername,
      sender_id: _myUserId,
      content,
      message_type: messageType,
      created_at: createdAt,
      is_read: false,
      reply_to: replyTo,
      file_uri: fileUri,
      duration_ms: durationMs,
    };
    s.pendingIds = new Set([...s.pendingIds, msgId]);
    s.messages = [...s.messages, optimisticMsg];
    if (__DEV__) console.log('[ChatWsManager] optimistic update — listeners:', s.listeners.size, 'total msgs:', s.messages.length);
    notifyListeners(roomId, s);
  } else {
    console.warn('[ChatWsManager] skipped optimistic update — _myUserId:', _myUserId, 'roomState:', !!s);
  }

  // Persist locally first in intent, but never put the realtime relay behind a
  // SQLite lock. Under load, awaiting this write here added multi-second gaps
  // before the Axion frame was even handed to the WebSocket.
  const persistLocalMessage = _myUserId !== null
    ? (async () => {
      try {
        await saveMessage({
        id: msgId,
        room_id: roomId,
        sender_id: _myUserId,
        sender_name: _myUsername,
        content,
        type: messageType,
        file_uri: fileUri,
        created_at: createdAt,
        is_mine: true,
        sync: false,
        status: 'pending',
        reactions: {},
        is_deleted: false,
        is_read: false,
        reply_to: replyTo,
        duration_ms: durationMs,
      });
      try {
        useAppStore.getState().setRoomLastMessage(roomId, {
          id: msgId,
          content,
          created_at: createdAt,
          sender: _myUsername ?? undefined,
          sender_id: _myUserId,
          status: 'pending',
        });
      } catch {}
      } catch (err) {
        console.warn('[ChatWsManager] failed to save message locally:', err);
      }
    })()
    : Promise.resolve();

  let attempt: SendAttemptResult = { sent: false };
  if (isAxionReady()) {
    // The media pointer and any transfer failure are UPDATEs to this row. Ensure
    // it exists before the HTTP request so a fast upload cannot race SQLite.
    if (isMediaMessage) await persistLocalMessage;
    // Text uses Axion directly. Media uploads over HTTP first, then Axion
    // carries only its lightweight pointer.
    attempt = await sendOutboxFrame(
      s,
      roomId,
      { id: msgId, content, type: messageType, created_at: createdAt, reply_to: replyTo, duration_ms: durationMs, file_uri: fileUri },
      { audioMime, imageMime, mediaMime },
    );
  } else {
    // The message is safely persisted above. Start (or resume) Axion now; its
    // connected-status path flushes SQLite outbox rows, including this one.
    // This covers notification/deep-link cold starts and transient disconnects.
    await persistLocalMessage;
    connectRoom(roomId).catch(() => {});
  }

  // Do not await SQLite on the hot path. If the server ACK won the race with
  // this write, apply that acceptance as soon as the row exists.
  if (isAxionReady()) {
    void persistLocalMessage.then(() => {
      if (_earlyServerAcceptedMessageIds.delete(msgId)) {
        return setMessageSyncState(msgId, true).catch(() => {});
      }
    });
  }

  return {
    messageId: msgId,
    state: attempt.sent ? 'sent' : attempt.error && !attempt.error.retryable ? 'failed' : 'queued',
    ...(attempt.error ? { error: attempt.error } : {}),
  };
}

/**
 * Called by notificationWsManager when a receiver_ready event arrives.
 * Re-sends undelivered messages for that recipient in the given room.
 */
async function _doFlush(roomId: string, s: RoomState, recipientId: number): Promise<void> {
  if (_myUserId === null) return;
  try {
    const msgs = await getPendingOutbox(roomId, _myUserId, recipientId);
    for (const msg of msgs) {
      // Stop if the socket dropped mid-flush; the rest is retried on next auth_ok.
      if (!isAxionReady()) break;
      try {
        await sendOutboxFrame(s, roomId, msg);
      } catch (err) {
        // One bad message must never abort the loop — continue with the rest.
        console.warn('[ChatWsManager] outbox flush send failed, skipping', msg.id, err);
        continue;
      }
    }
  } catch { /* ignore */ }
}

/**
 * Fallback resend path for local rows that are explicitly pending+unsynced.
 * Covers edge-cases where delivery_tracking metadata is incomplete.
 */
async function _retryPendingUnsyncedMessages(roomId: string, s: RoomState): Promise<void> {
  if (_myUserId === null) return;
  try {
    const msgs = await getPendingUnsyncedOutgoingMessages(roomId, _myUserId);
    if (msgs.length === 0) return;
    for (const msg of msgs) {
      // Stop if Axion dropped mid-retry; the rest is retried after reconnecting.
      if (!isAxionReady()) break;
      try {
        await sendOutboxFrame(s, roomId, msg);
      } catch (err) {
        // One bad message must never abort the loop — continue with the rest.
        console.warn('[ChatWsManager] pending-unsynced retry send failed, skipping', msg.id, err);
        continue;
      }
    }
  } catch { /* ignore */ }
}

/**
 * Apply a batch of remote mutation updates to the room's in-memory state and SQLite.
 * Called by Axion's notification ingress path.
 */
function _applyUpdatesToState(
  roomId: string,
  s: RoomState,
  updates: Array<{ message_id: string; changes: MessageChanges }>,
): void {
  let changed = false;
  for (const u of updates) {
    if (u.changes.is_read) {
      s.readIds = new Set([...s.readIds, u.message_id]);
      changed = true;
      // Promote chat-list status to 'read' if the acked id is the latest outgoing.
      try {
        useAppStore.getState().setRoomLastMessageStatus(roomId, u.message_id, 'read');
      } catch {}
    }
    if (
      u.changes.reactions !== undefined ||
      u.changes.is_deleted !== undefined ||
      u.changes.content !== undefined
    ) {
      s.messages = s.messages.map((m) => {
        if (m.id !== u.message_id) return m;
        return {
          ...m,
          ...(u.changes.reactions  !== undefined && { reactions:  u.changes.reactions }),
          ...(u.changes.is_deleted !== undefined && { is_deleted: u.changes.is_deleted }),
          ...(u.changes.content    !== undefined && { content:    u.changes.content }),
          ...(u.changes.updated_at !== undefined && { updated_at: u.changes.updated_at }),
          ...(u.changes.revision   !== undefined && { revision:   u.changes.revision }),
        };
      });
      changed = true;
    }
  }
  if (changed) {
    s.lastMutationAt = Date.now();
    s.lastMutationIds = updates.map((update) => update.message_id);
    notifyListeners(roomId, s);
  }
  // Persist to SQLite (fire-and-forget)
  updates.forEach((u) => applyMessageChanges(u.message_id, u.changes).catch(() => {}));
}

/**
 * Called by notificationWsManager when a message_update event arrives.
 */
export function applyRemoteMessageUpdates(
  roomId: string,
  updates: Array<{ message_id: string; changes: MessageChanges }>,
): void {
  const s = rooms.get(roomId);
  // Promote chat-list status for any read-acks, regardless of whether the room
  // WS is currently open (chat list needs this).
  try {
    const store = useAppStore.getState();
    for (const u of updates) {
      if (u.changes.is_read) {
        store.setRoomLastMessageStatus(roomId, u.message_id, 'read');
      }
    }
  } catch {}
  if (!s) {
    // Room not in memory — only persist to SQLite
    updates.forEach((u) => applyMessageChanges(u.message_id, u.changes).catch(() => {}));
    return;
  }
  _applyUpdatesToState(roomId, s, updates);
}
/**
 * Called by notificationWsManager when a receiver_ready event arrives.
 * Re-sends undelivered messages for that recipient in the given room.
 */
export function flushOutboxForRecipient(roomId: string, recipientId: number): void {
  const s = rooms.get(roomId);
  if (s && isAxionReady()) {
    // The peer explicitly came online, so permit a durable mutation retry now
    // rather than waiting for its normal bounded retry timer.
    s.inFlightUpdateIds.clear();
    _doFlush(roomId, s, recipientId);
    _flushSQLiteOutbox(roomId, s).catch(() => {});
  } else {
    const rs = getOrCreate(roomId);
    if (!rs.pendingFlushes.includes(recipientId)) {
      rs.pendingFlushes.push(recipientId);
    }
    connectRoom(roomId);
  }
}

/**
 * Re-send specific messages I authored (by id) to a room, WITH their media,
 * regardless of delivery status. Used to hydrate a peer that received a media
 * message via a b64-stripped push and now explicitly requests the media.
 * Only messages where I'm the sender are eligible (the query enforces this).
 */
export async function resendMessagesByIds(
  roomId: string,
  recipientId: number,
  ids: string[],
): Promise<void> {
  if (_myUserId === null || !ids.length) return;
  const s = rooms.get(roomId);
  if (!s || !isAxionReady()) {
    // Axion is not ready yet — queue the resend for its connected-status flush.
    const rs = getOrCreate(roomId);
    rs.pendingResends.push({ recipientId, ids });
    connectRoom(roomId);
    return;
  }
  try {
    const msgs = await getMessagesByIdsForResend(roomId, _myUserId, ids);
    for (const msg of msgs) {
      if (!isAxionReady()) break;
      // Nothing to hydrate if this row carries no media file.
      if (!msg.file_uri || (msg.type !== 'voice' && msg.type !== 'image')) continue;
      try {
        // Media-hydration re-send: the recipient already has the message row +
        // its notification (it arrived via a b64-stripped push or a lost chunk
        // stream). The `hydration` flag tells the relay to deliver over the room
        // Axion only and NOT fire a second push/notification. Large media is
        // re-streamed as chunks; small media rides inline.
        await sendOutboxFrame(s, roomId, msg, { hydration: true });
        console.log('[ChatWsManager] re-sent media for', msg.id, 'to', recipientId);
      } catch (err) {
        console.warn('[ChatWsManager] media hydration resend failed, skipping', msg.id, err);
        continue;
      }
    }
  } catch { /* best-effort */ }
}

/**
 * Explicitly re-send one pending outgoing message. The original id is kept so
 * the server's delivery records and the recipient's SQLite ingress dedupe it
 * if the first relay was merely delayed rather than lost.
 */
export async function retryOutgoingMessage(
  roomId: string,
  messageId: string,
): Promise<{ state: 'sent' | 'queued' | 'missing' | 'failed'; error?: MediaTransferFailure }> {
  if (_myUserId === null || !messageId) return { state: 'missing' };
  const state = getOrCreate(roomId);
  const priorFailure = await getMessageTransferFailure(messageId).catch(() => null);
  if (priorFailure?.blocked) {
    return {
      state: 'failed',
      error: {
        code: priorFailure.code as MediaTransferFailure['code'],
        message: priorFailure.message,
        retryable: false,
        status: priorFailure.code === 'too_large' ? 413 : 0,
      },
    };
  }
  if (!isAxionReady()) {
    if (!state.pendingManualRetryIds.includes(messageId)) {
      state.pendingManualRetryIds.push(messageId);
    }
    ensureWsAlive();
    connectRoom(roomId);
    return { state: 'queued' };
  }
  const messages = await getMessagesByIdsForResend(roomId, _myUserId, [messageId]);
  const message = messages[0];
  if (!message) return { state: 'missing' };
  const attempt = await sendOutboxFrame(state, roomId, message);
  return {
    state: attempt.sent ? 'sent' : attempt.error && !attempt.error.retryable ? 'failed' : 'queued',
    ...(attempt.error ? { error: attempt.error } : {}),
  };
}

/**
 * Queue a mutation to be synced to all other room members.
 * Adds to the in-memory queue + persists to SQLite outbox, then attempts immediate send.
 * Also applies the change locally right away so loadFromDB won't re-queue it.
 */
export function sendMessageUpdate(
  roomId: string,
  messageId: string,
  changes: MessageChanges,
  expectedPeerIds: number[] = [],
): void {
  const s = getOrCreate(roomId);
  // Apply to in-memory WS state immediately → triggers notifyListeners → UI re-renders
  // (also writes to SQLite internally via applyMessageChanges)
  _applyUpdatesToState(roomId, s, [{ message_id: messageId, changes }]);
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  // Persist before sending. The same id is used in memory, on the wire and in
  // SQLite, so an acknowledgement can never strand a second phantom outbox row.
  queueMessageUpdate(roomId, messageId, changes, { id, expectedPeerIds })
    .then(() => {
      // A fresh local action deserves the prompt first retry; only a stale
      // offline-peer wait is exponentially slowed down.
      s.updateRetryDelay = INITIAL_UPDATE_RETRY_MS;
      s.pendingUpdates.push({ id, message_id: messageId, changes });
      _flushPendingUpdates(roomId, s);
    })
    .catch(() => {});
}

/**
 * Queue read receipts for a batch of messages and relay via message_update.
 * All entries are pushed first, then a single WS send is made.
 * Also marks them read in local SQLite immediately to prevent re-sending on reload.
 */
export function markRoomAsRead(roomId: string, messageIds?: string[]): void {
  if (!messageIds?.length) return;
  const s = getOrCreate(roomId);
  for (const msgId of messageIds) {
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    // Persist first; read receipts use the server-provided room membership
    // snapshot when their relay acknowledgement arrives.
    queueMessageUpdate(roomId, msgId, { is_read: true }, { id })
      .then(() => {
        s.updateRetryDelay = INITIAL_UPDATE_RETRY_MS;
        s.pendingUpdates.push({ id, message_id: msgId, changes: { is_read: true } });
        _flushPendingUpdates(roomId, s);
      })
      .catch(() => {});
    // Mark read locally so loadFromDB filters this message out on the next reload
    applyMessageChanges(msgId, { is_read: true }).catch(() => {});
  }
}

/**
 * Merge external message IDs into the readIds set
 * (e.g. confirmations arriving via the notification channel).
 */
export function markIdsAsReadInRoom(roomId: string, ids: string[]): void {
  const s = rooms.get(roomId);
  if (!s || ids.length === 0) return;
  const next = applyMessageLifecycleEvent(s, { type: 'read', ids });
  s.pendingIds = next.pendingIds;
  s.deliveredIds = next.deliveredIds;
  s.readIds = next.readIds;
  notifyListeners(roomId, s);
}

/** Return a snapshot of the current room state (safe to call any time). */
export function getSnapshot(roomId: string): RoomSnapshot {
  const s = rooms.get(roomId);
  if (!s) return { messages: [], readIds: new Set(), pendingIds: new Set(), deliveredIds: new Set(), status: 'disconnected', reconnectCount: 0, lastMutationAt: 0, lastMutationIds: [] };
  return { messages: s.messages, readIds: s.readIds, pendingIds: s.pendingIds, deliveredIds: s.deliveredIds, status: s.status, reconnectCount: s.reconnectCount, lastMutationAt: s.lastMutationAt, lastMutationIds: s.lastMutationIds };
}

/**
 * Merge message IDs into the deliveredIds set
 * (called when message_delivery_ack arrives via the notification channel).
 */
export function markIdsAsDeliveredInRoom(roomId: string, ids: string[]): void {
  const s = rooms.get(roomId);
  if (!s || ids.length === 0) return;
  const next = applyMessageLifecycleEvent(s, { type: 'delivered', ids });
  s.pendingIds = next.pendingIds;
  s.deliveredIds = next.deliveredIds;
  s.readIds = next.readIds;
  try {
    const store = useAppStore.getState();
    for (const id of ids) {
      store.setRoomLastMessageStatus(roomId, id, 'delivered');
    }
  } catch {}
  notifyListeners(roomId, s);
}

/**
 * Inject a received message into the room's in-memory state from an external source
 * (e.g. notification WS relay). No-op if the room has no active listeners.
 *
 * When `opts.updateExisting` is set and a message with the same id is already
 * present, its fields are merged (used to backfill a hydrated media `file_uri`
 * onto a row that first arrived via a b64-stripped push). Otherwise a duplicate
 * id is ignored.
 */
export function injectReceivedMessage(
  roomId: string,
  msg: WsMessage,
  opts?: { updateExisting?: boolean },
): void {
  const s = rooms.get(roomId);
  if (!s || s.listeners.size === 0) return;
  const result = mergeMessageById(s.messages, msg, opts?.updateExisting === true);
  if (!result.changed) return;
  s.messages = result.messages;
  if (!result.inserted) {
    s.lastMutationAt = Date.now();
    s.lastMutationIds = [msg.id];
  }
  notifyListeners(roomId, s);
}

/**
 * Broadcast a typing indicator to the room.
 * Caller is responsible for throttling (e.g. once per keystroke burst).
 */
export function sendTyping(roomId: string, isTyping: boolean): void {
  if (!isAxionReady()) return;
  sendRawNotif({ type: 'typing', room_id: roomId, is_typing: isTyping });
}

/** Axion accepted an outbound message. Persist its server-sync state without
 * waiting for a delivery receipt from each recipient. */
export function markServerMessageAccepted(roomId: string, messageId: string): void {
  if (!messageId) return;
  clearServerAckWatch(messageId);
  _earlyServerAcceptedMessageIds.add(messageId);
  // A failed/delayed local write should not leave an unbounded in-memory entry.
  setTimeout(() => _earlyServerAcceptedMessageIds.delete(messageId), 60_000);
  setMessageSyncState(messageId, true)
    // No full-room SQLite reload here: acceptance is a transport-state change,
    // not a content mutation. Delivery/read ticks still update their focused
    // bubble and chat-list preview through their dedicated events.
    .then(() => {})
    .catch(() => {});
}

/** Store Axion's authoritative peer snapshot for a mutation outbox entry. */
export function applyMessageUpdateServerAck(
  roomId: string,
  updates: Array<{ id?: string; expected_peer_ids?: number[] }>,
): void {
  const s = getOrCreate(roomId);
  updates.forEach((update) => {
    const id = typeof update?.id === 'string' ? update.id : '';
    const peers = Array.isArray(update?.expected_peer_ids)
      ? update.expected_peer_ids.map(Number).filter((userId) => Number.isInteger(userId) && userId > 0)
      : [];
    if (id) setOutboxExpectedPeers(id, peers).then(() => _flushSQLiteOutbox(roomId, s)).catch(() => {});
  });
}
