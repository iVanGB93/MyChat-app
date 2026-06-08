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
import { saveMessage, messageExists, getPendingOutbox, getUndeliveredSentMessages, MessageChanges, OutboxEntry, queueMessageUpdate, getPendingOutboxUpdates, deleteOutboxUpdates, applyMessageChanges } from './localMessageStore';
import { readAudioAsBase64, readFileAsBase64, saveIncomingAudio, saveIncomingImage } from './voiceMessageUtils';
import { useAppStore } from '../store/appStore';

const WS_BASE = BASE_URL.replace(/^http/, 'ws');

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
  is_read?: boolean;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
  reply_to?: import('./localMessageStore').ReplyRef | null;
  /** Local file URI for media messages (voice / image / file). */
  file_uri?: string | null;
  /** Duration in milliseconds for voice / video messages. */
  duration_ms?: number | null;
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
  lastMutationAt: number;
  listeners: Set<RoomListener>;
  /** Pending teardown timer scheduled by subscribeRoom when listeners reach 0. */
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

/* ---- Module-level state (survives React unmounts) ---- */
const rooms = new Map<string, RoomState>();

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
    lastMutationAt: 0,
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

/** Send in-memory pending updates now (if connected). Drains the in-memory queue. */
function _flushPendingUpdates(roomId: string, s: RoomState): void {
  if (s.pendingUpdates.length === 0) return;
  if (s.ws?.readyState !== WebSocket.OPEN || !s.authenticated) return;
  const batch = s.pendingUpdates.splice(0);
  try {
    s.ws.send(JSON.stringify({
      type: 'message_update',
      updates: batch.map((u) => ({ message_id: u.message_id, changes: u.changes })),
    }));
    // Remove from SQLite outbox after successful send
    deleteOutboxUpdates(batch.map((u) => u.id)).catch(() => {});
    console.log('[ChatWsManager] flushed', batch.length, 'pending updates for room', roomId);
  } catch {
    // Put back on failure — will retry on next reconnect
    s.pendingUpdates.unshift(...batch);
  }
}

