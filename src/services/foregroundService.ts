/* ------------------------------------------------------------------ */
/*  Call Foreground Service                                            */
/*                                                                     */
/*  Started only while a voice/video call is active so Android does   */
/*  not kill the process mid-call. The notification shows the peer    */
/*  name + call type and tapping it reopens the ActiveCall screen.    */
/*                                                                     */
/*  The persistent background service for WS keepalive has been       */
/*  removed. The WS reconnects itself via FCM wake-ups and the        */
/*  built-in reconnect logic in notificationWsManager.                */
/* ------------------------------------------------------------------ */

import { Platform, NativeModules } from 'react-native';
import { useAppStore } from '../store/appStore';

const { MyChatService } = NativeModules;

let _callServiceRunning = false;
let _storeUnsub: (() => void) | null = null;

/* ---- Build notification text from store ---- */
function buildCallContent(): { title: string; text: string } {
  const call = useAppStore.getState().activeCall;
  if (call) {
    const icon = call.callType === 'video' ? '📹' : '📞';
    return { title: 'Axonic — On a call', text: `${icon} ${call.peerName}` };
  }
  return { title: 'Axonic', text: 'In a call' };
}

function _pushCallUpdate(): void {
  if (!_callServiceRunning) return;
  try {
    const { title, text } = buildCallContent();
    MyChatService.update(title, text).catch(() => {});
  } catch { /* ignore */ }
}

/**
 * Start the foreground service for the duration of a call.
 * Safe to call multiple times — only starts once.
 */
export async function startForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (_callServiceRunning) return;
  try {
    await MyChatService.start();
    _callServiceRunning = true;
    try { useAppStore.getState().setForegroundServiceRunning(true); } catch {}
    _pushCallUpdate();
    // Keep the notification in sync if the call state changes
    _storeUnsub = useAppStore.subscribe((s, prev) => {
      if (s.activeCall !== prev.activeCall) _pushCallUpdate();
    });
    console.log('[ForegroundService] started for call');
  } catch (err: any) {
    console.warn('[ForegroundService] start error:', err?.message ?? err);
  }
}

/**
 * Stop the foreground service when the call ends.
 */
export async function stopForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (_storeUnsub) { _storeUnsub(); _storeUnsub = null; }
  try {
    await MyChatService.stop();
    console.log('[ForegroundService] stopped after call');
  } catch (err: any) {
    console.warn('[ForegroundService] stop error:', err?.message ?? err);
  }
  _callServiceRunning = false;
  try { useAppStore.getState().setForegroundServiceRunning(false); } catch {}
}

export function isForegroundServiceRunning(): boolean {
  return _callServiceRunning;
}
