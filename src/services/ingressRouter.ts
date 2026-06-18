/* ------------------------------------------------------------------ */
/*  Ingress Router (singleton, transport-agnostic)                     */
/*                                                                     */
/*  ONE place that every incoming MESSAGE funnels through, regardless  */
/*  of how it arrived:                                                 */
/*    - notification WebSocket   (app alive / backgrounded)            */
/*    - Expo push received       (app backgrounded / killed)           */
/*    - Expo push tapped         (user opened the notification)        */
/*    - background poll task      (fallback)                           */
/*                                                                     */
/*  The router normalizes the raw payload into a single canonical      */
/*  shape, dedupes it (so the same message delivered over two paths is */
/*  processed exactly once), then runs the unified pipeline:           */
/*    persist (SQLite) → ack delivery → update global store (Zustand)  */
/*    → inject into open room → decide local notification.             */
/*                                                                     */
/*  This is the SINGLE WRITER into SQLite + the Zustand store for      */
/*  incoming messages. Callers must not duplicate any of these steps.  */
/* ------------------------------------------------------------------ */

import {
  saveMessage,
  messageExists,
  markDelivered,
  isEventProcessed,
  markEventProcessed,
  filterMissingMessageIds,
} from './localMessageStore';
import type { ReplyRef } from './localMessageStore';
import {
  injectReceivedMessage,
  markIdsAsReadInRoom,
  markIdsAsDeliveredInRoom,
  applyRemoteMessageUpdates,
  ackMessageUpdates,
  flushOutboxForRecipient,
} from './chatWsManager';
import type { WsMessage } from './chatWsManager';
import { useAppStore } from '../store/appStore';
import { decideLocalMessageNotification } from './notificationPresentationPolicy';
import type { NotificationPayload } from './notificationWsManager';
import { enqueueMessageAck } from './messageAckRetryQueue';
import { toEnvelope, idempotencyId } from './rrp/envelope';
import type { RrpType } from './rrp/envelope';
import api from './api';

/** Where an incoming event came from. Drives the notification decision: only
 *  the `ws` source renders a local notification — for push sources the OS has
 *  already displayed the notification, so rendering another would duplicate. */
export type IngressSource = 'ws' | 'push_receive' | 'push_tap' | 'background_task' | 'poll';

/** A normalized incoming chat message, independent of the transport. */
export interface CanonicalMessage {
  messageId: string;
  roomId: string;
  roomName: string;
  senderId: number;
  senderName: string;
  content: string | null;
  messageType: string;
  createdAt: string;
  replyTo: ReplyRef | null;
  durationMs: number | null;
  audioB64: string | null;
  audioMime: string | null;
  imageB64: string | null;
  imageMime: string | null;
}

/* ---- Dedupe bookkeeping (in-memory, bounded) ----
 * `_acked`     — message ids we've already sent a delivery ACK for (avoid spam).
 * `_persisting`— message ids whose persist pipeline is in flight, to close the
 *                race where WS + push arrive within the same tick and both pass
 *                the `messageExists` check before either writes.
 * Persistent dedupe across app restarts is provided by SQLite `messageExists`. */
const _acked = new Set<string>();
const _persisting = new Set<string>();
const MAX_TRACKED = 300;

function track(set: Set<string>, id: string): void {
  set.add(id);
  if (set.size > MAX_TRACKED) {
    // Drop the oldest entries (insertion order is preserved by Set).
    const trimmed = Array.from(set).slice(-MAX_TRACKED);
    set.clear();
    trimmed.forEach((v) => set.add(v));
  }
}

/* ---- Coercion helpers (push data is all strings; WS data is typed) ---- */
function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}
function asNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a raw payload (from any transport) into a CanonicalMessage.
 * Returns null when the ACK-critical identity fields are missing.
 */