/** Load SQLite outbox entries persisted from previous sessions and send them. */
async function _flushSQLiteOutbox(roomId: string, s: RoomState): Promise<void> {
  try {
    const entries = await getPendingOutboxUpdates(roomId);
    if (!entries.length) return;
    if (s.ws?.readyState !== WebSocket.OPEN || !s.authenticated) return;
    s.ws.send(JSON.stringify({
      type: 'message_update',
      updates: entries.map((e) => ({ message_id: e.message_id, changes: e.changes })),
    }));
    await deleteOutboxUpdates(entries.map((e) => e.id));
    console.log('[ChatWsManager] flushed', entries.length, 'SQLite outbox entries for room', roomId);
  } catch { /* ignore */ }
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

  if (s.suspendReconnectUntil > Date.now()) return;

  if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) return;
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
          // Retry any messages that were never delivered (e.g. all recipients
          // were offline when the message was originally sent)
          _retryUndeliveredMessages(roomId, s).catch(() => {});
          // Flush any outbox entries queued while the WS was offline
          if (s.pendingFlushes.length > 0) {
            const toFlush = [...s.pendingFlushes];
            s.pendingFlushes = [];
            toFlush.forEach((recipientId) => _doFlush(roomId, s, recipientId));
          }
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

        // ---- Server delivery ack (no UI action needed) ----
        if (msgType === 'message_server_ack') {
          console.log('[ChatWsManager] server_ack', data.message_id, 'room', roomId);
          if (data.message_id && s.pendingIds.has(data.message_id)) {
            s.pendingIds = new Set([...s.pendingIds].filter((id) => id !== data.message_id));
            notifyListeners(roomId, s);
          }
          // Promote chat-list status from 'pending' → 'sent' if this was the most recent outgoing.
          if (data.message_id) {
            try {
              useAppStore.getState().setRoomLastMessageStatus(roomId, String(data.message_id), 'sent');
            } catch {}
          }
          return;
        }

        // ---- Keep-alive ----
        if (msgType === 'pong') {
          if (s.pongTimer) { clearTimeout(s.pongTimer); s.pongTimer = null; }
          return;
        }

        // ---- Read receipt broadcast (legacy, kept for server backwards-compat) ----
        if (msgType === 'messages_read') {
          const ids: string[] = data.message_ids ?? [];
          if (ids.length > 0) {
            s.readIds = new Set([...s.readIds, ...ids]);
            notifyListeners(roomId, s);
            // Promote chat-list status → 'read' if any acked id is the most recent outgoing.
            try {
              const store = useAppStore.getState();
              for (const id of ids) store.setRoomLastMessageStatus(roomId, id, 'read');
            } catch {}
          }
          return;
        }

        // ---- Unified mutation relay: is_read, reactions, is_deleted, content ----
        if (msgType === 'message_update') {
          const updates: Array<{ message_id: string; changes: MessageChanges }> = data.updates ?? [];
          if (updates.length > 0) {
            _applyUpdatesToState(roomId, s, updates);
          }
          return;
        }

        // ---- Typing indicator (ephemeral, no persistence) ----
        if (msgType === 'typing') {
          const senderId = Number(data.sender_id);
          const sender = String(data.sender ?? '');
          const isTyping = Boolean(data.is_typing);
          if (senderId && sender) {
            try {
              useAppStore.getState().setRoomTyping(roomId, senderId, sender, isTyping);
            } catch {}
          }
          return;
        }

        // ---- Chat message ----
        const msg: WsMessage = { ...data, is_read: false };
        if (msg.id && msg.sender_id !== undefined) {
          (async () => {
            const exists = await messageExists(msg.id);
            const isOwn = msg.sender_id === _myUserId;
            if (!exists) {
              // If this is a voice/image message with inline base64 data, decode
              // it and persist to local cache so playback/display works offline.
              let localFileUri: string | null = msg.file_uri ?? null;
              const incomingAudioB64 = (data as { audio_b64?: string }).audio_b64;
              const incomingAudioMime = (data as { audio_mime?: string }).audio_mime;
              const incomingImageB64 = (data as { image_b64?: string }).image_b64;
              const incomingImageMime = (data as { image_mime?: string }).image_mime;
              if (msg.message_type === 'voice' && incomingAudioB64 && !localFileUri) {
                try {
                  localFileUri = await saveIncomingAudio(msg.id, incomingAudioB64, incomingAudioMime);
                } catch (err) {
                  console.warn('[ChatWsManager] failed to save incoming voice audio:', err);
                }
              } else if (msg.message_type === 'image' && incomingImageB64 && !localFileUri) {
                try {
                  localFileUri = await saveIncomingImage(msg.id, incomingImageB64, incomingImageMime);
                } catch (err) {
                  console.warn('[ChatWsManager] failed to save incoming image:', err);
                }
              }
              await saveMessage({
                id: msg.id,
                room_id: roomId,
                sender_id: msg.sender_id,
                sender_name: msg.sender,
                content: msg.content,
                type: msg.message_type,
                file_uri: localFileUri,
                created_at: msg.created_at,
                is_mine: isOwn,
                reactions: {},
                is_deleted: false,
                is_read: false,
                reply_to: msg.reply_to ?? null,
                duration_ms: msg.duration_ms ?? null,
              });
              // Strip the heavy base64 blob before keeping the message in memory.
              const memoryMsg: WsMessage = {
                ...msg,
                file_uri: localFileUri,
              };
              delete (memoryMsg as { audio_b64?: string }).audio_b64;
              delete (memoryMsg as { image_b64?: string }).image_b64;
              s.messages = [...s.messages, memoryMsg];
              notifyListeners(roomId, s);
              try {
                useAppStore.getState().setRoomLastMessage(roomId, {
                  id: msg.id,
                  content: msg.content ?? '',
                  created_at: msg.created_at,
                  sender: msg.sender,
                  sender_id: msg.sender_id,
                });
              } catch {}
            }
            // Ack non-own messages so the server clears the PendingDelivery
            if (!isOwn && s.ws?.readyState === WebSocket.OPEN && s.authenticated) {
              try {
                s.ws.send(JSON.stringify({
                  type: 'message_ack',
                  message_id: msg.id,
                  sender_id: msg.sender_id,
                  room_id: roomId,
                }));
              } catch { /* ignore */ }
            }
          })().catch(() => { /* ignore DB errors */ });
        }
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
    if (appState !== 'active') return;
    // Debounce: notificationWsManager fires on the same AppState event.
    // Stagger by 60ms so only one manager reconnects at a time.
    if (_appStateDebouncing) return;
    _appStateDebouncing = true;
    setTimeout(() => { _appStateDebouncing = false; }, 60);

    rooms.forEach((s, roomId) => {
      if (s.listeners.size > 0 && s.status !== 'connected') {
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
  console.log('[ChatWsManager] sendChatMessage called — room:', roomId, '_myUserId:', _myUserId, 'type:', messageType);
  const msgId = generateUUID();
  const createdAt = new Date().toISOString();

  const fileUri = extras?.file_uri ?? null;
  const durationMs = extras?.duration_ms ?? null;
  const audioMime = extras?.audio_mime ?? null;
  const imageMime = extras?.image_mime ?? null;

  // For voice messages, read the recorded file as base64 ONCE here so we can
  // include it in the wire frame and (if needed) outbox-replay reads it again
  // from `file_uri` on retry.
  let audioB64: string | null = null;
  if (messageType === 'voice' && fileUri) {
    try {
      audioB64 = await readAudioAsBase64(fileUri);
    } catch (err) {
      console.warn('[ChatWsManager] failed to read voice file:', err);
    }
  }
  // Same pattern for images.
  let imageB64: string | null = null;
  if (messageType === 'image' && fileUri) {
    try {
      imageB64 = await readFileAsBase64(fileUri);
    } catch (err) {
      console.warn('[ChatWsManager] failed to read image file:', err);
    }
  }

  const s = rooms.get(roomId);

  // Optimistically add to in-memory list IMMEDIATELY so UI updates without waiting for SQLite
  if (_myUserId !== null && s) {
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
    console.log('[ChatWsManager] optimistic update — listeners:', s.listeners.size, 'total msgs:', s.messages.length);
    notifyListeners(roomId, s);
  } else {
    console.warn('[ChatWsManager] skipped optimistic update — _myUserId:', _myUserId, 'roomState:', !!s);
  }

  // Persist locally in the background (so it's never lost on reconnect)
  if (_myUserId !== null) {
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
  }

  if (s?.ws?.readyState === WebSocket.OPEN && s.authenticated) {
    try {
      s.ws.send(JSON.stringify({
        id: msgId,
        message: content,
        message_type: messageType,
        created_at: createdAt,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(durationMs != null ? { duration_ms: durationMs } : {}),
        ...(audioB64 ? { audio_b64: audioB64, audio_mime: audioMime ?? 'audio/m4a' } : {}),
        ...(imageB64 ? { image_b64: imageB64, image_mime: imageMime ?? 'image/jpeg' } : {}),
      }));
    } catch { /* message is saved locally, will be flushed on reconnect */ }
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
      if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) {
        let audioB64: string | null = null;
        let imageB64: string | null = null;
        if (msg.type === 'voice' && msg.file_uri) {
          try { audioB64 = await readAudioAsBase64(msg.file_uri); } catch {}
        } else if (msg.type === 'image' && msg.file_uri) {
          try { imageB64 = await readFileAsBase64(msg.file_uri); } catch {}
        }
        s.ws.send(JSON.stringify({
          id: msg.id,
          message: msg.content,
          message_type: msg.type,
          created_at: msg.created_at,
          ...(msg.reply_to ? { reply_to: msg.reply_to } : {}),
          ...(msg.duration_ms != null ? { duration_ms: msg.duration_ms } : {}),
          ...(audioB64 ? { audio_b64: audioB64, audio_mime: 'audio/m4a' } : {}),
          ...(imageB64 ? { image_b64: imageB64, image_mime: 'image/jpeg' } : {}),
        }));
      }
    }
  } catch { /* ignore */ }
}

