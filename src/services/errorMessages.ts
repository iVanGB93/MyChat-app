/* ------------------------------------------------------------------ */
/*  User-facing error message helpers                                   */
/*                                                                      */
/*  Converts Axios errors / arbitrary thrown values into short,         */
/*  human-readable strings suitable for showing in an alert.            */
/* ------------------------------------------------------------------ */

import axios from 'axios';

interface FormatOptions {
  /** Fallback string when no useful info is available. */
  fallback?: string;
  /**
   * Optional map of HTTP status code → user-facing message. Takes
   * precedence over the generic detail extraction so callers can give
   * domain-specific copy (e.g. "Invalid username or password" for 401
   * on the login screen).
   */
  statusMessages?: Record<number, string>;
}

/**
 * Pull a readable string out of a DRF-style error body.
 *
 *   { "detail": "..." }                       → "..."
 *   { "non_field_errors": ["..."] }           → "..."
 *   { "username": ["..."], "email": ["..."]} → "..."
 *   "plain string"                             → "plain string"
 */
function extractDrfMessage(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data.trim() || null;
  if (typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Common single-field shapes first.
  const single = obj.detail ?? obj.error ?? obj.message;
  if (typeof single === 'string' && single.trim()) return single.trim();

  const nfe = obj.non_field_errors;
  if (Array.isArray(nfe) && typeof nfe[0] === 'string') return String(nfe[0]);

  // Generic per-field aggregation: "field: msg" lines.
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'detail' || key === 'error' || key === 'message') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string' && v.trim()) lines.push(`${key}: ${v}`);
    } else if (typeof value === 'string' && value.trim()) {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.length ? lines.join('\n') : null;
}

/**
 * Format an unknown thrown value (typically from an Axios call) into a
 * concise user-facing string.
 */
export function formatApiError(err: unknown, opts: FormatOptions = {}): string {
  const fallback = opts.fallback ?? 'Something went wrong. Please try again.';

  // Network / timeout / DNS failures — no response from server.
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      if (err.code === 'ECONNABORTED') {
        return 'The server took too long to respond. Please try again.';
      }
      return 'Unable to reach the server. Check your internet connection and try again.';
    }

    const status = err.response.status;
    if (opts.statusMessages && opts.statusMessages[status]) {
      return opts.statusMessages[status];
    }

    const fromBody = extractDrfMessage(err.response.data);
    if (fromBody) return fromBody;

    // Sensible defaults per status if the body had nothing useful.
    if (status === 401) return 'Authentication failed. Please sign in again.';
    if (status === 403) return 'You do not have permission to do that.';
    if (status === 404) return 'Resource not found.';
    if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
    if (status >= 500) return 'The server is having problems. Please try again in a moment.';

    return fallback;
  }

  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
