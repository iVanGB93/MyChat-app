/** Durable delivery receipts. Storage mutations are serialized; HTTP never holds the lock. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const RETRY_QUEUE_KEY = '@axonic_message_ack_retry_queue';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
let queueWriteTail: Promise<void> = Promise.resolve();
let flushing: Promise<{ flushed: number; failed: number }> | null = null;
let generation = 0;

function serializeQueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queueWriteTail.then(work, work);
  queueWriteTail = run.then(() => undefined, () => undefined);
  return run;
}
export interface QueuedMessageAck {
  id: string;
  message_id: string;
  sender_id: number;
  room_id: string;
  delivered_at?: string;
  device_id?: string;
  created_at: number;
  last_retry_at?: number;
  retry_count: number;
  next_retry_at: number;
}
async function readQueue(): Promise<QueuedMessageAck[]> {
  const raw = await AsyncStorage.getItem(RETRY_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function writeQueue(queue: QueuedMessageAck[]): Promise<void> {
  if (queue.length) await AsyncStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
  else await AsyncStorage.removeItem(RETRY_QUEUE_KEY);
}
export async function enqueueMessageAck(ack: Omit<QueuedMessageAck, 'id' | 'created_at' | 'last_retry_at' | 'retry_count' | 'next_retry_at'>): Promise<boolean> {
  return serializeQueue(async () => {
    try {
      const queue = await readQueue();
      if (queue.some((item) => item.message_id === ack.message_id && item.room_id === ack.room_id && item.sender_id === ack.sender_id)) return true;
      const now = Date.now();
      queue.push({ ...ack, id: ack.message_id + '-' + now + '-' + Math.random(), created_at: now, retry_count: 0, next_retry_at: now + INITIAL_BACKOFF_MS });
      await writeQueue(queue);
      return true;
    } catch {
      console.warn('[AckRetryQueue] failed to persist receipt');
      return false;
    }
  });
}
export async function removeMessageAck(messageId: string, senderId: number, roomId: string): Promise<void> {
  return serializeQueue(async () => {
    const queue = await readQueue();
    await writeQueue(queue.filter((ack) => ack.message_id !== messageId || ack.sender_id !== senderId || ack.room_id !== roomId));
  });
}
export function flushPendingAcks(options: { force?: boolean } = {}): Promise<{ flushed: number; failed: number }> {
  if (flushing) return flushing;
  const epoch = generation;
  const work = (async () => {
    // Bound background work; do not discard receipts just because they are old.
    const snapshot = await serializeQueue(async () => (await readQueue())
      .filter((item) => options.force || item.next_retry_at <= Date.now())
      .sort((a, b) => a.next_retry_at - b.next_retry_at).slice(0, 20));
    let flushed = 0, failed = 0;
    const outcomes = new Map<string, QueuedMessageAck | null>();
    for (let offset = 0; offset < snapshot.length && generation === epoch; offset += 5) {
      await Promise.all(snapshot.slice(offset, offset + 5).map(async (ack) => {
        try {
          const response = await api.post('/api/chat/messages/ack/', {
            message_id: ack.message_id, sender_id: ack.sender_id, room_id: ack.room_id,
            delivered_at: ack.delivered_at, device_id: ack.device_id,
          });
          if (response.status === 200 && ['delivered', 'already_delivered'].includes(response.data?.status)) {
            outcomes.set(ack.id, null); flushed++; return;
          }
        } catch { /* Keep network/auth/server failures for retry. */ }
        const now = Date.now();
        outcomes.set(ack.id, { ...ack, retry_count: ack.retry_count + 1, last_retry_at: now,
          next_retry_at: now + Math.min(INITIAL_BACKOFF_MS * 2 ** Math.min(ack.retry_count, 16), MAX_BACKOFF_MS) });
        failed++;
      }));
    }
    await serializeQueue(async () => {
      if (generation !== epoch) return;
      // Merge CURRENT storage, preserving new items and concurrent removals.
      const current = await readQueue();
      await writeQueue(current.flatMap((item) => {
        if (!outcomes.has(item.id)) return [item];
        const outcome = outcomes.get(item.id);
        return outcome ? [outcome] : [];
      }));
    });
    return { flushed, failed };
  })().catch(() => ({ flushed: 0, failed: 0 }));
  flushing = work;
  void work.finally(() => { if (flushing === work) flushing = null; });
  return work;
}
export async function getQueueStatus(): Promise<QueuedMessageAck[]> {
  try { return await serializeQueue(readQueue); } catch { return []; }
}
export async function clearQueue(): Promise<void> {
  generation++;
  return serializeQueue(() => AsyncStorage.removeItem(RETRY_QUEUE_KEY));
}