export function normalizeMessage(
  raw: Record<string, any> | null | undefined,
): CanonicalMessage | null {
  if (!raw) return null;
  const messageId = asStr(raw.message_id ?? raw.messageId ?? raw.id);
  const roomId = asStr(raw.room_id ?? raw.roomId);
  const senderId = asNum(raw.sender_id ?? raw.senderId);
  // message_id + room_id + sender_id are the minimum needed to ack delivery.
  if (!messageId || !roomId || senderId == null) return null;

  const replyToRaw = raw.reply_to ?? raw.replyTo ?? null;
  let replyTo: ReplyRef | null = null;
  if (replyToRaw) {
    try {
      replyTo = typeof replyToRaw === 'string' ? JSON.parse(replyToRaw) : replyToRaw;
    } catch {
      replyTo = null;
    }
  }

  return {
    messageId,
    roomId,
    roomName: asStr(raw.room_name ?? raw.roomName) ?? '',
    senderId,
    senderName: asStr(raw.sender ?? raw.from_username ?? raw.senderName) ?? '',
    content: asStr(raw.content),
    messageType: asStr(raw.message_type ?? raw.messageType) ?? 'text',
    createdAt: asStr(raw.created_at ?? raw.createdAt) ?? new Date().toISOString(),
    replyTo,
    durationMs: asNum(raw.duration_ms ?? raw.durationMs),
    audioB64: asStr(raw.audio_b64),
    audioMime: asStr(raw.audio_mime),
    imageB64: asStr(raw.image_b64),
    imageMime: asStr(raw.image_mime),
  };
}

/** Is this sender blocked by us? (defense-in-depth; server also filters). */
function isBlockedSender(senderId: number): boolean {
  try {
    return !!useAppStore.getState().blockedIds?.[senderId];
  } catch {
    return false;
  }
}

/**
 * Fire a delivery ACK for a message. Idempotent on the server; we additionally
 * guard with `_acked` so the same id isn't acked repeatedly within a session.
 * HTTP first (works when the WS is dead), falling back to the retry queue + WS.
 */
async function ackDelivery(messageId: string, senderId: number, roomId: string): Promise<void> {
  if (senderId <= 0 || _acked.has(messageId)) return;
  track(_acked, messageId);
  const now = new Date().toISOString();
  try {
    const response = await api.post('/api/chat/messages/ack/', {
      message_id: messageId,
      sender_id: senderId,
      room_id: roomId,
      delivered_at: now,
    });
    if (response.status === 200) {
      console.log('[Ingress] delivery ack sent:', messageId);
    }
  } catch (httpErr: any) {
    console.warn('[Ingress] HTTP ack failed — queuing + WS fallback', messageId);
    await enqueueMessageAck({ message_id: messageId, sender_id: senderId, room_id: roomId, delivered_at: now }).catch(() => {});
  }
  // Also attempt a WS ack (cheap, harmless if HTTP already succeeded).
  try {
    const { sendOrQueueMessageAck } = await import('./notificationWsManager');
    await sendOrQueueMessageAck({ message_id: messageId, sender_id: senderId, room_id: roomId }).catch(() => {});
  } catch { /* notification WS manager unavailable */ }
}

/** Decode inline media (voice / image) to a cached file, returning its URI. */
async function decodeMedia(evt: CanonicalMessage): Promise<string | null> {
  try {
    if (evt.messageType === 'voice' && evt.audioB64) {
      const { saveIncomingAudio } = await import('./voiceMessageUtils');
      return await saveIncomingAudio(evt.messageId, evt.audioB64, evt.audioMime);
    }
    if (evt.messageType === 'image' && evt.imageB64) {
      const { saveIncomingImage } = await import('./voiceMessageUtils');
      return await saveIncomingImage(evt.messageId, evt.imageB64, evt.imageMime);
    }
  } catch (err) {
    console.warn('[Ingress] media decode failed:', err);
  }
  return null;
}

/** Build the in-memory WsMessage used to hydrate an open chat room. */
function toWsMessage(evt: CanonicalMessage, fileUri: string | null): WsMessage {
  return {
    id: evt.messageId,
    sender: evt.senderName,
    sender_id: evt.senderId,
    content: evt.content ?? '',
    message_type: evt.messageType,
    created_at: evt.createdAt,
    is_read: false,
    reply_to: evt.replyTo,
    file_uri: fileUri,
    duration_ms: evt.durationMs,
  };
}

