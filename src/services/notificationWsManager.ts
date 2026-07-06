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
import { connectRoom } from './chatWsManager';
import { useAppStore } from '../store/appStore';
import { shouldShowLocalIncomingCallNotification } from './notificationPresentationPolicy';
import { decideLocalIncomingCallNotification } from './notificationPresentationPolicy';
import { flushPendingAcks as flushHttpAckRetryQueue } from './messageAckRetryQueue';
import { reconcileSentDeliveryStatus } from './deliveryReconciler';
import { routeInbound } from './ingressRouter';
import type { InboundResult } from './ingressRouter';
import { classify } from './rrp/envelope';
// NOTE: checkPendingNotifications is imported lazily to avoid circular init

const WS_BASE = BASE_URL.replace(/^http/, 'ws');
const USER_ID_KEY = '@axonic_ws_userid';
const PENDING_ACKS_KEY = '@axonic_pending_acks';

interface QueuedAck {
  message_id: string;
  sender_id: number;
  room_id: string;
}

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
  correlation_id?: string;
  correlationId?: string;
  route_reason?: string;
  routeReason?: string;
  /** Server also queued an FCM/Expo push for this delivery. The WS path defers
   *  the OS banner to that push to avoid double-notifying. */
  push_floor?: boolean;
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
let selfHealTimer: ReturnType<typeof setInterval> | null = null;

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

/**
 * Send a message_ack immediately if the WS is open, otherwise persist it
 * to AsyncStorage so it's flushed on the next successful auth_ok.
 */
/** Is the always-on notification WS connected AND authenticated right now? */
export function isNotifWsReady(): boolean {
  return ws?.readyState === WebSocket.OPEN && _wsAuthenticated;
}

/**
 * Send a raw frame over the always-on notification WS. Returns true if it was
 * handed to the socket, false if the socket is not ready (caller decides how to
 * queue / fall back). The outbound router uses this as its primary transport.
 */
export function sendRawNotif(frame: Record<string, any>): boolean {
  if (!isNotifWsReady() || !ws) return false;
  try {
    ws.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

export async function sendOrQueueMessageAck(ack: QueuedAck): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN && _wsAuthenticated) {
    try {
      ws.send(JSON.stringify({ type: 'message_ack', ...ack }));
      console.log('[WsManager] ack sent immediately', ack.message_id);
      return;
    } catch { /* fall through to queue */ }
  }
  // WS not ready — persist to queue
  try {
    const raw = await AsyncStorage.getItem(PENDING_ACKS_KEY);
    const queue: QueuedAck[] = raw ? JSON.parse(raw) : [];
    // Avoid duplicates
    if (!queue.some((q) => q.message_id === ack.message_id && q.room_id === ack.room_id)) {
      queue.push(ack);
      await AsyncStorage.setItem(PENDING_ACKS_KEY, JSON.stringify(queue));
      console.log('[WsManager] ack queued for later', ack.message_id, '(queue size:', queue.length, ')');
    }
  } catch (err) {
    console.warn('[WsManager] failed to queue ack:', err);
  }
}

