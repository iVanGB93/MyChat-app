export const MEDIA_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MEDIA_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
export const MEDIA_BATCH_CONCURRENCY = 2;

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

  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