/** Render the local OS notification for an alive/backgrounded WS delivery. */
async function maybeNotify(evt: CanonicalMessage): Promise<void> {
  const store = (() => { try { return useAppStore.getState(); } catch { return null; } })();
  const payload: NotificationPayload = {
    event: 'new_message',
    room_id: evt.roomId,
    room_name: evt.roomName,
    sender: evt.senderName,
    sender_id: evt.senderId,
    content: evt.content ?? '',
    message_id: evt.messageId,
  };
  const decision = decideLocalMessageNotification(payload, store);
  console.log('[Ingress] notify decision', { allow: decision.allow, reason: decision.reason, room_id: evt.roomId, message_id: evt.messageId });
  if (!decision.allow || !evt.content) return;

  // Reframe messages from strangers (not in contacts) as a contact request.
  const isStranger = !store?.contactIds?.[evt.senderId];
  const body = isStranger ? 'wants to talk to you · tap to accept' : evt.content;
  try {
    const { showMessageNotification } = await import('./pushNotificationService');
    await showMessageNotification({
      senderName: evt.senderName || evt.roomName || 'New message',
      senderId: evt.senderId,
      content: body,
      roomId: evt.roomId,
      roomName: evt.roomName || evt.senderName,
      messageId: evt.messageId, // dedupes across paths inside the notifier
    });
  } catch { /* notifier unavailable */ }
}

/**
 * THE unified message ingress. Every transport calls this exactly once per
 * delivery. Safe to call with the same message from multiple paths — it is
 * deduped and produces side effects only once.
 */
export async function ingestMessage(
  raw: Record<string, any> | null | undefined,
  source: IngressSource,
): Promise<void> {
  const evt = normalizeMessage(raw);
  if (!evt) {
    console.log('[Ingress] skipped — missing identity fields', { source });
    return;
  }
  if (isBlockedSender(evt.senderId)) {
    console.log('[Ingress] dropped blocked sender', evt.senderId);
    return;
  }

  // Our own message echoed back by the room-WS relay. It was already persisted
  // optimistically at send time, so never ack it (acking our own message hits
  // a non-existent delivery row) — just hydrate any open room and bail.
  const myId = (() => { try { return useAppStore.getState().user?.id ?? null; } catch { return null; } })();
  if (myId != null && evt.senderId === myId) {
    injectReceivedMessage(evt.roomId, toWsMessage(evt, null));
    return;
  }

  // 1. Delivery ACK — needs only identity fields, so it fires even when the
  //    push payload was truncated and dropped `content`. Idempotent.
  await ackDelivery(evt.messageId, evt.senderId, evt.roomId);

  // 2. Content/media gate. A truncated push (ack-critical ids but no content)
  //    is acked above; we then wait for the full WS delivery to persist it.
  const hasMedia = !!(evt.audioB64 || evt.imageB64);
  if (!evt.content && !hasMedia) {
    console.log('[Ingress] acked but not persisted — content missing (truncated)', evt.messageId);
    return;
  }

  // 3. Persistent + in-flight dedupe (single write of side effects).
  const exists = await messageExists(evt.messageId);
  if (exists || _persisting.has(evt.messageId)) {
    // Already stored (or being stored) — just make sure an open room shows it.
    injectReceivedMessage(evt.roomId, toWsMessage(evt, null));
    return;
  }
  track(_persisting, evt.messageId);

  // 4. Decode any inline media, then persist to SQLite.
  const fileUri = hasMedia ? await decodeMedia(evt) : null;
  await saveMessage({
    id: evt.messageId,
    room_id: evt.roomId,
    sender_id: evt.senderId,
    sender_name: evt.senderName,
    content: evt.content,
    type: evt.messageType,
    file_uri: fileUri,
    created_at: evt.createdAt,
    is_mine: false,
    sync: true,
    status: 'delivered',
    reactions: {},
    is_deleted: false,
    is_read: false,
    reply_to: evt.replyTo,
    duration_ms: evt.durationMs,
  });

  // 5. Hydrate an open chat room (no-op if the room screen isn't mounted).
  injectReceivedMessage(evt.roomId, toWsMessage(evt, fileUri));

  // 6. Update the global store (chat-list preview + unread badge). Done once,
  //    because steps 3+ only run on the FIRST delivery of a given message.
  try {
    const store = useAppStore.getState();
    store.setRoomLastMessage(evt.roomId, {
      id: evt.messageId,
      content: evt.content ?? '',
      created_at: evt.createdAt,
      sender: evt.senderName,
      sender_id: evt.senderId,
    });
    if (store.activeRoomId !== evt.roomId && !store.mutedRooms[evt.roomId]) {
      store.incrementRoomUnread(evt.roomId, 1);
    }
  } catch { /* store not hydrated yet (cold launch) */ }

  // 7. Local notification — ONLY for the WS path. For push sources the OS has
  //    already displayed the notification; rendering another would duplicate.
  if (source === 'ws') {
    await maybeNotify(evt);
  }

  console.log('[Ingress] processed message', evt.messageId, 'room', evt.roomId, 'via', source);
}

