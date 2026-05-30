/* ------------------------------------------------------------------ */
/*  Notification WebSocket Manager (singleton)                         */
/*                                                                     */
/*  Manages the /ws/notifications/ WebSocket at MODULE level so it     */
/*  survives React component unmounts (e.g. when the Activity is       */
/*  destroyed but the foreground service keeps the process alive).     */
/*                                                                     */
/*  SELF-HEALING: If the module is re-loaded in a fresh HeadlessJS     */
/*  context, ensureWsAlive() will read stored credentials from         */
/*  AsyncStorage and restore the connection automatically.             */
/* ------------------------------------------------------------------ */

import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { getTokens, saveTokens, BASE_URL } from './api';
import { connectRoom, flushOutboxForRecipient, injectReceivedMessage, markIdsAsReadInRoom, applyRemoteMessageUpdates } from './chatWsManager';
import { saveMessage, messageExists, markDelivered } from './localMessageStore';
import { useAppStore } from '../store/appStore';
// NOTE: checkPendingNotifications is imported lazily to avoid circular init

const WS_BASE = BASE_URL.replace(/^http/, 'ws');
const USER_ID_KEY = '@axonic_ws_userid';

/* ---- Types ---- */
export interface NotificationPayload {
  event: string;
  call_id?: string;
  caller?: string;
  caller_id?: number;
  callee?: string;
  callee_id?: number;
  call_type?: 'voice' | 'video';
  room_name?: string;
  room_id?: string;
  action?: string;
  signal_type?: string;
  data?: any;
  from_user_id?: number;
  from_username?: string;
  sender?: string;
  sender_id?: number;
  content?: string;
  message_id?: string;
  created_at?: string;
  [key: string]: any;
}

export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'no-internet';

type EventListener = (payload: NotificationPayload) => void;
type StatusListener = (status: ConnectionStatus) => void;

/* ---- Module-level state (survives React unmounts) ---- */
let ws: WebSocket | null = null;
let connecting = false;
let _userId: number | null = null;
let _authenticated = false;
let _status: ConnectionStatus = 'disconnected';
let _reconnectDelay = 1500;
let _hasInternet = true;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let _hasConnectedBefore = false;
let _wsAuthenticated = false; // received auth_ok from server
let _connectingStartedAt = 0; // timestamp to detect stuck connecting state
let _lastReportedAppState: 'active' | 'background' | null = null;
let _close1011Count = 0;
let _suspendReconnectUntil = 0;

const INITIAL_RECONNECT_MS = 1500;
const MAX_RECONNECT_MS = 60_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 15_000;
const CONNECTION_TIMEOUT_MS = 8_000;
const AUTH_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000; // refresh JWT only when <2 min left
// Server is now hardened with try/except in NotificationConsumer.receive, so it's
// safe to inform the server of our app state. The server uses this to decide whether
// the user is "online" (foreground) or merely "connected" (background).
const SEND_APP_STATE_ON_AUTH_OK = true;
const WS_1011_COOLDOWN_MS = 30_000;

let authTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let _connectedAt = 0;

const eventListeners = new Set<EventListener>();
const statusListeners = new Set<StatusListener>();

/* ================================================================== */
/*  Internal helpers                                                   */
/* ================================================================== */

function setStatus(s: ConnectionStatus) {
  _status = s;
  // Mirror into global store so any component/service can observe.
  try { useAppStore.getState().setNotifWsStatus(s); } catch {}
  statusListeners.forEach((fn) => {
    try { fn(s); } catch {}
  });
}

function clearAllTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
  if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
  if (authTimeoutTimer) { clearTimeout(authTimeoutTimer); authTimeoutTimer = null; }
}

function closeWs() {
  if (ws) {
    ws.onopen = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  _wsAuthenticated = false;
}

function startPing() {
  if (pingTimer) clearInterval(pingTimer);
  if (pongTimer) clearTimeout(pongTimer);

  pingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }

      if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }

      pongTimer = setTimeout(() => {
        console.warn('[WsManager] pong timeout — connection stale');
        closeWs();
        setStatus('reconnecting');
        scheduleReconnect();
      }, PONG_TIMEOUT_MS);
    }
  }, PING_INTERVAL_MS);
}

