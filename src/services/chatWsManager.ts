/* ------------------------------------------------------------------ */
/*  Chat WebSocket Manager (module-level singleton per room)           */
/*                                                                     */
/*  Manages per-room /ws/chat/<roomId>/ WebSocket connections at       */
/*  MODULE level so they survive React component unmounts.             */
/*                                                                     */
/*  Each room has its own connection, message list, and reconnect      */
/*  state. React hooks subscribe via callbacks and receive snapshots   */
/*  without owning the connection lifecycle.                           */
/*                                                                     */
/*  Fixes applied vs. the old hook-based approach:                     */
/*   - Survives navigation / component unmounts                        */
/*   - Post-connect JWT auth (no token in URL)                         */
/*   - Read receipt retry queue (flush on reconnect)                   */
/*   - Exponential backoff (300ms → 60s) reset ONLY on auth_ok        */
/*   - 8s hard connection timeout                                      */
/*   - NetInfo listener — instant reconnect on network restore         */
/*   - Pong timeout does NOT reset backoff                             */
/*   - 5s token refresh with AbortController                           */
/* ------------------------------------------------------------------ */

import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import { getTokens, saveTokens, BASE_URL } from './api';
import { saveMessage, getPendingOutbox, getPendingUnsyncedOutgoingMessages, getRoomsWithPendingOutgoingMessages, getMessagesByIdsForResend, MessageChanges, OutboxEntry, queueMessageUpdate, getPendingOutboxUpdates, ackOutboxUpdates, applyMessageChanges, setMessageSyncState, getMediaPointer, setMediaPointer, setOutboxExpectedPeers } from './localMessageStore';
import { uploadMedia, type MediaType } from './mediaLane';
import { useAppStore } from '../store/appStore';
import type { InboundResult } from './ingressRouter';
import { ensureWsAlive, isNotifWsReady, reconnectWsNow, sendRawNotif, subscribeStatus } from './notificationWsManager';

const WS_BASE = BASE_URL.replace(/^http/, 'ws');

/* ------------------------------------------------------------------ */
/*  Unified inbound router binding                                     */
/*                                                                     */
/*  All inbound DATA frames (chat messages, read receipts, reactions/  */
/*  edits, typing) are handed to the single `routeInbound` dispatcher  */
/*  so every transport funnels through one place. Bound lazily to      */
/*  avoid a static import cycle (ingressRouter statically imports many  */
/*  helpers from this module).                                         */
/* ------------------------------------------------------------------ */
let _routeInbound:
  | ((raw: Record<string, any>, source: 'ws') => Promise<InboundResult>)
  | null = null;
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
async function routeInboundFrame(raw: Record<string, any>): Promise<InboundResult | null> {
  if (!_routeInbound) {
    try {
      _routeInbound = (await import('./ingressRouter')).routeInbound;
    } catch {
      return null;
    }
  }
  return _routeInbound(raw, 'ws');
}

/* ---- Timing constants ---- */
const INITIAL_RECONNECT_MS = 1500;
const MAX_RECONNECT_MS = 60_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 15_000;
const CONNECTION_TIMEOUT_MS = 8_000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000; // refresh when <2 min left
// Must be >= server's WS_AUTH_TIMEOUT_SECONDS (10s) so we don't give up before the
// server has a chance to acknowledge our auth frame on slow networks.
const AUTH_TIMEOUT_MS = 10_000;
// Server is now hardened with try/except in ChatConsumer.receive, so re-enabling
// ready_to_receive lets the server flush any pending deliveries for this room.
const SEND_READY_TO_RECEIVE_ON_AUTH_OK = true;
const WS_1011_COOLDOWN_MS = 30_000;

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
  ws: WebSocket | null;
  connecting: boolean;
  connectingStartedAt: number;
  authenticated: boolean;
  connectedAt: number;
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
  reconnectDelay: number;
  reconnectCount: number;
  close1011Count: number;
  suspendReconnectUntil: number;
  hasConnectedBefore: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  connectionTimeoutTimer: ReturnType<typeof setTimeout> | null;
  authTimeoutTimer: ReturnType<typeof setTimeout> | null;
  pendingFlushes: number[];
  /** Queued media-hydration resends (specific ids) for a recipient, awaiting WS open. */
  pendingResends: Array<{ recipientId: number; ids: string[] }>;
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

