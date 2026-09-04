/**
 * Durable confirmation queue for verified media downloads.
 *
 * The DigitalOcean object cannot enter its deletion grace period until every
 * recipient has confirmed that a verified copy is safely stored on-device.
 * Android may suspend a killed-app FCM task immediately after the download, so
 * persist the confirmation before attempting the request and retry it from
 * every recovery path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { getInstallationId } from './installationIdentity';
import { debugLog } from './diagnostics';

const QUEUE_KEY = '@axonic_media_download_confirmations';
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_QUEUE_AGE_MS = 35 * 24 * 60 * 60 * 1_000;

interface PendingMediaConfirmation {
  media_id: string;
  created_at: number;
  retry_count: number;
  next_retry_at: number;
}

let queueWriteTail: Promise<void> = Promise.resolve();

function serializeQueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queueWriteTail.then(work, work);
  queueWriteTail = run.then(() => undefined, () => undefined);
  return run;
}

async function readQueue(): Promise<PendingMediaConfirmation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingMediaConfirmation[]): Promise<void> {
  if (queue.length) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  else await AsyncStorage.removeItem(QUEUE_KEY);
}

async function enqueue(mediaId: string): Promise<void> {
  await serializeQueue(async () => {
    const queue = await readQueue();
    if (queue.some((entry) => entry.media_id === mediaId)) return;
    const now = Date.now();
    queue.push({
      media_id: mediaId,
      created_at: now,
      retry_count: 0,
      next_retry_at: now + INITIAL_BACKOFF_MS,
    });
    await writeQueue(queue);
  });
}

async function remove(mediaId: string): Promise<void> {
  await serializeQueue(async () => {
    const queue = await readQueue();
    await writeQueue(queue.filter((entry) => entry.media_id !== mediaId));
  });
}

async function submit(mediaId: string): Promise<boolean> {
  const installation_id = await getInstallationId();
  const response = await api.post(`/api/chat/media/${mediaId}/downloaded/`, { installation_id });
  if (response.status < 200 || response.status >= 300 || response.data?.ok === false) return false;
  await remove(mediaId);
  return true;
}

/** Queue first, then attempt immediately. The boolean reports whether the
 * server accepted the confirmation, not whether all room members confirmed. */
export async function confirmMediaDownloaded(mediaId: string): Promise<boolean> {
  if (!mediaId) return false;
  await enqueue(mediaId);
  try {
    const accepted = await submit(mediaId);
    if (accepted) debugLog('[MediaConfirm] submitted', mediaId);
    return accepted;
  } catch {
    // The durable row remains for foreground/network/background recovery.
    return false;
  }
}

/** Retry confirmations. `force` is used at reliable lifecycle boundaries so a
 * just-failed headless request gets one more chance before Android suspends it. */
export function flushPendingMediaConfirmations(
  options: { force?: boolean } = {},
): Promise<{ flushed: number; failed: number }> {
  return serializeQueue(async () => {
    const queue = await readQueue();
    if (!queue.length) return { flushed: 0, failed: 0 };

    const now = Date.now();
    const remaining: PendingMediaConfirmation[] = [];
    let flushed = 0;
    let failed = 0;

    for (const entry of queue) {
      if (now - entry.created_at > MAX_QUEUE_AGE_MS) continue;
      if (!options.force && entry.next_retry_at > now) {
        remaining.push(entry);
        continue;
      }
      try {
        const installation_id = await getInstallationId();
        const response = await api.post(
          `/api/chat/media/${entry.media_id}/downloaded/`,
          { installation_id },
        );
        if (response.status >= 200 && response.status < 300 && response.data?.ok !== false) {
          flushed += 1;
          continue;
        }
      } catch {
        // Back off below; authentication/network recovery will invoke us again.
      }
      const retryCount = entry.retry_count + 1;
      remaining.push({
        ...entry,
        retry_count: retryCount,
        next_retry_at: now + Math.min(INITIAL_BACKOFF_MS * (2 ** retryCount), MAX_BACKOFF_MS),
      });
      failed += 1;
    }

    await writeQueue(remaining);
    if (flushed || failed) {
      debugLog('[MediaConfirm] flush', { flushed, failed, remaining: remaining.length });
    }
    return { flushed, failed };
  });
}

export async function getPendingMediaConfirmations(): Promise<PendingMediaConfirmation[]> {
  return readQueue();
}