/**
 * Send current app state (active/background) to the server.
 * This lets the server distinguish "online" (foreground) from
 * "connected" (WS alive but app in background).
 * Only sends after auth_ok is received.
 */
function _sendAppState(state: 'active' | 'background') {
  // Avoid re-sending the same state on every reconnect. This reduces
  // backend churn and prevents reconnect loops if the server app_state
  // handler is unstable under repeated identical updates.
  if (_lastReportedAppState === state) return;
  if (ws?.readyState === WebSocket.OPEN && _wsAuthenticated) {
    try {
      ws.send(JSON.stringify({ type: 'app_state', state }));
      _lastReportedAppState = state;
      console.log('[WsManager] sent app_state:', state);
    } catch { /* ignore */ }
  }
}

function scheduleReconnect() {
  if (!_authenticated) return;
  if (reconnectTimer) return; // already scheduled
  if (connecting) return;
  if (ws?.readyState === WebSocket.OPEN && _wsAuthenticated) return;

  const now = Date.now();
  if (_suspendReconnectUntil > now) {
    const wait = _suspendReconnectUntil - now;
    if (!reconnectTimer) {
      console.warn('[WsManager] reconnect suspended for', wait, 'ms after repeated 1011');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (_authenticated && _hasInternet) connectWs();
      }, wait);
    }
    return;
  }

  const delay = _reconnectDelay;
  console.log(`[WsManager] reconnect in ${delay}ms`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (_authenticated && _hasInternet) {
      connectWs();
    }
  }, delay);

  _reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_MS);
}

