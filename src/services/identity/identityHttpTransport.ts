import type { IdentityTransport } from './neuronIdentityConnection.ts';
import { IDENTITY_HTTP_PREFIX, IDENTITY_HTTP_BYTES, IDENTITY_HTTP_TIMEOUT } from './identityHttp.ts';

export interface IdentityFetchResponse {
  ok: boolean; redirected: boolean; headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<unknown> } } | null;
}
export type IdentityFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string;
  signal: AbortSignal; redirect: 'error'; credentials: 'omit' }) => Promise<IdentityFetchResponse>;

/** A bounded HTTP exchange channel, not a persistent socket or a liveness monitor.
 * Discovery must validate/authorize candidate endpoints before constructing this adapter.
 * Use expo/fetch on mobile; a fetch implementation without streaming fails closed. */
export function createIdentityHttpTransport(endpoint: string, fetch: IdentityFetch,
  options: { allowLoopbackHttp?: boolean } = {}): IdentityTransport {
  const url = new URL(endpoint);
  const loopback = options.allowLoopbackHttp && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Error('An exact HTTPS peer origin is required');
  }
  let closed = false, controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const close = () => {
    if (closed) return;
    closed = true; controller?.abort();
    for (const callback of [...listeners]) { try { callback(); } catch { /* Notify remaining listeners. */ } }
    listeners.clear();
  };
  return {
    close,
    onClosed(callback) { if (closed) callback(); else listeners.add(callback); return () => { listeners.delete(callback); }; },
    async exchange(operation, payload) {
      if (closed || controller) throw Error('Identity transport unavailable');
      if (!['describe', 'authenticate'].includes(operation) || new TextEncoder().encode(payload).length > IDENTITY_HTTP_BYTES) throw Error('Invalid identity request');
      const current = new AbortController(); controller = current;
      const timer = setTimeout(() => current.abort(), IDENTITY_HTTP_TIMEOUT);
      let reader: ReturnType<NonNullable<IdentityFetchResponse['body']>['getReader']> | undefined;
      try {
        const response = await fetch(url.origin + IDENTITY_HTTP_PREFIX + operation, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: payload,
          signal: current.signal, redirect: 'error', credentials: 'omit' });
        const length = response.headers.get('content-length');
        if (!response.ok || response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
          || (length !== null && (!/^\d+$/.test(length) || Number(length) > IDENTITY_HTTP_BYTES)) || !response.body) throw Error('Invalid identity response');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          if (closed || current.signal.aborted) throw Error('Identity exchange interrupted');
          const part = await reader.read(); if (part.done) break;
          if (!(part.value instanceof Uint8Array)) throw Error('Invalid response stream');
          size += part.value.length;
          if (size > IDENTITY_HTTP_BYTES) throw Error('Identity response too large');
          chunks.push(part.value);
        }
        if (closed || current.signal.aborted) throw Error('Identity exchange interrupted');
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) { close(); throw error; }
      finally {
        clearTimeout(timer); current.abort(); controller = null;
        if (reader) void reader.cancel().catch(() => {});
      }
    },
  };
}
