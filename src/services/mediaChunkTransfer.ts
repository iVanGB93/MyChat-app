/* ------------------------------------------------------------------ */
/*  Media Chunk Transfer (receiver reassembly)                          */
/*                                                                      */
/*  Large photos/voice can't ride in a single WS frame (the server edge  */
/*  drops any frame > 1 MiB). The sender splits the media's base64 into  */
/*  slices and streams them as `media_chunk` frames; this module buffers  */
/*  the slices per message id and, once every slice has arrived,          */
/*  reassembles the full base64 and feeds it through the normal ingest    */
/*  pipeline — which decodes it, writes the file to disk and hydrates the  */
/*  placeholder bubble. Media bytes never touch the server's storage.     */
/* ------------------------------------------------------------------ */

interface Transfer {
  roomId: string;
  senderId: number;
  messageType: string; // 'image' | 'voice'
  mime: string;
  total: number;
  parts: Map<number, string>;
  firstAt: number;
}

/** In-flight transfers keyed by message id. In-memory only — an incomplete
 *  transfer lost to an app restart is recovered by the media-hydration path. */
const _transfers = new Map<string, Transfer>();

/** Bound concurrent transfers and their lifetime so a dropped stream (e.g. the
 *  sender went offline mid-way) can't leak memory. */
const MAX_TRANSFERS = 24;
const TRANSFER_TTL_MS = 5 * 60_000;

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, t] of _transfers) {
    if (now - t.firstAt > TRANSFER_TTL_MS) _transfers.delete(id);
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Handle one inbound `media_chunk` frame. Buffers the slice and, when the
 * transfer is complete, reassembles the media and hands it to the ingest
 * pipeline. Safe to call repeatedly / out of order / with duplicates.
 */
export async function receiveMediaChunk(frame: Record<string, any>): Promise<void> {
  const messageId = String(frame.id ?? frame.message_id ?? '');
  const roomId = String(frame.room_id ?? '');
  const senderId = num(frame.sender_id);
  const messageType = String(frame.media_type ?? frame.message_type ?? '');
  const mime = String(frame.mime ?? '');
  const seq = num(frame.seq);
  const total = num(frame.total);
  const dataSlice = typeof frame.data === 'string' ? frame.data : '';

  if (
    !messageId ||
    !roomId ||
    !Number.isFinite(senderId) ||
    !Number.isInteger(seq) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    seq < 0 ||
    seq >= total ||
    !dataSlice
  ) {
    return;
  }

  sweepExpired();

  let t = _transfers.get(messageId);
  if (!t) {
    if (_transfers.size >= MAX_TRANSFERS) {
      // Evict the oldest transfer to keep memory bounded.
      let oldestId: string | null = null;
      let oldestAt = Infinity;
      for (const [id, tr] of _transfers) {
        if (tr.firstAt < oldestAt) { oldestAt = tr.firstAt; oldestId = id; }
      }
      if (oldestId) _transfers.delete(oldestId);
    }
    t = {
      roomId,
      senderId,
      messageType,
      mime,
      total,
      parts: new Map<number, string>(),
      firstAt: Date.now(),
    };
    _transfers.set(messageId, t);
  }

  t.parts.set(seq, dataSlice);
  if (t.parts.size < t.total) return; // still waiting for more slices

  // Reassemble in order. Bail (keep buffering) if any slice is somehow missing.
  let b64 = '';
  for (let i = 0; i < t.total; i++) {
    const part = t.parts.get(i);
    if (part == null) return;
    b64 += part;
  }
  _transfers.delete(messageId);

  // Feed the reassembled media through the normal ingest pipeline. This reuses
  // every existing step: decode → write file → hydrate the placeholder row (or
  // persist a fresh row) → refresh the open chat + chat-list preview.
  const isVoice = t.messageType === 'voice';
  const frameForIngest: Record<string, any> = {
    message_id: messageId,
    room_id: t.roomId,
    sender_id: t.senderId,
    message_type: t.messageType,
    ...(isVoice
      ? { audio_b64: b64, audio_mime: t.mime || 'audio/m4a' }
      : { image_b64: b64, image_mime: t.mime || 'image/jpeg' }),
  };
  try {
    const { ingestMessage } = await import('./ingressRouter');
    await ingestMessage(frameForIngest, 'ws');
    console.log('[MediaChunk] reassembled', t.total, 'chunks for', messageId);
  } catch (err) {
    console.warn('[MediaChunk] reassembly ingest failed:', err);
  }
}