async function connectWs() {
  if (!_userId || !_authenticated) return;
  if (_suspendReconnectUntil > Date.now()) return;
  if (ws?.readyState === WebSocket.OPEN && _wsAuthenticated) return;
  if (ws?.readyState === WebSocket.OPEN && !_wsAuthenticated) return;

  // Guard against stuck connecting state (>8s)
  if (connecting) {
    const elapsed = Date.now() - _connectingStartedAt;
    if (elapsed < 8_000) return; // still within timeout, let it finish
    console.warn('[WsManager] connecting stuck for', elapsed, 'ms — resetting');
    connecting = false;
  }

  connecting = true;
  _connectingStartedAt = Date.now();

  if (!_hasInternet) {
    setStatus('no-internet');
    connecting = false;
    return;
  }

  setStatus(_status === 'disconnected' || _status === 'no-internet' ? 'connecting' : 'reconnecting');

  // Only refresh JWT if it's close to expiring (saves 1-3s on most reconnects)
  try {
    const currentTokens = await getTokens();
    if (currentTokens?.access && currentTokens?.refresh) {
      let needsRefresh = false;
      try {
        // JWT payload is base64url; normalise for atob.
        const payloadB64 = currentTokens.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(payloadB64));
        const expiresAt = payload.exp * 1000;
        needsRefresh = expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS;
      } catch {
        needsRefresh = true; // can't decode → refresh to be safe
      }

      if (needsRefresh) {
        const { default: axios } = require('axios');
        const controller = new AbortController();
        const refreshTimeout = setTimeout(() => controller.abort(), 5_000);
        try {
          const { data } = await axios.post(
            `${BASE_URL}/api/users/token/refresh/`,
            { refresh: currentTokens.refresh },
            { signal: controller.signal },
          );
          await saveTokens(data.access, data.refresh ?? currentTokens.refresh);
          console.log('[WsManager] JWT refreshed (was near expiry)');
        } finally {
          clearTimeout(refreshTimeout);
        }
      }
    }
  } catch (err: any) {
    console.warn('[WsManager] token refresh failed:', err?.message ?? err);
  }

  const tokens = await getTokens();
  if (!tokens?.access) {
    connecting = false;
    setStatus('disconnected');
    return;
  }

  closeWs();
  clearAllTimers();

  // Connect WITHOUT token in URL — auth sent as first message after open
  const url = `${WS_BASE}/ws/notifications/`;
  console.log('[WsManager] connecting…');

  try {
    const socket = new WebSocket(url);
    ws = socket;

    connectTimeoutTimer = setTimeout(() => {
      if (ws === socket && connecting) {
        console.warn('[WsManager] connection timeout — retrying');
        connecting = false;
        closeWs();
        if (_authenticated) {
          setStatus('reconnecting');
          scheduleReconnect();
        }
      }
    }, CONNECTION_TIMEOUT_MS);

    socket.onopen = () => {
      if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
      console.log('[WsManager] socket open — sending auth');
      connecting = false;
      // CRITICAL: use the closure `socket` reference, not the module-level `ws`,
      // because `ws` can be reassigned/closed by a competing connect/closeWs() call
      // before this callback fires, which would silently drop the auth frame and
      // trigger a server-side auth-timeout reconnect loop.
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'auth', token: tokens.access }));
        }
      } catch (err) {
        console.warn('[WsManager] failed to send auth frame:', err);
      }

      authTimeoutTimer = setTimeout(() => {
        if (ws === socket && !_wsAuthenticated) {
          console.warn('[WsManager] auth_ok timeout — retrying');
          closeWs();
          setStatus('reconnecting');
          scheduleReconnect();
        }
      }, AUTH_TIMEOUT_MS);
    };

    socket.onmessage = (e) => {
      try {
        const payload: NotificationPayload = JSON.parse(e.data);

        // ---- Pending deliveries bootstrap can arrive before auth_ok ----
        if ((payload as any).type === 'pending_deliveries') {
          const deliveries: Array<{ room_id: string }> = (payload as any).deliveries ?? [];
          for (const d of deliveries) {
            if (d.room_id) connectRoom(d.room_id);
          }
          // Continue; auth_ok may follow in the same burst.
        }

        // ---- Post-connect authentication ----
        if ((payload as any).type === 'auth_ok') {
          console.log('[WsManager] ✓ authenticated');
          if (authTimeoutTimer) { clearTimeout(authTimeoutTimer); authTimeoutTimer = null; }
          _wsAuthenticated = true;
          _connectedAt = Date.now();
          setStatus('connected');
          try { useAppStore.getState().setNotifWsAuthenticated(true); } catch {}
          startPing();
          if (SEND_APP_STATE_ON_AUTH_OK) {
            const currentAppState = AppState.currentState === 'active' ? 'active' : 'background';
            _sendAppState(currentAppState as 'active' | 'background');
          }
          if (_hasConnectedBefore) {
            console.log('[WsManager] reconnected — checking missed notifications');
            try {
              const { checkPendingNotifications } = require('./backgroundNotificationService');
              checkPendingNotifications().catch(() => {});
            } catch { /* ignore */ }
          }
          _hasConnectedBefore = true;
          return;
        }

        if ((payload as any).type === 'auth_failed') {
          console.warn('[WsManager] auth_failed — closing');
          closeWs();
          setStatus('disconnected');
          return;
        }

        if ((payload as any).type === 'server_error') {
          console.warn('[WsManager] server_error op=', (payload as any).op ?? 'unknown');
          return;
        }

        // Drop all messages until auth completes
        if (!_wsAuthenticated) return;

        // ---- Peer sync: another session of this user can share its message history ----
        if ((payload as any).type === 'peer_sync_available') {
          // TODO Phase 8: query localMessageStore for each room's latest timestamp and send request_sync
          return;
        }

        // Handle pong
        if (payload.event === 'pong' || payload.type === 'pong') {
          if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
          return;
        }

        console.log('[WsManager] event:', payload.event, payload.call_id ?? '');

        // ---- receiver_ready: an offline user just connected — flush our outbox for them ----
        if (payload.event === 'receiver_ready' && payload.room_id && payload.user_id) {
          flushOutboxForRecipient(String(payload.room_id), payload.user_id as number);
          // Don't return — let listeners know too
        }

        // ---- message_update: unified mutation relay (is_read, reactions, is_deleted, …) ----
        if (payload.event === 'message_update' && payload.room_id && payload.updates) {
          applyRemoteMessageUpdates(
            String(payload.room_id),
            payload.updates as Array<{ message_id: string; changes: Record<string, unknown> }>,
          );
          // Fall through — notify listeners so ChatRoomScreen can react if mounted
        }

        // ---- messages_read (legacy, kept for server backward-compat) ----
        if (payload.event === 'messages_read' && payload.room_id && payload.message_ids) {
          markIdsAsReadInRoom(String(payload.room_id), payload.message_ids as string[]);
          // Fall through — notify listeners so ChatRoomScreen can also update
        }

        // ---- message_delivery_ack: recipient confirmed they stored our message ----
        if (payload.event === 'message_delivery_ack' && payload.message_id && payload.by_user_id) {
          markDelivered(String(payload.message_id), payload.by_user_id as number).catch(() => {});
          // Fall through — notify listeners so the chat UI can update the delivery tick
        }

        // ---- typing relay via notification channel ----
        // Lets the chat list show "typing…" even for rooms whose chat-room WS
        // is not currently open. Pure ephemeral mirror — no DB, no notification.
        if (payload.event === 'typing' && payload.room_id && payload.sender_id) {
          try {
            useAppStore.getState().setRoomTyping(
              String(payload.room_id),
              Number(payload.sender_id),
              String(payload.sender ?? ''),
              Boolean(payload.is_typing),
            );
          } catch {}
          // Skip local-notification path entirely for typing events
          return;
        }

        // ---- new_message via notification channel (user not in chat room WS) ----
        if (payload.event === 'new_message' && payload.message_id && payload.sender_id !== undefined) {
          (async () => {
            const exists = await messageExists(String(payload.message_id));
            const replyTo = (payload.reply_to ?? null) as
              | { id: string; sender_name: string; content: string; type?: string }
              | null;
            const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null;
            const incomingAudioB64 = typeof payload.audio_b64 === 'string' ? payload.audio_b64 : null;
            const incomingAudioMime = typeof payload.audio_mime === 'string' ? payload.audio_mime : null;
            const incomingImageB64 = typeof payload.image_b64 === 'string' ? payload.image_b64 : null;
            const incomingImageMime = typeof payload.image_mime === 'string' ? payload.image_mime : null;
            const messageType = String(payload.message_type ?? 'text');
            let localFileUri: string | null = null;
            if (messageType === 'voice' && incomingAudioB64) {
              try {
                const { saveIncomingAudio } = await import('./voiceMessageUtils');
                localFileUri = await saveIncomingAudio(String(payload.message_id), incomingAudioB64, incomingAudioMime);
              } catch (err) {
                console.warn('[NotifWS] failed to save incoming voice audio:', err);
              }
            } else if (messageType === 'image' && incomingImageB64) {
              try {
                const { saveIncomingImage } = await import('./voiceMessageUtils');
                localFileUri = await saveIncomingImage(String(payload.message_id), incomingImageB64, incomingImageMime);
              } catch (err) {
                console.warn('[NotifWS] failed to save incoming image:', err);
              }
            }
            const wsMsg = {
              id: String(payload.message_id),
              sender: String(payload.sender || payload.from_username || ''),
              sender_id: payload.sender_id as number,
              content: String(payload.content ?? ''),
              message_type: messageType,
              created_at: String(payload.created_at ?? new Date().toISOString()),
              is_read: false,
              reply_to: replyTo,
              file_uri: localFileUri,
              duration_ms: durationMs,
            };
            if (!exists) {
              await saveMessage({
                id: wsMsg.id,
                room_id: String(payload.room_id ?? ''),
                sender_id: wsMsg.sender_id,
                sender_name: wsMsg.sender,
                content: wsMsg.content ?? null,
                type: wsMsg.message_type,
                file_uri: localFileUri,
                created_at: wsMsg.created_at,
                is_mine: false,
                reactions: {},
                is_deleted: false,
                is_read: false,
                reply_to: replyTo,
                duration_ms: durationMs,
              });
            }
            // Inject into chatWsManager state if the room screen is open
            injectReceivedMessage(String(payload.room_id ?? ''), wsMsg);
            // Bump unread counter in the global store unless the user is currently viewing this room.
            try {
              const store = useAppStore.getState();
              const rid = String(payload.room_id ?? '');
              if (rid) {
                store.setRoomLastMessage(rid, {
                  id: wsMsg.id,
                  content: wsMsg.content ?? '',
                  created_at: wsMsg.created_at,
                  sender: wsMsg.sender,
                  sender_id: wsMsg.sender_id,
                });
                // Skip unread bump if the user is currently viewing this room OR muted it.
                if (store.activeRoomId !== rid && !store.mutedRooms[rid]) {
                  store.incrementRoomUnread(rid, 1);
                }
              }
            } catch {}
            // Ack receipt so server deletes the PendingDelivery record
            if (ws?.readyState === WebSocket.OPEN && _wsAuthenticated) {
              ws.send(JSON.stringify({
                type: 'message_ack',
                message_id: payload.message_id,
                sender_id: payload.sender_id,
                room_id: String(payload.room_id ?? ''),
              }));
            }
          })().catch(() => {});
          // Fall through — local notification and listeners still receive the event
        }

        // When app is in background the WS is still alive (ForegroundService keeps it connected),
        // but in-app UI components are not rendered. FCM may race with app_state reporting.
        // Solution: show a local notification from the WS message when not in foreground.
        // When foreground, in-app components (MessageNotificationListener, IncomingCallListener)
        // handle display — so we skip the local notification to avoid duplicates.
        //
        // Source of truth for "is the app visible" + "is the user inside this room"
        // is the global app store, mirrored from AppState by AppLifecycleBridge.
        const storeState = (() => {
          try { return useAppStore.getState(); } catch { return null; }
        })();
        const isAppActive = storeState ? storeState.appLifecycle === 'active' : (AppState.currentState === 'active');
        const isViewingThisRoom =
          payload.event === 'new_message' &&
          storeState?.activeRoomId === String(payload.room_id ?? '');

        if (!isAppActive && !isViewingThisRoom) {
          // Honor per-room mute: skip local notifications for muted rooms entirely.
          const isMutedRoom =
            payload.event === 'new_message' &&
            !!storeState?.mutedRooms[String(payload.room_id ?? '')];
          if (isMutedRoom) {
            // fall through — listeners still see the event; we just don't surface a banner
          } else {
          try {
            const {
              showMessageNotification,
              showCallNotification,
            } = require('./pushNotificationService');

            if (
              payload.event === 'new_message' &&
              (payload.sender || payload.from_username) &&
              payload.content
            ) {
              showMessageNotification({
                senderName: payload.sender || payload.from_username || 'New message',
                content: payload.content,
                roomId: String(payload.room_id ?? ''),
                roomName: payload.room_name || payload.sender || payload.from_username || '',
              }).catch(() => {});
            } else if (
              payload.event === 'incoming_call' &&
              payload.caller &&
              payload.call_id
            ) {
              showCallNotification({
                callerName: payload.caller,
                callType: payload.call_type ?? 'voice',
                callId: payload.call_id,
                callerId: payload.caller_id ?? 0,
                roomName: payload.room_name ?? '',
              }).catch(() => {});
            }
          } catch { /* ignore — pushNotificationService unavailable */ }
          }
        }

        // Dispatch to subscribers (in-app logic: toasts, navigation, badges, etc.)
        eventListeners.forEach((fn) => {
          try { fn(payload); } catch (err) { console.warn('[WsManager] listener error:', err); }
        });
      } catch { /* ignore malformed */ }
    };

    socket.onclose = (ev) => {
      const wasCurrentSocket = ws === socket;
      const connectedMs = _connectedAt ? Date.now() - _connectedAt : 0;
      if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
      if (authTimeoutTimer) { clearTimeout(authTimeoutTimer); authTimeoutTimer = null; }
      console.log('[WsManager] closed', ev.code, ev.reason);
      if (wasCurrentSocket) {
        connecting = false;
        _wsAuthenticated = false;
        ws = null;
        if (ev.code === 1011) {
          _close1011Count += 1;
          // Slow down immediately on first server internal-error close.
          _reconnectDelay = Math.max(_reconnectDelay, 5000);
          if (_close1011Count >= 2) {
            _suspendReconnectUntil = Date.now() + WS_1011_COOLDOWN_MS;
          }
        } else {
          _close1011Count = 0;
          _suspendReconnectUntil = 0;
        }
        try {
          const store = useAppStore.getState();
          store.setNotifWsClose(ev.code);
          store.setNotifWsSuspendedUntil(_suspendReconnectUntil);
        } catch {}
        if (connectedMs >= 10_000) {
          _reconnectDelay = INITIAL_RECONNECT_MS;
          _close1011Count = 0;
          _suspendReconnectUntil = 0;
        }
        _connectedAt = 0;
      }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }

      if (wasCurrentSocket && _authenticated) {
        setStatus(_hasInternet ? 'reconnecting' : 'no-internet');
        scheduleReconnect();
      }
    };

    socket.onerror = (err: any) => {
      // The RN WebSocket "error" event is a generic Event with no useful
      // detail — onclose fires right after with the real reason/code and
      // handles the reconnect. Just log a short line instead of dumping
      // the entire event object.
      const url = err?.target?.url ?? err?.currentTarget?.url ?? '';
      console.warn('[WsManager] socket error (will reconnect via onclose)', url);
      // onclose fires after onerror → reconnect handled there
      connecting = false;
      // onclose fires after onerror → reconnect handled there
    };
  } catch (err) {
    console.warn('[WsManager] connect exception', err);
    connecting = false;
    if (_authenticated) {
      setStatus('reconnecting');
      scheduleReconnect();
    }
  }
}