function flushAxionRoom(roomId: string, s: RoomState): void {
  s.authenticated = true;
  s.connecting = false;
  s.hasConnectedBefore = true;
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
}

function ensureAxionStatusListener(): void {
  if (_axionStatusUnsub) return;
  _axionStatusUnsub = subscribeStatus((status) => {
    rooms.forEach((s, roomId) => {
      if (status === 'connected' && isAxionReady()) {
        flushAxionRoom(roomId, s);
      } else if (status === 'connecting' || status === 'reconnecting') {
        s.authenticated = false;
        setStatus(roomId, s, s.hasConnectedBefore ? 'reconnecting' : 'connecting');
      } else {
        s.authenticated = false;
        setStatus(roomId, s, 'disconnected');
      }
    });
  });
}

let _netInfoUnsub: (() => void) | null = null;
let _appStateUnsub: { remove: () => void } | null = null;
let _hasInternet = true;
let _appStateDebouncing = false; // prevent duplicate fires vs notificationWsManager
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
    ws: null,
    connecting: false,
    connectingStartedAt: 0,
    authenticated: false,
    connectedAt: 0,
    status: 'disconnected',
    messages: [],
    readIds: new Set(),
    pendingIds: new Set(),
    deliveredIds: new Set(),
    pendingUpdates: [],
    inFlightUpdateIds: new Set(),
    updateRetryTimer: null,
    reconnectDelay: INITIAL_RECONNECT_MS,
    reconnectCount: 0,
    close1011Count: 0,
    suspendReconnectUntil: 0,
    hasConnectedBefore: false,
    reconnectTimer: null,
    pingTimer: null,
    pongTimer: null,
    connectionTimeoutTimer: null,
    authTimeoutTimer: null,
    pendingFlushes: [],
    pendingResends: [],
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

function clearTimers(s: RoomState) {
  if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null; }
  if (s.pingTimer) { clearInterval(s.pingTimer); s.pingTimer = null; }
  if (s.pongTimer) { clearTimeout(s.pongTimer); s.pongTimer = null; }
  if (s.connectionTimeoutTimer) { clearTimeout(s.connectionTimeoutTimer); s.connectionTimeoutTimer = null; }
  if (s.authTimeoutTimer) { clearTimeout(s.authTimeoutTimer); s.authTimeoutTimer = null; }
  if (s.updateRetryTimer) { clearTimeout(s.updateRetryTimer); s.updateRetryTimer = null; }
  s.inFlightUpdateIds.clear();
}

function closeWs(s: RoomState) {
  if (s.ws) {
    s.ws.onopen = null;
    s.ws.onclose = null;
    s.ws.onmessage = null;
    s.ws.onerror = null;
    s.ws.close();
    s.ws = null;
  }
  s.connecting = false;
  s.authenticated = false;
}

