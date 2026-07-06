/* ------------------------------------------------------------------ */
/*  Call de-duplication guard                                          */
/*                                                                      */
/*  A single incoming call is delivered over MULTIPLE transports at     */
/*  once (WS notif + FCM data push, plus the background poll). Without   */
/*  a shared guard each transport renders its own heads-up/ring, so the  */
/*  call "arrives twice", and a call the user already declined can be    */
/*  re-shown by a slightly-later transport ("rang again after decline"). */
/*                                                                      */
/*  This module is the single source of truth for:                      */
/*   - shouldShowCall(id): true only for the FIRST transport to render   */
/*     a given call (collapses the duplicate ring).                      */
/*   - markCallEnded(id): the call was declined / answered / ended, so   */
/*     any later transport for the same id must be ignored.              */
/*   - isCallEnded(id): guard used before rendering OR navigating.       */
/* ------------------------------------------------------------------ */

// A call id is only tracked briefly — long enough to cover the window in
// which duplicate transports / re-deliveries arrive.
const TTL_MS = 90_000;

const shown = new Map<string, number>();
const ended = new Map<string, number>();

function prune(map: Map<string, number>): void {
  const now = Date.now();
  for (const [id, ts] of map) {
    if (now - ts > TTL_MS) map.delete(id);
  }
}

/**
 * Returns true only for the first transport that tries to display a given
 * call (within the dedupe window) and only if the call hasn't ended. Later
 * duplicate transports get false and must not render/ring again.
 */
export function shouldShowCall(callId: string): boolean {
  if (!callId) return true;
  if (isCallEnded(callId)) return false;
  prune(shown);
  if (shown.has(callId)) return false;
  shown.set(callId, Date.now());
  return true;
}

/** Mark a call as declined / answered / ended so no transport re-rings it. */
export function markCallEnded(callId: string): void {
  if (!callId) return;
  ended.set(callId, Date.now());
  shown.delete(callId);
}

/** Whether a call was already declined / answered / ended. */
export function isCallEnded(callId: string): boolean {
  if (!callId) return false;
  prune(ended);
  return ended.has(callId);
}