/* ================================================================== */
/*  Network change listener (module-level, runs even without React)    */
/* ================================================================== */

let _netInfoUnsub: (() => void) | null = null;

function startNetworkListener() {
  if (_netInfoUnsub) return;
  _netInfoUnsub = NetInfo.addEventListener((state) => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    const wasOffline = !_hasInternet;
    _hasInternet = online;

    if (!_authenticated) return;

    if (!online) {
      setStatus('no-internet');
      closeWs();
      clearAllTimers();
    } else if (wasOffline && online) {
      console.log('[WsManager] internet restored — reconnecting');
      _reconnectDelay = INITIAL_RECONNECT_MS;
      connectWs();
    }
  });
}

function stopNetworkListener() {
  if (_netInfoUnsub) {
    _netInfoUnsub();
    _netInfoUnsub = null;
  }
}

/* ================================================================== */
/*  AppState listener — reconnect on foreground                        */
/* ================================================================== */

let _appStateUnsub: { remove: () => void } | null = null;

function startAppStateListener() {
  if (_appStateUnsub) return;
  _appStateUnsub = AppState.addEventListener('change', (state) => {
    if (!_authenticated) return;

    // Report app state to server so it can distinguish online vs connected
    const appState = state === 'active' ? 'active' : 'background';
    _sendAppState(appState);

    if (state === 'active') {
      if (_status !== 'connected') {
        console.log('[WsManager] app foregrounded — reconnecting');
        _reconnectDelay = INITIAL_RECONNECT_MS;
        connectWs();
      }
    }
  });
}