/* ================================================================== */
/*  Unified inbound dispatch — routeInbound (ALL event types)          */
/*                                                                     */
/*  Single entry point that classifies any raw inbound payload (from    */
/*  any transport) into a canonical RRP event and applies its STATE     */
/*  side effects exactly once (persistent dedupe via processed_events). */
/*                                                                     */
/*  Transport-LOCAL follow-ups that need the originating socket (e.g.   */
/*  sending a message_update_ack back over the same WS) are returned to */
/*  the caller in InboundResult rather than performed here, so the      */
/*  router stays transport-agnostic.                                    */
/* ================================================================== */

export interface InboundResult {
  /** Canonical type the payload was classified as. */
  type: RrpType;
  /** True when the router owned this event's state side effects. */
  handled: boolean;
  /** Update ids the caller should ack back over its socket (message.update). */
  ackUpdateIds?: string[];
  /** Sender to address the update ack to. */
  ackSenderId?: number;
}

/** Has this event id already been applied? (persistent + this-session guards). */
async function alreadyProcessed(id: string | null): Promise<boolean> {
  if (!id) return false;
  if (_processed.has(id)) return true;
  return isEventProcessed(id);
}

/** Mark an event id processed in both the session cache and the SQLite ledger. */
async function rememberProcessed(id: string | null, type: RrpType): Promise<void> {
  if (!id) return;
  track(_processed, id);
  await markEventProcessed(id, type).catch(() => {});
}

/** Session-level processed cache (fast path in front of the SQLite ledger). */
const _processed = new Set<string>();