async function _flushPendingAcks(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_ACKS_KEY);
    if (!raw) return;
    const queue: QueuedAck[] = JSON.parse(raw);
    if (!queue.length) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || !_wsAuthenticated) return;
    const failed: QueuedAck[] = [];
    for (const ack of queue) {
      try {
        ws.send(JSON.stringify({ type: 'message_ack', ...ack }));
        console.log('[WsManager] flushed queued ack', ack.message_id);
      } catch {
        failed.push(ack);
      }
    }
    if (failed.length) {
      await AsyncStorage.setItem(PENDING_ACKS_KEY, JSON.stringify(failed));
    } else {
      await AsyncStorage.removeItem(PENDING_ACKS_KEY);
    }
  } catch (err) {
    console.warn('[WsManager] _flushPendingAcks failed:', err);
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
        try { useAppStore.getState().setNotifWsInboundAt(Date.now()); } catch {}

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
          try { useAppStore.getState().setNotifWsInboundAt(Date.now()); } catch {}
          startPing();
          // Flush any message acks that were queued while WS was offline (both WS and HTTP retry queues)
          _flushPendingAcks().catch(() => {});
          flushHttpAckRetryQueue().catch(() => {});
          // Catch up on delivery ticks we may have missed while disconnected.
          reconcileSentDeliveryStatus().catch(() => {});
          // RRP sync.digest: advertise the message ids we hold so the peer can
          // detect and request any gaps (best-effort, re-emitted each connect).
          import('./outboundRouter')
            .then((m) => {
              m.emitRoomDigests().catch(() => {});
              // Also ask peers to re-send media we received without its blob
              // (e.g. saved from a push that stripped the base64).
              m.requestIncompleteMedia().catch(() => {});
            })
            .catch(() => {});
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
          if (_authenticated && _hasInternet) {
            setStatus('reconnecting');
            scheduleReconnect();
          } else {
            setStatus('disconnected');
          }
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

        const correlationId = String(payload.correlation_id ?? payload.correlationId ?? '');
        const routeReason = String(payload.route_reason ?? payload.routeReason ?? '');
        console.log('[WsManager] event:', payload.event, payload.call_id ?? '', {
          correlation_id: correlationId,
          route_reason: routeReason,
        });

        // ---- incoming_call ack: mark call invite as received by this session ----
        if (payload.event === 'incoming_call' && payload.call_id) {
          if (ws?.readyState === WebSocket.OPEN && _wsAuthenticated) {
            try {
              ws.send(JSON.stringify({
                type: 'call_invite_ack',
                call_id: String(payload.call_id),
              }));
            } catch { /* ignore */ }
          }
        }

        // ---- RRP: central inbound dispatch for ALL data events ----
        // One router owns the state side effects (persist, dedupe, delivery
        // ticks, read receipts, update apply, typing, outbox flush) regardless
        // of transport. Transport-LOCAL follow-ups that need THIS socket (the
        // message_update_ack) are returned and sent here.
        const rrpType = classify(payload);
        routeInbound(payload, 'ws')
          .then((res: InboundResult) => {
            if (
              res.ackUpdateIds && res.ackUpdateIds.length > 0 && res.ackSenderId &&
              ws?.readyState === WebSocket.OPEN && _wsAuthenticated
            ) {
              try {
                ws.send(JSON.stringify({
                  type: 'message_update_ack',
                  room_id: payload.room_id,
                  sender_id: res.ackSenderId,
                  update_ids: res.ackUpdateIds,
                }));
              } catch {}
            }
          })
          .catch(() => {});

        // Typing is ephemeral and fully owned by the router — no local
        // notification, and (matching prior behavior) no listener dispatch.
        if (rrpType === 'typing') return;

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
        try {
          const {
            displayIncomingCallNotification,
          } = require('./callNotificationService');

          // NOTE: the local notification for `new_message` is rendered by the
          // ingress router (ingestMessage), so it is intentionally NOT handled
          // here — doing both would show the notification twice.

          const localCallDecision = decideLocalIncomingCallNotification(payload, storeState);
          if (payload.event === 'incoming_call') {
            console.log('[NotifPolicy] local_call', {
              allow: localCallDecision.allow,
              reason: localCallDecision.reason,
              call_id: String(payload.call_id ?? ''),
              correlation_id: correlationId,
              route_reason: routeReason,
            });
          }

          if (
            shouldShowLocalIncomingCallNotification(payload, storeState) &&
            payload.caller &&
            payload.call_id
          ) {
            const callNav = {
              callId: payload.call_id,
              callerId: payload.caller_id ?? 0,
              callerName: payload.caller,
              callType: payload.call_type ?? 'voice',
              roomName: payload.room_name ?? '',
            };
            // App is not in the foreground (that's the only time the local
            // notification is shown). Stash the call so the full-screen intent
            // launch navigates to the full-screen IncomingCall screen.
            try {
              const { setPendingCallNav } = require('./pendingCallNav');
              setPendingCallNav(callNav);
            } catch { /* ignore */ }
            displayIncomingCallNotification(callNav).catch(() => {});
          }
        } catch { /* ignore — notification service unavailable */ }

        // Cancel any displayed incoming-call notification when the call ends
        // or gets accepted elsewhere (the caller hung up, or the user picked
        // it up on another device / inside the app).
        if (
          (payload.event === 'call_ended' || payload.event === 'call_rejected' || payload.event === 'call_accepted') &&
          payload.call_id
        ) {
          try {
            const { cancelIncomingCallNotification } = require('./callNotificationService');
            cancelIncomingCallNotification(payload.call_id).catch(() => {});
          } catch { /* ignore */ }
          try {
            const { clearPendingCallNav } = require('./pendingCallNav');
            clearPendingCallNav(payload.call_id);
          } catch { /* ignore */ }
          try {
            const { markCallEnded } = require('./callDedupe');
            markCallEnded(payload.call_id);
          } catch { /* ignore */ }
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
      console.log('[WsManager] internet restored — reconnecting and flushing retry queues');
      _reconnectDelay = INITIAL_RECONNECT_MS;
      connectWs();
      // Flush HTTP retry queue now that network is back
      flushHttpAckRetryQueue().catch(() => {});
      // Reconcile delivery ticks missed while offline
      reconcileSentDeliveryStatus().catch(() => {});
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

function startSelfHealWatchdog() {
  if (selfHealTimer) return;
  selfHealTimer = setInterval(() => {
    if (!_authenticated || !_hasInternet) return;
    if (_suspendReconnectUntil > Date.now()) return;
    if (_status === 'connected' || _status === 'connecting' || _status === 'reconnecting') return;
    if (connecting) return;
    console.log('[WsManager] watchdog reconnect from disconnected state');
    _reconnectDelay = INITIAL_RECONNECT_MS;
    connectWs();
  }, 12_000);
}

function stopSelfHealWatchdog() {
  if (selfHealTimer) {
    clearInterval(selfHealTimer);
    selfHealTimer = null;
  }
}

// ---- Background keepalive (replaces the old foreground service timer) ----
// Runs every 20s; nudges ensureWsAlive so the WS reconnects after FCM wakes
// the process. Much cheaper than a persistent foreground service.
let _bgKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

function startBgKeepalive() {
  if (_bgKeepaliveTimer) return;
  _bgKeepaliveTimer = setInterval(() => {
    if (!_authenticated) return;
    ensureWsAlive().catch(() => {});
  }, 20_000);
}

function stopBgKeepalive() {
  if (_bgKeepaliveTimer) { clearInterval(_bgKeepaliveTimer); _bgKeepaliveTimer = null; }
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
  startSelfHealWatchdog();
  startBgKeepalive();
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
  stopSelfHealWatchdog();
  stopBgKeepalive();
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

  // Periodic flush of HTTP retry queue (background keepalive scenario)
  flushHttpAckRetryQueue().catch(() => {});
  // Periodic delivery-tick reconciliation (covers acks missed while WS was down)
  reconcileSentDeliveryStatus().catch(() => {});
}
