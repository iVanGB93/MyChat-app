export const MEDIA_MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
// Large uploads can take several minutes on a mobile connection. Keep the
// request bounded, but do not abort a healthy 250 MB transfer after 2 minutes.
export const MEDIA_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
export const MEDIA_BATCH_CONCURRENCY = 2;
export const MEDIA_PART_CONCURRENCY = 2;

export type MediaTransferErrorCode =
  | 'too_large'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_file'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'server_error'
  | 'unknown';

export interface MediaTransferFailure {
  code: MediaTransferErrorCode;
  message: string;
  retryable: boolean;
  status: number;
  maxBytes?: number;
}

/** Queueing is normal during picker/app transitions, not a transfer error. */
export function getTransferFeedback(results: readonly {
  state: 'sent' | 'queued' | 'failed';
  error?: MediaTransferFailure;
}[]): { title: string; message: string } | null {
  const failed = results.filter((result) => result.state === 'failed');
  if (failed.length) {
    return {
      title: failed.length === results.length ? 'Could not send' : 'Some items were not sent',
      message: `${results.length - failed.length} of ${results.length} queued or sent. ${failed[0].error?.message || 'One or more attachments could not be sent.'}`,
    };
  }
  const interrupted = results.find((result) => result.state === 'queued' && result.error);
  return interrupted ? { title: 'Transfer interrupted', message: interrupted.error!.message } : null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unit);
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function validateMediaSize(
  size: number | null | undefined,
  maxBytes = MEDIA_MAX_UPLOAD_BYTES,
): MediaTransferFailure | null {
  if (size == null || !Number.isFinite(size) || size < 0) return null;
  if (size <= maxBytes) return null;
  return {
    code: 'too_large',
    message: `This file is ${formatBytes(size)}. Axonic currently supports files up to ${formatBytes(maxBytes)}.`,
    retryable: false,
    status: 413,
    maxBytes,
  };
}

export function classifyMediaHttpFailure(
  status: number,
  serverMessage?: string | null,
  maxBytes = MEDIA_MAX_UPLOAD_BYTES,
): MediaTransferFailure {
  const detail = serverMessage?.trim();
  if (status === 413) {
    return {
      code: 'too_large',
      message: detail || `This file is larger than Axonic's ${formatBytes(maxBytes)} limit.`,
      retryable: false,
      status,
      maxBytes,
    };
  }
  if (status === 400 || status === 409 || status === 415 || status === 422) {
    return { code: 'invalid_file', message: detail || 'This file could not be processed.', retryable: false, status };
  }
  if (status === 401) {
    return { code: 'unauthorized', message: detail || 'Your session expired. Please sign in again.', retryable: false, status };
  }
  if (status === 403) {
    return { code: 'forbidden', message: detail || 'You no longer have permission to share in this chat.', retryable: false, status };
  }
  if (status === 404) {
    return { code: 'not_found', message: detail || 'The shared file or chat is no longer available.', retryable: false, status };
  }
  if (status === 408) {
    return { code: 'timeout', message: detail || 'The transfer timed out and will be retried.', retryable: true, status };
  }
  if (status === 429) {
    return { code: 'rate_limited', message: detail || 'The server is busy. Axonic will retry shortly.', retryable: true, status };
  }
  if (status >= 500) {
    return { code: 'server_error', message: detail || 'The server could not complete the transfer. Axonic will retry.', retryable: true, status };
  }
  return { code: 'unknown', message: detail || `Transfer failed (HTTP ${status}).`, retryable: false, status };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
  }));
  // Drain already-started work before allowing a caller to retry. Otherwise
  // uploads from a rejected batch keep running alongside the replacement.
  if (failed) throw firstError;
  return results;
}

/** One operation per identity, with a global (not per-screen) concurrency cap. */
export function createTransferScheduler<T>(concurrency: number) {
  const pending = new Map<string, Promise<T>>();
  const queue: Array<() => void> = [];
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let active = 0;

  function drain() {
    while (active < limit && queue.length) {
      active += 1;
      queue.shift()!();
    }
  }

  return (key: string, operation: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const task = new Promise<T>((resolve, reject) => {
      queue.push(() => {
        const finish = () => {
          pending.delete(key);
          active -= 1;
          drain();
        };
        // Defer work until its identity is registered, including sync throws.
        Promise.resolve().then(operation).then(
          (value) => { finish(); resolve(value); },
          (error) => { finish(); reject(error); },
        );
      });
    });
    pending.set(key, task);
    drain();
    return task;
  };
}
