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

const WS_BASE = BASE_URL.replace(/^http/, 'ws');

/* ---- Timing constants ---- */
const INITIAL_RECONNECT_MS = 300;
const MAX_RECONNECT_MS = 60_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const CONNECTION_TIMEOUT_MS = 8_000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000; // refresh when <2 min left
const AUTH_TIMEOUT_MS = 5_000;
const MAX_READ_RECEIPT_QUEUE = 200;

/* ---- Public types ---- */
export interface WsMessage {
  id: string;
  sender: string;
  sender_id: number;
  content: string;
  message_type: string;
  created_at: string;
  is_read?: boolean;
}

export type RoomStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface RoomSnapshot {
  messages: WsMessage[];
  readIds: Set<string>;
  status: RoomStatus;
  reconnectCount: number;
}

type RoomListener = (snapshot: RoomSnapshot) => void;

/* ---- Internal room state ---- */
interface RoomState {
  ws: WebSocket | null;
  connecting: boolean;
  connectingStartedAt: number;
  authenticated: boolean;
  status: RoomStatus;
  messages: WsMessage[];
  readIds: Set<string>;
  readReceiptQueue: string[];
  reconnectDelay: number;
  reconnectCount: number;
  hasConnectedBefore: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  connectionTimeoutTimer: ReturnType<typeof setTimeout> | null;
  authTimeoutTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<RoomListener>;
}

/* ---- Module-level state (survives React unmounts) ---- */
const rooms = new Map<string, RoomState>();

let _netInfoUnsub: (() => void) | null = null;
let _appStateUnsub: { remove: () => void } | null = null;
let _hasInternet = true;
let _appStateDebouncing = false; // prevent duplicate fires vs notificationWsManager

/* ================================================================== */
/*  Internal helpers                                                   */
/* ================================================================== */

function createRoomState(): RoomState {
  return {
    ws: null,
    connecting: false,
    connectingStartedAt: 0,
    authenticated: false,
    status: 'disconnected',
    messages: [],
    readIds: new Set(),
    readReceiptQueue: [],
    reconnectDelay: INITIAL_RECONNECT_MS,
    reconnectCount: 0,
    hasConnectedBefore: false,
    reconnectTimer: null,
    pingTimer: null,
    pongTimer: null,
    connectionTimeoutTimer: null,
    authTimeoutTimer: null,
    listeners: new Set(),
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
    status: state.status,
    reconnectCount: state.reconnectCount,
  };
  state.listeners.forEach((fn) => { try { fn(snapshot); } catch { /* ignore */ } });
}