function startPing(roomId: string, s: RoomState) {
  if (s.pingTimer) clearInterval(s.pingTimer);
  s.pingTimer = setInterval(() => {
    if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) {
      try { s.ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
      // Pong timeout: close + schedule reconnect WITHOUT resetting backoff
      s.pongTimer = setTimeout(() => {
        console.warn('[ChatWsManager] pong timeout room', roomId, '— reconnecting');
        closeWs(s);
        setStatus(roomId, s, 'reconnecting');
        scheduleReconnect(roomId, s);
      }, PONG_TIMEOUT_MS);
    }
  }, PING_INTERVAL_MS);
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
      s.updateRetryTimer = setTimeout(() => {
        s.updateRetryTimer = null;
        s.inFlightUpdateIds.clear();
        _flushSQLiteOutbox(roomId, s).catch(() => {});
      }, 8_000);
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

function scheduleReconnect(roomId: string, s: RoomState) {
  if (s.listeners.size === 0) return; // no subscribers — skip
  if (s.reconnectTimer) return;       // already scheduled
  if (!_hasInternet) { setStatus(roomId, s, 'disconnected'); return; }

  const now = Date.now();
  if (s.suspendReconnectUntil > now) {
    const wait = s.suspendReconnectUntil - now;
    console.warn('[ChatWsManager] room', roomId, 'reconnect suspended for', wait, 'ms after repeated 1011');
    s.reconnectTimer = setTimeout(() => {
      s.reconnectTimer = null;
      if (s.listeners.size > 0 && _hasInternet) connectRoom(roomId);
    }, wait);
    return;
  }

  const delay = s.reconnectDelay;
  console.log(`[ChatWsManager] room ${roomId} reconnect in ${delay}ms`);
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    if (s.listeners.size > 0 && _hasInternet) connectRoom(roomId);
  }, delay);
  // Advance backoff (capped at MAX) — only reset on auth_ok, not here
  s.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_MS);
}

function _syncRoomPendingNow(roomId: string, s: RoomState): void {
  if (!isAxionReady()) return;
  _flushPendingUpdates(roomId, s);
  _flushSQLiteOutbox(roomId, s).catch(() => {});
  _retryPendingUnsyncedMessages(roomId, s).catch(() => {});
}

/** Refresh the JWT access token with a 5-second hard timeout. */
async function refreshTokenIfNeeded(): Promise<string | null> {
  try {
    const tokens = await getTokens();
    if (!tokens?.access) return null;

    if (tokens.refresh) {
      let needsRefresh = false;
      try {
        // JWTs use base64url (- and _ instead of + and /). atob() only
        // handles standard base64, so normalise first to avoid a decode
        // error that would previously set needsRefresh=true on every call,
        // triggering a network round-trip on every WebSocket connect.
        const b64 = tokens.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        needsRefresh = (payload.exp * 1000) - Date.now() < TOKEN_REFRESH_MARGIN_MS;
      } catch {
        needsRefresh = true;
      }
      if (needsRefresh) {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 5_000);
        try {
          const { data } = await axios.post(
            `${BASE_URL}/api/users/token/refresh/`,
            { refresh: tokens.refresh },
            { signal: controller.signal },
          );
          await saveTokens(data.access, data.refresh ?? tokens.refresh);
          console.log('[ChatWsManager] JWT refreshed');
          return data.access;
        } finally {
          clearTimeout(tid);
        }
      }
    }
    return tokens.access;
  } catch (err: any) {
    console.warn('[ChatWsManager] token refresh failed:', err?.message ?? err);
    const fallback = await getTokens();
    return fallback?.access ?? null;
  }
}

/* ================================================================== */
/*  Core connect                                                       */
/* ================================================================== */

