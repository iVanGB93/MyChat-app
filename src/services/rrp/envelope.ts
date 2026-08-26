/* ------------------------------------------------------------------ */
/*  Router-to-Router Protocol (RRP) — the shared event envelope        */
/*                                                                     */
/*  Every piece of information that flows between two app instances     */
/*  (Router A ⇄ Router B) is modelled as a single typed envelope. The   */
/*  backend (Django Channels / Expo push) is a DUMB RELAY: it forwards  */
/*  these envelopes and never inspects or stores their content.        */
/*                                                                     */
/*  Wire format decision (#3): the envelope is a *typed view* over the  */
/*  existing flat-keyed payloads. We do NOT nest everything under a     */
/*  `payload` object on the wire — that would force a backend change.   */
/*  Instead `toEnvelope()` reads the flat keys into a typed envelope,   */
/*  and `toWire()` flattens an envelope back into the shape the         */
/*  existing transports already understand.                            */
/* ------------------------------------------------------------------ */

/** Protocol version. Bump only on a breaking change to the envelope shape. */
export const RRP_VERSION = 1 as const;

/**
 * Canonical event types. These are transport-agnostic names; the wire still
 * uses the legacy `event` / `type` strings, mapped via WIRE_EVENT_TO_TYPE.
 */
export type RrpType =
  | 'message'             // a chat message (text / voice / image / …)
  | 'message.delivered'   // recipient stored our message
  | 'message.read'        // recipient read our message(s)
  | 'message.update'      // reaction / edit / delete relay
  | 'message.update.ack'  // peer applied our update(s)
  | 'typing'              // ephemeral typing indicator
  | 'receiver_ready'      // peer just came online — flush outbox for them
  | 'call.invite'
  | 'call.accept'
  | 'call.reject'
  | 'call.end'
  | 'webrtc.signal'       // SDP / ICE signaling
  | 'presence'            // app_state / online indicator
  | 'sync.digest'         // "here are the message ids I have for this room"
  | 'sync.request'        // "please resend these ids I'm missing"
  | 'control'             // auth_ok / auth_failed / pong / server_error / …
  | 'unknown';

/** The shared envelope. `payload` is the original flat record (typed view). */
export interface RrpEnvelope<T extends Record<string, any> = Record<string, any>> {
  /** Protocol version. */
  v: number;
  /** Canonical event type. */
  type: RrpType;
  /** Idempotency key — a given id is processed exactly once per router. */
  id: string;
  /** Correlation id grouping related events (e.g. "msg:<id>", "call:<id>"). */
  corr: string;
  /** Conversation scope, when applicable. */
  room_id?: string;
  /** Originating router's user id. */
  sender_id: number;
  /** ISO8601 emit time (sender clock). */
  ts: string;
  /** Optional expiry (ms) for retry queues. */
  ttl?: number;
  /** The flat payload (same keys the transports already use). */
  payload: T;
  /** True for events that must NOT be persisted/deduped (typing, signaling, control). */
  ephemeral: boolean;
}

/* ------------------------------------------------------------------ */
/*  Wire <-> canonical mapping                                          */
/* ------------------------------------------------------------------ */

/** Legacy wire `event` / `type` string → canonical RrpType. */
const WIRE_EVENT_TO_TYPE: Record<string, RrpType> = {
  new_message: 'message',
  message_delivery_ack: 'message.delivered',
  messages_read: 'message.read',
  message_update: 'message.update',
  message_update_ack: 'message.update.ack',
  typing: 'typing',
  receiver_ready: 'receiver_ready',
  incoming_call: 'call.invite',
  call_accepted: 'call.accept',
  call_rejected: 'call.reject',
  call_ended: 'call.end',
  webrtc_signal: 'webrtc.signal',
  presence: 'presence',
  app_state: 'presence',
  presence_update: 'presence',
  presence_snapshot: 'presence',
  sync_digest: 'sync.digest',
  sync_request: 'sync.request',
  // control frames
  auth_ok: 'control',
  auth_failed: 'control',
  server_error: 'control',
  pong: 'control',
  peer_sync_available: 'control',
};

/** Canonical RrpType → the wire string the transports expect to send. */
const TYPE_TO_WIRE_EVENT: Partial<Record<RrpType, string>> = {
  message: 'new_message',
  'message.delivered': 'message_delivery_ack',
  'message.read': 'messages_read',
  'message.update': 'message_update',
  'message.update.ack': 'message_update_ack',
  typing: 'typing',
  receiver_ready: 'receiver_ready',
  'call.invite': 'incoming_call',
  'call.accept': 'call_accepted',
  'call.reject': 'call_rejected',
  'call.end': 'call_ended',
  'webrtc.signal': 'webrtc_signal',
  presence: 'app_state',
  'sync.digest': 'sync_digest',
  'sync.request': 'sync_request',
};

/** Event types that are NEVER persisted or deduped. */
const EPHEMERAL_TYPES = new Set<RrpType>(['typing', 'webrtc.signal', 'presence', 'control', 'unknown']);