/**
 * On every auth_ok, re-send any messages from this room that have never been
 * acknowledged by anyone (no delivery_tracking entry with delivered=1).
 * This handles the case where all recipients were offline when the message was
 * originally sent, so the server never had a chance to relay it.
 */
async function _retryUndeliveredMessages(roomId: string, s: RoomState): Promise<void> {
  if (_myUserId === null) return;
  try {
    const msgs = await getUndeliveredSentMessages(roomId, _myUserId);
    if (msgs.length === 0) return;
    console.log('[ChatWsManager] retrying', msgs.length, 'undelivered messages in room', roomId);
    for (const msg of msgs) {
      if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) {
        let audioB64: string | null = null;
        let imageB64: string | null = null;
        if (msg.type === 'voice' && msg.file_uri) {
          try { audioB64 = await readAudioAsBase64(msg.file_uri); } catch {}
        } else if (msg.type === 'image' && msg.file_uri) {
          try { imageB64 = await readFileAsBase64(msg.file_uri); } catch {}
        }
        s.ws.send(JSON.stringify({
          id: msg.id,
          message: msg.content,
          message_type: msg.type,
          created_at: msg.created_at,
          ...(msg.reply_to ? { reply_to: msg.reply_to } : {}),
          ...(msg.duration_ms != null ? { duration_ms: msg.duration_ms } : {}),
          ...(audioB64 ? { audio_b64: audioB64, audio_mime: 'audio/m4a' } : {}),
          ...(imageB64 ? { image_b64: imageB64, image_mime: 'image/jpeg' } : {}),
        }));
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
        };
      });
      changed = true;
    }
  }
  if (changed) {
    s.lastMutationAt = Date.now();
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
  if (s?.ws?.readyState === WebSocket.OPEN && s.authenticated) {
    _doFlush(roomId, s, recipientId);
  } else {
    const rs = getOrCreate(roomId);
    if (!rs.pendingFlushes.includes(recipientId)) {
      rs.pendingFlushes.push(recipientId);
    }
    connectRoom(roomId);
  }
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
): void {
  const s = getOrCreate(roomId);
  // Apply to in-memory WS state immediately → triggers notifyListeners → UI re-renders
  // (also writes to SQLite internally via applyMessageChanges)
  _applyUpdatesToState(roomId, s, [{ message_id: messageId, changes }]);
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  s.pendingUpdates.push({ id, message_id: messageId, changes });
  // Persist so it survives an app restart before the WS connects
  queueMessageUpdate(roomId, messageId, changes).catch(() => {});
  // Attempt immediate send
  _flushPendingUpdates(roomId, s);
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
    s.pendingUpdates.push({ id, message_id: msgId, changes: { is_read: true } });
    // Persist to outbox for retry on reconnect
    queueMessageUpdate(roomId, msgId, { is_read: true }).catch(() => {});
    // Mark read locally so loadFromDB filters this message out on the next reload
    applyMessageChanges(msgId, { is_read: true }).catch(() => {});
  }
  // Single WS send for the whole batch
  _flushPendingUpdates(roomId, s);
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
  if (!s) return { messages: [], readIds: new Set(), pendingIds: new Set(), deliveredIds: new Set(), status: 'disconnected', reconnectCount: 0, lastMutationAt: 0 };
  return { messages: s.messages, readIds: s.readIds, pendingIds: s.pendingIds, deliveredIds: s.deliveredIds, status: s.status, reconnectCount: s.reconnectCount, lastMutationAt: s.lastMutationAt };
}