export async function connectRoom(roomId: string): Promise<void> {
  const s = getOrCreate(roomId);

  // Axion is shared by every room. Opening a chat only registers a logical
  // room with the local outbox; it must never create a second room WebSocket.
  ensureAxionStatusListener();
  if (isAxionReady()) {
    flushAxionRoom(roomId, s);
    return;
  }
  s.connecting = true;
  s.connectingStartedAt = Date.now();
  setStatus(roomId, s, s.hasConnectedBefore ? 'reconnecting' : 'connecting');
  await ensureWsAlive().catch(() => {});
  if (isAxionReady()) {
    flushAxionRoom(roomId, s);
  }
  // The status subscription above updates this logical room when Axion's
  // authentication/reconnect completes. Do not fall through into legacy room
  // socket setup.
  return;

  if (s.suspendReconnectUntil > Date.now()) return;

  if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) {
    // Room already connected: still force a sync pass so pending local messages
    // are retried every time the user opens the chat.
    _syncRoomPendingNow(roomId, s);
    return;
  }
  // If the socket is already OPEN but auth handshake is still in progress,
  // don't start another connect attempt.
  if (s.ws?.readyState === WebSocket.OPEN && !s.authenticated) return;

  // Detect stuck connecting (guard against concurrent calls)
  if (s.connecting) {
    if (Date.now() - s.connectingStartedAt < CONNECTION_TIMEOUT_MS) return;
    console.warn('[ChatWsManager] room', roomId, 'stuck connecting — resetting');
    closeWs(s);
  }

  if (!_hasInternet) { setStatus(roomId, s, 'disconnected'); return; }

  s.connecting = true;
  s.connectingStartedAt = Date.now();
  setStatus(roomId, s, s.hasConnectedBefore ? 'reconnecting' : 'connecting');

  const token = await refreshTokenIfNeeded();
  if (!token) {
    s.connecting = false;
    setStatus(roomId, s, 'disconnected');
    return;
  }

  closeWs(s);
  clearTimers(s);

  // Connect WITHOUT token in URL — auth sent as first message after open
  const url = `${WS_BASE}/ws/chat/${roomId}/`;
  console.log('[ChatWsManager] connecting room', roomId);

  try {
    const socket = new WebSocket(url);
    s.ws = socket;

    // Hard connection timeout
    s.connectionTimeoutTimer = setTimeout(() => {
      if (s.ws === socket && s.connecting) {
        console.warn('[ChatWsManager] connection timeout room', roomId);
        s.connecting = false;
        closeWs(s);
        setStatus(roomId, s, 'reconnecting');
        scheduleReconnect(roomId, s);
      }
    }, CONNECTION_TIMEOUT_MS);

    socket.onopen = () => {
      if (s.connectionTimeoutTimer) {
        clearTimeout(s.connectionTimeoutTimer);
        s.connectionTimeoutTimer = null;
      }
      console.log('[ChatWsManager] socket open room', roomId, '— sending auth');

      // Use the token refreshed just before the socket was created — no second
      // async call here, which previously introduced a gap long enough for the
      // server to time-out the unauthenticated connection and close it, causing
      // an infinite reconnect loop.
      if (!token || s.ws !== socket) {
        socket.close();
        return;
      }
      try {
        socket.send(JSON.stringify({ type: 'auth', token }));
      } catch {
        socket.close();
        return;
      }

      // Auth response timeout
      s.authTimeoutTimer = setTimeout(() => {
        if (s.ws === socket && !s.authenticated) {
          console.warn('[ChatWsManager] auth_ok timeout room', roomId);
          closeWs(s);
          setStatus(roomId, s, 'reconnecting');
          scheduleReconnect(roomId, s);
        }
      }, AUTH_TIMEOUT_MS);
    };

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const msgType: string = data.type ?? data.event ?? '';

        // ---- Authentication ----
        if (msgType === 'auth_ok') {
          if (s.authTimeoutTimer) { clearTimeout(s.authTimeoutTimer); s.authTimeoutTimer = null; }
          s.authenticated = true;
          s.connecting = false;
          s.connectedAt = Date.now();
          try { useAppStore.getState().setChatRoomAuthenticated(roomId, true); } catch {}
          // Do NOT reset backoff here. If the socket flaps (auth_ok then close
          // immediately), resetting to 300ms creates a reconnect storm.
          // We reset after a stable open period in onclose.
          if (s.hasConnectedBefore) {
            s.reconnectCount += 1;
          }
          s.hasConnectedBefore = true;
          setStatus(roomId, s, 'connected');
          startPing(roomId, s);
          // Flush in-memory pending updates + any SQLite outbox entries from previous sessions
          _flushPendingUpdates(roomId, s);
          _flushSQLiteOutbox(roomId, s).catch(() => {});
          // Tell the server we are ready to receive pending messages
          if (SEND_READY_TO_RECEIVE_ON_AUTH_OK) {
            try { socket.send(JSON.stringify({ type: 'ready_to_receive' })); } catch { /* ignore */ }
          }
          // Flush any outbox entries queued while the WS was offline
          if (s.pendingFlushes.length > 0) {
            const toFlush = [...s.pendingFlushes];
            s.pendingFlushes = [];
            toFlush.forEach((recipientId) => _doFlush(roomId, s, recipientId));
          }
          // Process any media-hydration resends queued while the WS was offline
          // (peer asked us to re-send media for a b64-stripped push delivery).
          if (s.pendingResends.length > 0) {
            const toResend = [...s.pendingResends];
            s.pendingResends = [];
            toResend.forEach(({ recipientId, ids }) => {
              resendMessagesByIds(roomId, recipientId, ids).catch(() => {});
            });
          }
          // Ask peers to re-send any media we're still missing (e.g. chunks that
          // streamed while we weren't in this room). Now that the room WS is
          // open, the re-streamed chunks will reach us.
          import('./outboundRouter')
            .then((m) => m.requestIncompleteMedia())
            .catch(() => {});
          return;
        }

        if (msgType === 'auth_failed') {
          console.warn('[ChatWsManager] auth_failed room', roomId);
          closeWs(s);
          setStatus(roomId, s, 'disconnected');
          return;
        }

        if (msgType === 'server_error') {
          console.warn('[ChatWsManager] server_error room', roomId, 'op', data.op ?? 'unknown');
          return;
        }

        // Drop all messages until auth handshake completes
        if (!s.authenticated) return;

        // ---- Server received & relayed the message: mark it synced locally ----
        if (msgType === 'message_server_ack') {
          const ackId = data.message_id;
          console.log('[ChatWsManager] server_ack', ackId, 'room', roomId);
          if (ackId) {
            setMessageSyncState(ackId, true)
              .then(() => {
                // Refresh the focused room after server acceptance.
                s.lastMutationAt = Date.now();
                notifyListeners(roomId, s);
              })
              .catch(() => { /* ignore */ });
          }
          return;
        }

        // The relay accepted a mutation and returns the authoritative member
        // snapshot. This lets SQLite retain the update until every peer applies it.
        if (msgType === 'message_update_server_ack') {
          const updates = Array.isArray(data.updates) ? data.updates : [];
          updates.forEach((update: any) => {
            const id = typeof update?.id === 'string' ? update.id : '';
            const peers = Array.isArray(update?.expected_peer_ids)
              ? update.expected_peer_ids.map(Number).filter((userId: number) => Number.isInteger(userId) && userId > 0)
              : [];
            if (id) setOutboxExpectedPeers(id, peers).then(() => _flushSQLiteOutbox(roomId, s)).catch(() => {});
          });
          return;
        }

        // ---- Keep-alive ----
        if (msgType === 'pong') {
          if (s.pongTimer) { clearTimeout(s.pongTimer); s.pongTimer = null; }
          return;
        }

        // ---- Media chunk (a slice of a large media message) ----
        // Reassembled by mediaChunkTransfer; when complete it feeds the bytes
        // through the normal ingest pipeline. Not a message frame → handled here
        // rather than the inbound router.
        if (msgType === 'media_chunk') {
          import('./mediaChunkTransfer')
            .then((m) => m.receiveMediaChunk({ ...data, room_id: data.room_id ?? roomId }))
            .catch(() => {});
          return;
        }

        // ---- All inbound DATA frames go through the single inbound router ----
        // The room WS is room-scoped, so the server omits room_id on its relays;
        // stamp it on so the router can address state. The router owns
        // persistence, dedupe, delivery-ack, read/reaction state and typing.
        routeInboundFrame({ ...data, room_id: data.room_id ?? roomId })
          .then((res) => {
            if (!res) return;
            // message.update → confirm the applied mutations back over THIS socket.
            if (res.ackUpdateIds && res.ackUpdateIds.length > 0 && res.ackSenderId && res.ackSenderId > 0) {
              try {
                s.ws?.send(JSON.stringify({
                  type: 'message_update_ack',
                  room_id: roomId,
                  sender_id: res.ackSenderId,
                  update_ids: res.ackUpdateIds,
                }));
              } catch { /* ignore */ }
            }
          })
          .catch(() => { /* ignore */ });
      } catch { /* ignore malformed frames */ }
    };

    socket.onclose = (ev) => {
      if (s.connectionTimeoutTimer) { clearTimeout(s.connectionTimeoutTimer); s.connectionTimeoutTimer = null; }
      if (s.authTimeoutTimer) { clearTimeout(s.authTimeoutTimer); s.authTimeoutTimer = null; }
      console.log('[ChatWsManager] closed room', roomId, ev.code);
      const wasCurrentSocket = s.ws === socket;
      const connectedMs = s.connectedAt ? Date.now() - s.connectedAt : 0;
      if (wasCurrentSocket) {
        s.ws = null;
        s.connecting = false;
        s.authenticated = false;
        try { useAppStore.getState().setChatRoomAuthenticated(roomId, false); } catch {}
        if (ev.code === 1011) {
          s.close1011Count += 1;
          // Slow down immediately on first server internal-error close.
          s.reconnectDelay = Math.max(s.reconnectDelay, 5000);
          if (s.close1011Count >= 2) {
            s.suspendReconnectUntil = Date.now() + WS_1011_COOLDOWN_MS;
          }
        } else {
          s.close1011Count = 0;
          s.suspendReconnectUntil = 0;
        }
        // Consider the session stable after 10s. Only then reset backoff.
        if (connectedMs >= 10_000) {
          s.reconnectDelay = INITIAL_RECONNECT_MS;
          s.close1011Count = 0;
          s.suspendReconnectUntil = 0;
        }
        s.connectedAt = 0;
      }
      if (s.pingTimer) { clearInterval(s.pingTimer); s.pingTimer = null; }
      if (s.pongTimer) { clearTimeout(s.pongTimer); s.pongTimer = null; }

      if (wasCurrentSocket && s.listeners.size > 0 && _hasInternet) {
        setStatus(roomId, s, 'reconnecting');
        scheduleReconnect(roomId, s);
      } else if (wasCurrentSocket) {
        setStatus(roomId, s, 'disconnected');
      }
    };

    socket.onerror = () => {
      // onclose always fires after onerror — reconnect handled there
    };
  } catch (err) {
    console.warn('[ChatWsManager] connect exception room', roomId, err);
    s.connecting = false;
    setStatus(roomId, s, 'reconnecting');
    scheduleReconnect(roomId, s);
  }
}

