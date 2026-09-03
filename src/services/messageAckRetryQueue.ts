/**
 * messageAckRetryQueue.ts
 * 
 * Manages a persistent retry queue for message delivery acknowledgments.
 * When the HTTP ACK fails (offline, auth issue, etc), it's stored and retried later
 * on network restore, periodic background check, or auth refresh.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { debugLog } from './diagnostics';

const RETRY_QUEUE_KEY = '@axonic_message_ack_retry_queue';
const MAX_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

// Several transports may acknowledge the same burst concurrently (Axion, push
// receive, and a foreground reconnect). AsyncStorage read-modify-write is not
// atomic, so serialize mutations to prevent a flush from overwriting a newly
// queued acknowledgement.
let queueWriteTail: Promise<void> = Promise.resolve();
function serializeQueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queueWriteTail.then(work, work);
  queueWriteTail = run.then(() => undefined, () => undefined);
  return run;
}

export interface QueuedMessageAck {
  id: string; // unique ID for this retry attempt
  message_id: string;
  sender_id: number;
  room_id: string;
  delivered_at?: string;
  device_id?: string;
  created_at: number; // timestamp when ack was first attempted
  last_retry_at?: number; // timestamp of last retry attempt
  retry_count: number;
  next_retry_at: number; // timestamp when next retry should happen
}

/**
 * Enqueue a message ACK for retry (e.g. when HTTP ack fails).
 * Returns true if queued, false if too old to retry.
 */
export async function enqueueMessageAck(ack: Omit<QueuedMessageAck, 'id' | 'created_at' | 'last_retry_at' | 'retry_count' | 'next_retry_at'>): Promise<boolean> {
  return serializeQueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(RETRY_QUEUE_KEY);
      const queue: QueuedMessageAck[] = raw ? JSON.parse(raw) : [];
    
    // Check if this ack is already in the queue (avoid duplicates)
    const alreadyQueued = queue.some(
      (q) => q.message_id === ack.message_id && q.room_id === ack.room_id && q.sender_id === ack.sender_id
    );
    if (alreadyQueued) {
      debugLog('[AckRetryQueue] ack already queued:', ack.message_id);
      return true;
    }
    
    const now = Date.now();
    const queuedItem: QueuedMessageAck = {
      id: `${ack.message_id}-${now}-${Math.random()}`,
      ...ack,
      created_at: now,
      retry_count: 0,
      next_retry_at: now + INITIAL_BACKOFF_MS,
    };
    
    queue.push(queuedItem);
    await AsyncStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
    
    debugLog('[AckRetryQueue] enqueued ack:', ack.message_id, '(queue size:', queue.length, ')');
      return true;
    } catch (err) {
      console.warn('[AckRetryQueue] failed to enqueue:', err);
      return false;
    }
  });
}

/** Remove only a receipt the server actually accepted; preserve other retries. */
export async function removeMessageAck(messageId: string, senderId: number, roomId: string): Promise<void> {
  return serializeQueue(async () => {
    const raw = await AsyncStorage.getItem(RETRY_QUEUE_KEY);
    if (!raw) return;
    const queue: QueuedMessageAck[] = JSON.parse(raw);
    const remaining = queue.filter((ack) =>
      ack.message_id !== messageId || ack.sender_id !== senderId || ack.room_id !== roomId);
    if (remaining.length === queue.length) return;
    if (remaining.length) await AsyncStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(remaining));
    else await AsyncStorage.removeItem(RETRY_QUEUE_KEY);
  });
}

/**
 * Flush pending ACKs by attempting HTTP POST to the backend.
 * Retries with exponential backoff; removes successful acks; re-queues failures.
 */
export async function flushPendingAcks(): Promise<{ flushed: number; failed: number }> {
  return serializeQueue(async () => {
    try {
      const raw = await AsyncStorage.getItem(RETRY_QUEUE_KEY);
      if (!raw) return { flushed: 0, failed: 0 };
    
    const queue: QueuedMessageAck[] = JSON.parse(raw);
    if (!queue.length) return { flushed: 0, failed: 0 };
    
    const now = Date.now();
    const readyToRetry = queue.filter((q) => q.next_retry_at <= now);
    
    if (!readyToRetry.length) {
      debugLog('[AckRetryQueue] no acks ready to retry yet');
      return { flushed: 0, failed: 0 };
    }
    
    let flushed = 0;
    let failed = 0;
    const toRemove = new Set<string>();
    const toKeep: QueuedMessageAck[] = [];
    
    for (const ack of readyToRetry) {
      // Skip if too old (beyond retry window)
      if (now - ack.created_at > MAX_RETRY_WINDOW_MS) {
        console.warn(
          '[AckRetryQueue] dropping ack (too old):', ack.message_id,
          'age:', Math.round((now - ack.created_at) / 1000), 's'
        );
        toRemove.add(ack.id);
        continue;
      }
      
      try {
        const response = await api.post('/api/chat/messages/ack/', {
          message_id: ack.message_id,
          sender_id: ack.sender_id,
          room_id: ack.room_id,
          delivered_at: ack.delivered_at,
          device_id: ack.device_id,
        });
        
        // A newly relayed message can arrive before its delivery row exists.
        // HTTP 200 with not_found is not a receipt: keep it for a later retry.
        if (response.status === 200 && response.data?.status !== 'not_found') {
          debugLog('[AckRetryQueue] flushed ack:', ack.message_id);
          toRemove.add(ack.id);
          flushed++;
          continue;
        }
      } catch (err: any) {
        // Check if it's a client error (4xx) vs server error (5xx) or network
        const status = err?.response?.status;
        if (status === 400 || status === 404) {
          // Client error: don't retry, just drop it
          console.warn('[AckRetryQueue] dropping ack (client error):', ack.message_id, 'status:', status);
          toRemove.add(ack.id);
          continue;
        }
        // Network error or 5xx: keep it and retry later
      }
      
      // Retry failed — update backoff and keep in queue
      const nextBackoff = Math.min(
        INITIAL_BACKOFF_MS * Math.pow(2, ack.retry_count),
        MAX_BACKOFF_MS
      );
      toKeep.push({
        ...ack,
        retry_count: ack.retry_count + 1,
        last_retry_at: now,
        next_retry_at: now + nextBackoff,
      });
      failed++;
    }
    
    // Combine: successful removals + non-ready items + updated retries
    const updated = [
      ...queue.filter((q) => !toRemove.has(q.id) && !readyToRetry.includes(q)),
      ...toKeep,
    ];
    
    if (updated.length) {
      await AsyncStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(updated));
    } else {
      await AsyncStorage.removeItem(RETRY_QUEUE_KEY);
    }
    
    if (flushed > 0 || failed > 0) {
      debugLog('[AckRetryQueue] flush complete:', { flushed, failed, remaining: updated.length });
    }
    
      return { flushed, failed };
    } catch (err) {
      console.warn('[AckRetryQueue] flush failed:', err);
      return { flushed: 0, failed: 0 };
    }
  });
}

/**
 * Get current queue status (for debugging).
 */
export async function getQueueStatus(): Promise<QueuedMessageAck[]> {
  try {
    const raw = await AsyncStorage.getItem(RETRY_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clear the entire queue (e.g. on logout).
 */
export async function clearQueue(): Promise<void> {
  return serializeQueue(async () => {
    try {
      await AsyncStorage.removeItem(RETRY_QUEUE_KEY);
      debugLog('[AckRetryQueue] queue cleared');
    } catch (err) {
      console.warn('[AckRetryQueue] failed to clear queue:', err);
    }
  });
}