/**
 * Merge message IDs into the deliveredIds set
 * (called when message_delivery_ack arrives via the notification channel).
 */
export function markIdsAsDeliveredInRoom(roomId: string, ids: string[]): void {
  const s = rooms.get(roomId);
  if (!s || ids.length === 0) return;
  s.deliveredIds = new Set([...s.deliveredIds, ...ids]);
  notifyListeners(roomId, s);
}

/**
 * Inject a received message into the room's in-memory state from an external source
 * (e.g. notification WS relay). No-op if the room has no active listeners.
 */
export function injectReceivedMessage(roomId: string, msg: WsMessage): void {
  const s = rooms.get(roomId);
  if (!s || s.listeners.size === 0) return;
  if (s.messages.some((m) => m.id === msg.id)) return; // dedup
  s.messages = [...s.messages, msg];
  notifyListeners(roomId, s);
}

/**
 * Broadcast a typing indicator to the room.
 * Caller is responsible for throttling (e.g. once per keystroke burst).
 */
export function sendTyping(roomId: string, isTyping: boolean): void {
  const s = rooms.get(roomId);
  if (!s || s.ws?.readyState !== WebSocket.OPEN || !s.authenticated) return;
  try {
    s.ws.send(JSON.stringify({ type: 'typing', is_typing: isTyping }));
  } catch { /* ignore */ }
}