/* ================================================================== */
/*  Network & AppState listeners (module-level, shared across rooms)  */
/* ================================================================== */

function ensureNetworkListener() {
  if (_netInfoUnsub) return;
  _netInfoUnsub = NetInfo.addEventListener((netState) => {
    const online = netState.isConnected === true && netState.isInternetReachable !== false;
    const wasOffline = !_hasInternet;
    _hasInternet = online;

    if (!online) {
      rooms.forEach((s, roomId) => {
        if (s.ws || s.connecting) {
          closeWs(s);
          clearTimers(s);
          setStatus(roomId, s, 'disconnected');
        }
      });
    } else if (wasOffline && online) {
      console.log('[ChatWsManager] internet restored — reconnecting active rooms');
      rooms.forEach((s, roomId) => {
        if (s.listeners.size > 0) {
          s.reconnectDelay = INITIAL_RECONNECT_MS;
          connectRoom(roomId);
        }
      });
    }
  });
}

function ensureAppStateListener() {
  if (_appStateUnsub) return;
  _appStateUnsub = AppState.addEventListener('change', (appState) => {
    if (appState !== 'active') {
      // App going to background — close all room sockets so the Django consumer
      // stops treating this device as "in-room". Subsequent messages will be
      // delivered via the notification WS channel (and show as local push
      // notifications) instead of being silently dropped into the backgrounded
      // chat socket where no UI is listening.
      rooms.forEach((s, roomId) => {
        if (s.ws) {
          console.log('[ChatWsManager] app backgrounded — closing room WS', roomId);
          clearTimers(s);
          closeWs(s);
          setStatus(roomId, s, 'disconnected');
          // Reset backoff so the reconnect on foreground is instant.
          s.reconnectDelay = INITIAL_RECONNECT_MS;
        }
      });
      return;
    }

    // App came to foreground — debounce, then reconnect any room with listeners.
    if (_appStateDebouncing) return;
    _appStateDebouncing = true;
    setTimeout(() => { _appStateDebouncing = false; }, 60);

    rooms.forEach((s, roomId) => {
      if (s.listeners.size > 0) {
        console.log('[ChatWsManager] app foregrounded — reconnecting room', roomId);
        s.reconnectDelay = INITIAL_RECONNECT_MS;
        connectRoom(roomId);
      }
    });
  });
}

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/**
 * Subscribe to state updates for a room.
 * Automatically connects the room if not already connected.
 *
 * The returned unsubscribe function removes this listener. If it was the LAST
 * listener for the room we also disconnect the room WebSocket (after a short
 * grace period to absorb React StrictMode / quick navigation remounts).
 *
 * Why disconnect on last unsubscribe?
 *   The Django consumer treats users who are connected to the chat room WS as
 *   "currently in the room" and skips sending them a `new_message` event over
 *   the notification WS. If we kept the room socket open after the screen
 *   unmounted, the user would never get an in-app toast or local push for
 *   subsequent messages in that room — exactly the bug we are fixing.
 */
