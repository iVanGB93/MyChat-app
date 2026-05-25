/* ------------------------------------------------------------------ */
/*  Foreground Service — keeps the app process alive so the WebSocket  */
/*  stays connected even when the app is in the background / closed.   */
/*                                                                     */
/*  Uses a custom native service (MyChatForegroundService) that        */
/*  creates a MediaSession + MediaStyle notification so Android 14+/16 */
/*  accepts the "mediaPlayback" foreground service type.               */
/*                                                                     */
/*  The JS keepalive runs via setInterval, which works because the     */
/*  native service keeps the process alive.                            */
/* ------------------------------------------------------------------ */

import { Platform, AppState, NativeModules } from 'react-native';
import { ensureWsAlive } from './notificationWsManager';

const { MyChatService } = NativeModules;

const KEEPALIVE_INTERVAL_MS = 8_000;  // check WS health every 8 s
const POLL_SAFETY_MS = 15_000;        // background poll safety net every 15 s

let _serviceRunning = false;
let _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let _keepaliveRunning = false; // prevents overlapping interval ticks
let _lastPollTime = 0;

/**
 * Start the foreground service and keepalive timer.
 */
export async function startForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (_serviceRunning) return;

  try {
    // Start the native foreground service (MediaSession + MediaStyle notification)
    await MyChatService.start();
    _serviceRunning = true;
    console.log('[ForegroundService] ✓ native service started');

    // Start JS keepalive timer
    startKeepaliveTimer();
  } catch (err: any) {
    console.warn('[ForegroundService] start error:', err?.message ?? err);
  }
}

/**
 * Stop the foreground service and keepalive timer.
 */
export async function stopForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;

  stopKeepaliveTimer();

  try {
    await MyChatService.stop();
    console.log('[ForegroundService] stopped');
  } catch (err: any) {
    console.warn('[ForegroundService] stop error:', err?.message ?? err);
  }
  _serviceRunning = false;
}

/** Check if the service is running */
export function isForegroundServiceRunning(): boolean {
  return _serviceRunning;
}

/* ================================================================== */
/*  JS keepalive timer — runs because the native service keeps the     */
/*  process alive even when the Activity is destroyed.                 */
/* ================================================================== */

function startKeepaliveTimer() {
  if (_keepaliveTimer) return;

  _keepaliveTimer = setInterval(async () => {
    // Skip this tick if the previous one is still running (slow network / server)
    if (_keepaliveRunning) {
      console.warn('[ForegroundService] keepalive tick overlapping — skipping');
      return;
    }
    _keepaliveRunning = true;
    try {
      // Ensure the WebSocket is alive
      await ensureWsAlive();

      // Safety-net poll when in background
      if (AppState.currentState !== 'active') {
        const now = Date.now();
        if (now - _lastPollTime >= POLL_SAFETY_MS) {
          _lastPollTime = now;
          try {
            const { checkPendingNotifications } = require('./backgroundNotificationService');
            await checkPendingNotifications();
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.warn('[ForegroundService] keepalive error:', err);
    } finally {
      _keepaliveRunning = false;
    }
  }, KEEPALIVE_INTERVAL_MS);

  console.log('[ForegroundService] keepalive timer started');
}

function stopKeepaliveTimer() {
  if (_keepaliveTimer) {
    clearInterval(_keepaliveTimer);
    _keepaliveTimer = null;
  }
}