function stopAppStateListener() {
  if (_appStateUnsub) {
    _appStateUnsub.remove();
    _appStateUnsub = null;
  }
}

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/**
 * Initialize the WS manager and connect.
 * Call when the user is authenticated.
 * Also persists userId to AsyncStorage so the background keepalive
 * can self-heal in a fresh HeadlessJS context.
 */
export function initWsManager(userId: number): void {
  _userId = userId;
  _authenticated = true;
  _reconnectDelay = INITIAL_RECONNECT_MS;
  // Persist userId so ensureWsAlive can restore in a fresh JS context
  AsyncStorage.setItem(USER_ID_KEY, String(userId)).catch(() => {});
  startNetworkListener();
  startAppStateListener();
  connectWs();
}

/**
 * Tear down the WS manager.
 * Call on logout.
 */
export function destroyWsManager(): void {
  _authenticated = false;
  _userId = null;
  _hasConnectedBefore = false;
  _lastReportedAppState = null;
  _close1011Count = 0;
  _suspendReconnectUntil = 0;
  closeWs();
  clearAllTimers();
  stopNetworkListener();
  stopAppStateListener();
  setStatus('disconnected');
  // Remove persisted userId so background won't auto-reconnect
  AsyncStorage.removeItem(USER_ID_KEY).catch(() => {});
}

