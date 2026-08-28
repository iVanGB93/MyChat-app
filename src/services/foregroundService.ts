/* ------------------------------------------------------------------ */
/*  Foreground Service (Android) — in-call keepalive only              */
/*                                                                     */
/*  A SINGLE native foreground service (MyChatService) is started for   */
/*  the duration of a voice/video call so the OS never kills the        */
/*  process mid-call. It is reference-counted by reason so it can be     */
/*  extended later, but today the only reason is 'call'.                */
/*                                                                     */
/*  We deliberately do NOT run an always-on "session" service: the bare */
/*  service does not keep the JS runtime / WebSocket alive after a swipe */
/*  — it only keeps an empty process + a persistent notification, which  */
/*  drains battery and confuses users. Background/killed delivery relies */
/*  on high-priority FCM data delivery (and APNs on iOS), which is       */
/*  the cross-platform notification surface. iOS has no foreground       */
/*  service, so all calls here no-op there.                            */
/* ------------------------------------------------------------------ */

import { Platform, NativeModules } from 'react-native';
import { useAppStore } from '../store/appStore';

const { MyChatService } = NativeModules;

type FgReason = 'call';
type ForegroundCallType = 'voice' | 'video';

const _reasons = new Set<FgReason>();
let _nativeRunning = false;
let _nativeCallType: ForegroundCallType | null = null;
let _storeUnsub: (() => void) | null = null;

/* ---- Build notification text from store ---- */
function buildContent(): { title: string; text: string } {
  // Kept generic on purpose — the in-app call screen already shows the
  // peer name and call type, so repeating it here just duplicates the
  // same info in the status bar chip.
  return { title: 'Axonic', text: 'Call in progress' };
}

function _pushUpdate(): void {
  if (!_nativeRunning) return;
  try {
    const { title, text } = buildContent();
    MyChatService.update(title, text)?.catch?.(() => {});
  } catch { /* ignore */ }
}

async function _ensureNativeStarted(callType: ForegroundCallType): Promise<void> {
  if (_nativeRunning && _nativeCallType === callType) {
    _pushUpdate();
    return;
  }
  try {
    await MyChatService.start(callType);
    _nativeRunning = true;
    _nativeCallType = callType;
    try { useAppStore.getState().setForegroundServiceRunning(true); } catch {}
    _pushUpdate();
    console.log('[ForegroundService] native service started');
  } catch (err: any) {
    console.warn('[ForegroundService] start error:', err?.message ?? err);
  }
}

async function _maybeStopNative(): Promise<void> {
  // Still needed by another reason — just refresh the notification text.
  if (_reasons.size > 0) { _pushUpdate(); return; }
  if (_storeUnsub) { _storeUnsub(); _storeUnsub = null; }
  try {
    await MyChatService.stop();
    console.log('[ForegroundService] native service stopped');
  } catch (err: any) {
    console.warn('[ForegroundService] stop error:', err?.message ?? err);
  }
  _nativeRunning = false;
  _nativeCallType = null;
  try { useAppStore.getState().setForegroundServiceRunning(false); } catch {}
}

/**
 * Start (or reference-count) the foreground service for a given reason.
 * Safe to call repeatedly. Must be called while the app is in the foreground
 * (Android 12+ forbids starting a foreground service from the background).
 */
export async function startForegroundService(
  reason: FgReason = 'call',
  callType: ForegroundCallType = 'voice',
): Promise<void> {
  if (Platform.OS !== 'android') return;
  _reasons.add(reason);
  await _ensureNativeStarted(callType);
}

/**
 * Release one reason. The native service is stopped only when no reason
 * remains (e.g. a call ends but the user is still logged in → stays running).
 */
export async function stopForegroundService(reason: FgReason = 'call'): Promise<void> {
  if (Platform.OS !== 'android') return;
  _reasons.delete(reason);
  await _maybeStopNative();
}

export function isForegroundServiceRunning(): boolean {
  return _nativeRunning;
}