function setStatus(roomId: string, state: RoomState, status: RoomStatus) {
  state.status = status;
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

function flushReadQueue(s: RoomState) {
  if (s.readReceiptQueue.length === 0) return;
  if (s.ws?.readyState !== WebSocket.OPEN || !s.authenticated) return;
  try {
    s.ws.send(JSON.stringify({ type: 'mark_read', message_ids: s.readReceiptQueue }));
    console.log('[ChatWsManager] flushed', s.readReceiptQueue.length, 'queued read receipts');
    s.readReceiptQueue = [];
  } catch { /* ignore */ }
}

function scheduleReconnect(roomId: string, s: RoomState) {
  if (s.listeners.size === 0) return; // no subscribers — skip
  if (s.reconnectTimer) return;       // already scheduled
  if (!_hasInternet) { setStatus(roomId, s, 'disconnected'); return; }

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
        const payload = JSON.parse(atob(tokens.access.split('.')[1]));
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

async function connectRoom(roomId: string): Promise<void> {
  const s = getOrCreate(roomId);

  if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) return;

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

    socket.onopen = async () => {
      if (s.connectionTimeoutTimer) {
        clearTimeout(s.connectionTimeoutTimer);
        s.connectionTimeoutTimer = null;
      }
      console.log('[ChatWsManager] socket open room', roomId, '— sending auth');

      // Refresh token at the exact moment of auth (avoids expiry race)
      const freshToken = await refreshTokenIfNeeded();
      if (!freshToken || s.ws !== socket) {
        socket.close();
        return;
      }
      try {
        socket.send(JSON.stringify({ type: 'auth', token: freshToken }));
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
          // Reset backoff ONLY on successful auth
          s.reconnectDelay = INITIAL_RECONNECT_MS;
          if (s.hasConnectedBefore) {
            s.reconnectCount += 1;
          }
          s.hasConnectedBefore = true;
          setStatus(roomId, s, 'connected');
          startPing(roomId, s);
          flushReadQueue(s);
          return;
        }

        if (msgType === 'auth_failed') {
          console.warn('[ChatWsManager] auth_failed room', roomId);
          closeWs(s);
          setStatus(roomId, s, 'disconnected');
          return;
        }

        // Drop all messages until auth handshake completes
        if (!s.authenticated) return;

        // ---- Keep-alive ----
        if (msgType === 'pong') {
          if (s.pongTimer) { clearTimeout(s.pongTimer); s.pongTimer = null; }
          return;
        }

        // ---- Read receipt broadcast ----
        if (msgType === 'messages_read') {
          const ids: string[] = data.message_ids ?? [];
          if (ids.length > 0) {
            s.readIds = new Set([...s.readIds, ...ids]);
            notifyListeners(roomId, s);
          }
          return;
        }

        // ---- Chat message ----
        const msg: WsMessage = { ...data, is_read: false };
        if (msg.id && msg.sender_id !== undefined) {
          s.messages = [...s.messages, msg];
          notifyListeners(roomId, s);
        }
      } catch { /* ignore malformed frames */ }
    };

    socket.onclose = (ev) => {
      if (s.connectionTimeoutTimer) { clearTimeout(s.connectionTimeoutTimer); s.connectionTimeoutTimer = null; }
      if (s.authTimeoutTimer) { clearTimeout(s.authTimeoutTimer); s.authTimeoutTimer = null; }
      console.log('[ChatWsManager] closed room', roomId, ev.code);
      const wasCurrentSocket = s.ws === socket;
      if (wasCurrentSocket) {
        s.ws = null;
        s.connecting = false;
        s.authenticated = false;
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
 * Returns an unsubscribe function that does NOT close the WebSocket —
 * the connection stays alive so it is ready when the user returns.
 */
export function subscribeRoom(roomId: string, listener: RoomListener): () => void {
  ensureNetworkListener();
  ensureAppStateListener();
  const s = getOrCreate(roomId);
  s.listeners.add(listener);
  // Connect if not already open
  if (!s.ws || s.ws.readyState !== WebSocket.OPEN || !s.authenticated) {
    connectRoom(roomId);
  }
  return () => { s.listeners.delete(listener); };
}

/**
 * Forcefully disconnect a room and remove it from the manager.
 * Use on logout or when the room is permanently left.
 */
export function disconnectRoom(roomId: string): void {
  const s = rooms.get(roomId);
  if (!s) return;
  clearTimers(s);
  closeWs(s);
  rooms.delete(roomId);
}

/** Disconnect all rooms. Call on logout. */
export function disconnectAllRooms(): void {
  rooms.forEach((_, id) => disconnectRoom(id));
  if (_netInfoUnsub) { _netInfoUnsub(); _netInfoUnsub = null; }
  if (_appStateUnsub) { _appStateUnsub.remove(); _appStateUnsub = null; }
}

/**
 * Send a chat message. Returns false if the socket is not ready.
 */
export function sendChatMessage(roomId: string, content: string, messageType = 'text'): boolean {
  const s = rooms.get(roomId);
  if (!s?.ws || s.ws.readyState !== WebSocket.OPEN || !s.authenticated) return false;
  try {
    s.ws.send(JSON.stringify({ message: content, message_type: messageType }));
    return true;
  } catch { return false; }
}

/**
 * Send read receipts. Queues them if the socket is not open so they
 * are delivered as soon as the connection is re-established.
 */
export function markRoomAsRead(roomId: string, messageIds?: string[]): void {
  const s = rooms.get(roomId);
  if (!s) return;

  if (s.ws?.readyState === WebSocket.OPEN && s.authenticated) {
    try {
      s.ws.send(JSON.stringify({ type: 'mark_read', message_ids: messageIds ?? [] }));
      return;
    } catch { /* fall through to queue */ }
  }

  // Queue for next connection
  const ids = messageIds ?? [];
  if (ids.length > 0) {
    s.readReceiptQueue.push(...ids);
    if (s.readReceiptQueue.length > MAX_READ_RECEIPT_QUEUE) {
      s.readReceiptQueue = s.readReceiptQueue.slice(-MAX_READ_RECEIPT_QUEUE);
    }
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
  if (!s) return { messages: [], readIds: new Set(), status: 'disconnected', reconnectCount: 0 };
  return { messages: s.messages, readIds: s.readIds, status: s.status, reconnectCount: s.reconnectCount };
}