export async function routeInbound(
  raw: Record<string, any> | null | undefined,
  source: IngressSource,
): Promise<InboundResult> {
  const env = toEnvelope(raw);
  const p = env.payload as Record<string, any>;

  switch (env.type) {
    /* ---- chat message: existing fully-deduped pipeline ---- */
    case 'message': {
      await ingestMessage(p, source);
      return { type: env.type, handled: true };
    }

    /* ---- recipient stored our message → flip delivery tick ---- */
    case 'message.delivered': {
      const messageId = asStr(p.message_id ?? p.messageId);
      const byUserId = asNum(p.by_user_id ?? p.recipient_id);
      if (!messageId || byUserId == null) return { type: env.type, handled: false };
      const dedupeId = idempotencyId('message.delivered', p);
      if (await alreadyProcessed(dedupeId)) return { type: env.type, handled: true };
      await markDelivered(messageId, byUserId).catch(() => {});
      if (env.room_id) {
        try { markIdsAsDeliveredInRoom(env.room_id, [messageId]); } catch {}
        try { useAppStore.getState().setRoomLastMessageStatus(env.room_id, messageId, 'delivered'); } catch {}
      }
      await rememberProcessed(dedupeId, env.type);
      return { type: env.type, handled: true };
    }

    /* ---- recipient read our message(s) ---- */
    case 'message.read': {
      const ids = (p.message_ids as unknown[] | undefined)?.map((x) => String(x)) ?? [];
      if (!env.room_id || ids.length === 0) return { type: env.type, handled: false };
      try { markIdsAsReadInRoom(env.room_id, ids); } catch {}
      try {
        const store = useAppStore.getState();
        for (const id of ids) store.setRoomLastMessageStatus(env.room_id, id, 'read');
      } catch {}
      return { type: env.type, handled: true };
    }

    /* ---- reaction / edit / delete relay → apply + request ack ---- */
    case 'message.update': {
      const updates = (p.updates as Array<{ id?: string; message_id: string; changes: Record<string, unknown> }> | undefined) ?? [];
      if (!env.room_id || updates.length === 0) return { type: env.type, handled: false };
      // Apply each update at most once (idempotent ledger keyed by update id).
      const fresh: typeof updates = [];
      for (const u of updates) {
        const uid = asStr(u.id);
        if (uid && (await alreadyProcessed(`upd:${uid}`))) continue;
        fresh.push(u);
      }
      if (fresh.length > 0) {
        applyRemoteMessageUpdates(
          env.room_id,
          fresh.map((u) => ({ message_id: u.message_id, changes: u.changes })),
        );
        for (const u of fresh) {
          const uid = asStr(u.id);
          if (uid) await rememberProcessed(`upd:${uid}`, env.type);
        }
      }
      // Caller acks ALL update ids it received (ack is idempotent on the peer).
      const ackUpdateIds = updates.map((u) => String(u.id ?? '')).filter((id) => !!id);
      const ackSenderId = asNum(p.from_user_id ?? p.sender_id) ?? 0;
      return { type: env.type, handled: true, ackUpdateIds, ackSenderId };
    }

    /* ---- peer applied our update(s) → clear them from the outbox ---- */
    case 'message.update.ack': {
      const ids = (p.update_ids as unknown[] | undefined)?.map((x) => String(x)) ?? [];
      if (!env.room_id || ids.length === 0) return { type: env.type, handled: false };
      try { ackMessageUpdates(env.room_id, ids); } catch {}
      return { type: env.type, handled: true };
    }

    /* ---- typing indicator (ephemeral) ---- */
    case 'typing': {
      const senderId = asNum(p.sender_id);
      if (!env.room_id || senderId == null) return { type: env.type, handled: false };
      try {
        useAppStore.getState().setRoomTyping(
          env.room_id,
          senderId,
          asStr(p.sender) ?? '',
          Boolean(p.is_typing),
        );
      } catch {}
      return { type: env.type, handled: true };
    }

    /* ---- peer just came online → flush our outbox for them ---- */
    case 'receiver_ready': {
      const userId = asNum(p.user_id);
      if (!env.room_id || userId == null) return { type: env.type, handled: false };
      try { flushOutboxForRecipient(env.room_id, userId); } catch {}
      return { type: env.type, handled: true };
    }

    /* ---- peer sent the digest of ids they hold → request any we're missing ---- */
    case 'sync.digest': {
      const ids = (p.ids as unknown[] | undefined)?.map((x) => String(x)) ?? [];
      if (!env.room_id || ids.length === 0) return { type: env.type, handled: false };
      try {
        const missing = await filterMissingMessageIds(env.room_id, ids);
        if (missing.length > 0) {
          const { requestMissing } = await import('./outboundRouter');
          await requestMissing(env.room_id, missing).catch(() => {});
          console.log('[Ingress] sync.digest — requested', missing.length, 'missing in', env.room_id);
        }
      } catch { /* best-effort */ }
      return { type: env.type, handled: true };
    }

    /* ---- peer is missing ids → resend via the proven outbox-flush path ---- */
    case 'sync.request': {
      const requesterId = asNum(p.from_user_id ?? p.sender_id);
      if (!env.room_id || requesterId == null) return { type: env.type, handled: false };
      // Reuse receiver_ready semantics: flush any undelivered messages for the
      // requester (preserves original ids + media) and reconcile delivery ticks.
      try { flushOutboxForRecipient(env.room_id, requesterId); } catch {}
      try {
        const { reconcileSentDeliveryStatus } = await import('./deliveryReconciler');
        await reconcileSentDeliveryStatus().catch(() => {});
      } catch {}
      return { type: env.type, handled: true };
    }

    /* ---- everything else (calls, signaling, control, presence) ---- */
    default:
      return { type: env.type, handled: false };
  }
}