export function subscribeRoom(roomId: string, listener: RoomListener): () => void {
  ensureNetworkListener();
  ensureAppStateListener();
  const s = getOrCreate(roomId);
  // If a pending disconnect was scheduled (from a recent unsubscribe), cancel it.
  if (s.disconnectTimer) {
    clearTimeout(s.disconnectTimer);
    s.disconnectTimer = null;
  }
  s.listeners.add(listener);
  // Connect if not already open
  if (!s.ws || s.ws.readyState !== WebSocket.OPEN || !s.authenticated) {
    connectRoom(roomId);
  } else {
    // User re-opened an already-connected room: re-run pending sync now.
    _syncRoomPendingNow(roomId, s);
  }
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
 * Forcefully disconnect a room and remove it from the manager.
 * Use on logout or when the room is permanently left.
 */
export function disconnectRoom(roomId: string): void {
  const s = rooms.get(roomId);
  if (!s) return;
  if (s.disconnectTimer) { clearTimeout(s.disconnectTimer); s.disconnectTimer = null; }
  clearTimers(s);
  closeWs(s);
  rooms.delete(roomId);
  try { useAppStore.getState().removeChatRoom(roomId); } catch {}
}

/** Disconnect all rooms. Call on logout. */
export function disconnectAllRooms(): void {
  rooms.forEach((_, id) => disconnectRoom(id));
  if (_netInfoUnsub) { _netInfoUnsub(); _netInfoUnsub = null; }
  if (_appStateUnsub) { _appStateUnsub.remove(); _appStateUnsub = null; }
}

/* ------------------------------------------------------------------ */
/*  Media delivery (Phase 2): out-of-band via HTTP                      */
/*                                                                     */
/*  Media (voice/image/video) is uploaded to / downloaded from the      */
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
): Promise<boolean> {
  if (!isAxionReady()) return false;
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
      if (!msg.file_uri) return false; // nothing to upload yet — retried later
      const mime = isVoice ? (opts?.audioMime ?? 'audio/m4a') : (opts?.mediaMime ?? opts?.imageMime ?? fallbackMediaMime(msg.type, msg.file_uri));
      const mediaType: MediaType = msg.type === 'video' ? 'video' : msg.type === 'document' ? 'document' : isVoice ? 'voice' : 'image';
      markUploading(s, roomId, msg.id, true);
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
        console.warn('[ChatWsManager] media upload failed, keeping pending', msg.id, err);
        markUploading(s, roomId, msg.id, false);
        return false;
      }
      markUploading(s, roomId, msg.id, false);
    }
    // The upload may have taken a while — re-check Axion before sending.
    if (!isAxionReady()) return false;
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
      if (!sent) return false;
    } catch (err) {
      console.warn('[ChatWsManager] media pointer send failed', msg.id, err);
      return false;
    }
    watchForServerAck(msg.id);
    return true;
  }

  // Text — single frame.
  try {
    if (!sendRawNotif({ type: 'send_message', room_id: roomId, ...base })) return false;
  } catch (err) {
    console.warn('[ChatWsManager] frame send failed', msg.id, err);
    return false;
  }
  watchForServerAck(msg.id);
  return true;
}