/* ------------------------------------------------------------------ */
/*  Coercion helpers                                                    */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}
function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Classify a raw inbound payload into a canonical RrpType. */
export function classify(raw: Record<string, any> | null | undefined): RrpType {
  if (!raw) return 'unknown';
  const key = str(raw.event) ?? str(raw.type) ?? '';
  if (key) return WIRE_EVENT_TO_TYPE[key] ?? 'unknown';
  // Untyped frame: the room WS relays chat messages as bare payloads with no
  // `event`/`type` key — fingerprint them by their message fields.
  if (
    (str(raw.message_id) ?? str(raw.id)) &&
    raw.sender_id !== undefined &&
    (raw.message_type !== undefined || raw.content !== undefined)
  ) {
    return 'message';
  }
  return 'unknown';
}

/**
 * Compute the idempotency id for an inbound event. Returns null for ephemeral
 * events (which must never be deduped) and when there is no stable identity.
 */
export function idempotencyId(type: RrpType, raw: Record<string, any>): string | null {
  switch (type) {
    case 'message':
      return str(raw.message_id ?? raw.messageId ?? raw.id);
    case 'message.delivered': {
      const mid = str(raw.message_id ?? raw.messageId);
      const by = num(raw.by_user_id ?? raw.recipient_id);
      return mid ? `dlv:${mid}:${by}` : null;
    }
    case 'message.update.ack': {
      // Acks carry an array of ids; dedupe is handled per-id by the router.
      return null;
    }
    case 'call.invite':
    case 'call.accept':
    case 'call.reject':
    case 'call.end': {
      const cid = str(raw.call_id);
      return cid ? `${type}:${cid}` : null;
    }
    case 'sync.digest':
    case 'sync.request':
    case 'receiver_ready':
    case 'message.read':
    case 'message.update':
      // Multi-item / idempotent-by-nature events: deduped at item granularity.
      return null;
    default:
      return null;
  }
}

/** Compute the correlation id for grouping related events. */
export function correlationId(type: RrpType, raw: Record<string, any>): string {
  const explicit = str(raw.correlation_id ?? raw.correlationId);
  if (explicit) return explicit;
  const mid = str(raw.message_id ?? raw.messageId);
  if (mid) return `msg:${mid}`;
  const cid = str(raw.call_id);
  if (cid) return `call:${cid}`;
  const rid = str(raw.room_id ?? raw.roomId);
  if (rid) return `room:${rid}`;
  return 'none';
}

/* ------------------------------------------------------------------ */
/*  Builders                                                            */
/* ------------------------------------------------------------------ */

let _seq = 0;
/** Generate a process-unique id (for outbound ephemeral / digest events). */
export function genId(): string {
  _seq = (_seq + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${_seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a typed envelope (a view) from a raw inbound flat payload. Never throws.
 */
export function toEnvelope<T extends Record<string, any> = Record<string, any>>(
  raw: T | null | undefined,
): RrpEnvelope<T> {
  const safe = (raw ?? {}) as T;
  const type = classify(safe);
  const id = idempotencyId(type, safe) ?? genId();
  return {
    v: num(safe.v) || RRP_VERSION,
    type,
    id,
    corr: correlationId(type, safe),
    room_id: str(safe.room_id ?? safe.roomId) ?? undefined,
    sender_id: num(safe.sender_id ?? safe.from_user_id ?? safe.caller_id),
    ts: str(safe.ts ?? safe.created_at) ?? new Date().toISOString(),
    payload: safe,
    ephemeral: EPHEMERAL_TYPES.has(type),
  };
}

/**
 * Construct an OUTBOUND envelope from a canonical type + flat payload. The
 * caller supplies the flat keys the transports understand; this stamps the
 * protocol metadata.
 */
export function makeEnvelope<T extends Record<string, any>>(
  type: RrpType,
  payload: T,
  opts?: { id?: string; corr?: string; room_id?: string; sender_id?: number; ttl?: number },
): RrpEnvelope<T> {
  return {
    v: RRP_VERSION,
    type,
    id: opts?.id ?? idempotencyId(type, payload) ?? genId(),
    corr: opts?.corr ?? correlationId(type, payload),
    room_id: opts?.room_id ?? str(payload.room_id ?? payload.roomId) ?? undefined,
    sender_id: opts?.sender_id ?? num(payload.sender_id),
    ts: new Date().toISOString(),
    ttl: opts?.ttl,
    payload,
    ephemeral: EPHEMERAL_TYPES.has(type),
  };
}

/**
 * Flatten an envelope into the wire object the existing transports send.
 * Keeps the flat keys (decision #3) and stamps `event`, plus the RRP metadata
 * fields so a future hardened relay can route without parsing the body.
 */
export function toWire(env: RrpEnvelope): Record<string, any> {
  const wireEvent = TYPE_TO_WIRE_EVENT[env.type] ?? env.type;
  return {
    ...env.payload,
    event: env.payload.event ?? wireEvent,
    rrp_v: env.v,
    rrp_id: env.id,
    rrp_corr: env.corr,
  };
}