/**
 * Subscribe to WS events. Returns an unsubscribe function.
 */
export function subscribeEvents(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => { eventListeners.delete(fn); };
}

/**
 * Subscribe to connection status changes. Returns an unsubscribe function.
 */
export function subscribeStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  // Immediately send current status
  try { fn(_status); } catch {}
  return () => { statusListeners.delete(fn); };
}

/** Get current connection status */
export function getConnectionStatus(): ConnectionStatus {
  return _status;
}

/** Send a WebRTC signal via the WS */
export function sendWsSignal(targetUserId: number, signalType: string, data: any): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'webrtc_signal',
        target_user_id: targetUserId,
        signal_type: signalType,
        data,
      }),
    );
  }
}

/** Force an immediate reconnect */
export function reconnectWsNow(): void {
  clearAllTimers();
  _reconnectDelay = INITIAL_RECONNECT_MS;
  connectWs();
}

/**
 * Called periodically by the foreground service keepalive task.
 * SELF-HEALING: If running in a fresh HeadlessJS context (e.g. after
 * Activity was destroyed), reads stored credentials from AsyncStorage
 * and re-initializes the WS connection automatically.
 */
export async function ensureWsAlive(): Promise<void> {
  // Fast path: already up and running
  if (_authenticated && _userId && ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  if (_suspendReconnectUntil > Date.now()) {
    return;
  }

  // If not initialized, try to self-heal from stored credentials
  if (!_authenticated || !_userId) {
    try {
      const [storedId, tokens] = await Promise.all([
        AsyncStorage.getItem(USER_ID_KEY),
        getTokens(),
      ]);

      if (!storedId || !tokens?.access) {
        // No stored session — user is logged out, nothing to do
        return;
      }

      // Refresh token only if near expiry during self-heal
      try {
        if (tokens.refresh) {
          let needsRefresh = false;
          try {
            const payloadB64 = tokens.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(payloadB64));
            needsRefresh = payload.exp * 1000 - Date.now() < TOKEN_REFRESH_MARGIN_MS;
          } catch {
            needsRefresh = true;
          }
          if (needsRefresh) {
            const { default: axios } = require('axios');
            const controller = new AbortController();
            const refreshTimeout = setTimeout(() => controller.abort(), 5_000);
            try {
              const { data } = await axios.post(
                `${BASE_URL}/api/users/token/refresh/`,
                { refresh: tokens.refresh },
                { signal: controller.signal },
              );
              await saveTokens(data.access, data.refresh ?? tokens.refresh);
              console.log('[WsManager] self-heal: JWT refreshed');
            } finally {
              clearTimeout(refreshTimeout);
            }
          }
        }
      } catch {
        console.warn('[WsManager] self-heal: token refresh failed, using existing');
      }

      console.log('[WsManager] self-healing — restoring from stored credentials');
      _userId = Number(storedId);
      _authenticated = true;
      startNetworkListener();
      startAppStateListener();
    } catch (err) {
      console.warn('[WsManager] self-heal failed:', err);
      return;
    }
  }

  // Now try to connect
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[WsManager] keepalive — WS not open, reconnecting');
    _reconnectDelay = INITIAL_RECONNECT_MS;
    connectWs();
  }
}