/**
 * Send a chat message.
 * Always saves to local DB first, then attempts WS delivery.
 * Returns the client-generated message UUID.
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  messageType = 'text',
  replyTo: import('./localMessageStore').ReplyRef | null = null,
  extras: SendExtras | null = null,
): Promise<string | null> {
  if (__DEV__) console.log('[ChatWsManager] sendChatMessage called — room:', roomId, '_myUserId:', _myUserId, 'type:', messageType);
  const msgId = generateUUID();
  const createdAt = new Date().toISOString();

  const fileUri = extras?.file_uri ?? null;
  const durationMs = extras?.duration_ms ?? null;
  const audioMime = extras?.audio_mime ?? null;
  const imageMime = extras?.image_mime ?? null;
  const mediaMime = extras?.media_mime ?? null;

  // A reply can be composed immediately after a notification opens a room,
  // before React has mounted `useChat` and subscribed the room socket. Always
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

  if (isAxionReady()) {
    // Delivers text/small media in one frame; large media is chunked. Reads the
    // media base64 from `file_uri` internally.
    await sendOutboxFrame(
      s,
      roomId,
      { id: msgId, content, type: messageType, created_at: createdAt, reply_to: replyTo, duration_ms: durationMs, file_uri: fileUri },
      { audioMime, imageMime, mediaMime },
    );
  } else {
    // The message is safely persisted above. Start (or resume) the room socket
    // now; its auth_ok path flushes SQLite outbox rows, including this one.
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

  return msgId;
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
      // Stop if the socket dropped mid-retry; the rest is retried on next auth_ok.
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
 * Used both by the chat WS onmessage handler and by notificationWsManager.
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
 * Called by notificationWsManager when a message_update event arrives while
 * the user is NOT connected to the chat-room WebSocket.
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
    // Not connected to this room yet — queue the resend and open the socket.
    // The auth_ok handler drains pendingResends once the WS is authenticated.
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
        // WS only and NOT fire a second push/notification. Large media is
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
  s.readIds = new Set([...s.readIds, ...ids]);
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
  s.pendingIds = new Set([...s.pendingIds].filter((id) => !ids.includes(id)));
  s.deliveredIds = new Set([...s.deliveredIds, ...ids]);
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
  const idx = s.messages.findIndex((m) => m.id === msg.id);
  if (idx !== -1) {
    if (opts?.updateExisting) {
      const prev = s.messages[idx];
      const merged: WsMessage = { ...prev, ...msg, file_uri: msg.file_uri ?? prev.file_uri };
      s.messages = [...s.messages.slice(0, idx), merged, ...s.messages.slice(idx + 1)];
      s.lastMutationAt = Date.now();
      s.lastMutationIds = [msg.id];
      notifyListeners(roomId, s);
    }
    return; // dedup
  }
  s.messages = [...s.messages, msg];
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
