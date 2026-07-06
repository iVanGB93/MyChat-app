/* ------------------------------------------------------------------ */
/*  Pending incoming-call navigation                                    */
/*                                                                      */
/*  When an incoming call arrives while the app is in the BACKGROUND or  */
/*  KILLED, the OS/Notifee full-screen intent launches the activity but  */
/*  no JS navigation can run at that moment. We stash the call here and   */
/*  the app consumes it when it becomes active, navigating straight to    */
/*  the full-screen IncomingCall screen (so it "takes over" like a real   */
/*  call instead of staying a heads-up banner).                          */
/* ------------------------------------------------------------------ */

export interface PendingCallNav {
  callId: string;
  callerName: string;
  callerId: number;
  callType: 'voice' | 'video';
  roomName: string;
}

// A stashed call is only valid briefly — a stale pending call must never
// pop the incoming-call screen minutes later on an unrelated foreground.
const PENDING_TTL_MS = 60_000;

let _pending: (PendingCallNav & { ts: number }) | null = null;

export function setPendingCallNav(nav: PendingCallNav): void {
  if (!nav.callId) return;
  _pending = { ...nav, ts: Date.now() };
}

export function takePendingCallNav(): PendingCallNav | null {
  const v = _pending;
  _pending = null;
  if (!v) return null;
  if (Date.now() - v.ts > PENDING_TTL_MS) return null;
  const { ts: _ts, ...nav } = v;
  return nav;
}

/** Drop any stashed call (the call ended / was answered elsewhere). */
export function clearPendingCallNav(callId?: string): void {
  if (!callId || _pending?.callId === callId) _pending = null;
}
