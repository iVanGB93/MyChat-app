/* ------------------------------------------------------------------ */
/*  Outbound Router (RRP)                                               */
/*                                                                     */
/*  The single seam every OUTBOUND protocol event flows through. It     */
/*  selects a transport, attempts delivery, and (for best-effort sync   */
/*  events) lets the periodic re-emit handle any drop.                  */
/*                                                                     */
/*  Transport selection (today):                                        */
/*    - control / sync events  → always-on notification WS              */
/*    - chat messages          → still sent via chatWsManager           */
/*      .sendChatMessage (proven media + outbox path; NOT rewrapped).  */
/*                                                                     */
/*  Reliability model:                                                  */
/*    - sync.digest is BEST-EFFORT — it is re-emitted on every          */
/*      (re)connect, so a single dropped frame self-heals.              */
/*    - sync.request triggers the peer's existing, proven outbox flush  */
/*      (receiver_ready semantics), so message resend reuses code that  */
/*      already preserves ids + media rather than a brittle new path.   */
/* ------------------------------------------------------------------ */

import { makeEnvelope, toWire } from './rrp/envelope';
import type { RrpEnvelope, RrpType } from './rrp/envelope';
import { getRecentMessageDigest, getIncompleteMediaDigest } from './localMessageStore';

/** Canonical RrpType → the backend `type` field for an OUTBOUND frame. */
const TYPE_TO_SEND_TYPE: Partial<Record<RrpType, string>> = {
  'sync.digest': 'sync_digest',
  'sync.request': 'sync_request',
};

/**
 * Send a protocol event. Returns true if it was handed to a transport.
 * Only the transports listed in TYPE_TO_SEND_TYPE are routed here today; other
 * types (chat messages, read receipts, update relays) keep their existing,
 * proven senders.
 */
export async function sendEvent(env: RrpEnvelope): Promise<boolean> {
  const sendType = TYPE_TO_SEND_TYPE[env.type];
  if (!sendType) return false;

  // Build the wire frame: keep the flat payload (decision #3), set the backend
  // `type` discriminator, and carry the RRP metadata for a future hardened relay.
  const wire = toWire(env);
  const frame = { ...wire, type: sendType };

  try {
    const { sendRawNotif } = await import('./notificationWsManager');
    return sendRawNotif(frame);
  } catch {
    return false;
  }
}

/**
 * Emit a per-room digest of the message ids we hold so the peer can detect and
 * request gaps. Best-effort: called on every (re)connect. No-ops when the
 * notification WS is not ready (the next reconnect re-emits).
 */
export async function emitRoomDigests(): Promise<void> {
  try {
    const { isNotifWsReady } = await import('./notificationWsManager');
    if (!isNotifWsReady()) return;
  } catch {
    return;
  }

  let digest: Array<{ room_id: string; ids: string[] }> = [];
  try {
    digest = await getRecentMessageDigest();
  } catch {
    return;
  }

  for (const room of digest) {
    if (!room.ids.length) continue;
    const env = makeEnvelope(
      'sync.digest',
      { room_id: room.room_id, ids: room.ids },
      { room_id: room.room_id },
    );
    await sendEvent(env).catch(() => {});
  }
}

/**
 * Ask the peer to resend a set of message ids we are missing in a room.
 * Best-effort over the notification WS.
 */
export async function requestMissing(roomId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const env = makeEnvelope(
    'sync.request',
    { room_id: roomId, ids },
    { room_id: roomId },
  );
  await sendEvent(env).catch(() => {});
}

/**
 * Ask peers to re-send media for messages whose row exists locally but whose
 * media never landed (file_uri IS NULL) — typically saved from a push that
 * stripped the base64 blob. Best-effort, re-issued on every (re)connect.
 */
export async function requestIncompleteMedia(): Promise<void> {
  try {
    const { isNotifWsReady } = await import('./notificationWsManager');
    if (!isNotifWsReady()) return;
  } catch {
    return;
  }

  let digest: Array<{ room_id: string; ids: string[] }> = [];
  try {
    digest = await getIncompleteMediaDigest();
  } catch {
    return;
  }

  for (const room of digest) {
    if (!room.ids.length) continue;
    await requestMissing(room.room_id, room.ids).catch(() => {});
    console.log('[OutboundRouter] requested media hydration for', room.ids.length, 'in', room.room_id);
  }
}
