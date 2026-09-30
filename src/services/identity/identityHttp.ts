/** Wire limits shared by hosted and mobile adapters. No account has special authority. */
export const IDENTITY_HTTP_PREFIX = '/v2/identity/';
export const IDENTITY_HTTP_BYTES = 16_000;
export const IDENTITY_HTTP_TIMEOUT = 4_000;
export interface IdentityHttpService {
  describe(nonce: string): string | null;
  authenticate(raw: string): Promise<string | null>;
}
export async function identityHttpReply(service: IdentityHttpService, path: string, raw: string) {
  if (new TextEncoder().encode(raw).length > IDENTITY_HTTP_BYTES) return { status: 413, body: '{}' };
  try {
    let result: string | null;
    if (path === IDENTITY_HTTP_PREFIX + 'describe') {
      const body = JSON.parse(raw);
      if (body?.version !== 1 || typeof body.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(body.nonce)) return { status: 400, body: '{}' };
      result = service.describe(body.nonce);
    } else if (path === IDENTITY_HTTP_PREFIX + 'authenticate') result = await service.authenticate(raw);
    else return { status: 404, body: '{}' };
    if (!result) return { status: 403, body: '{}' };
    if (new TextEncoder().encode(result).length > IDENTITY_HTTP_BYTES) return { status: 500, body: '{}' };
    return { status: 200, body: result };
  } catch { return { status: 400, body: '{}' }; }
}

/** Bounded admission before reading bodies. Source must come from the actual transport,
 * never a request header. Limits include rejected cryptographic requests. */
export function createIdentityHttpGate(now: () => number) {
  const sources = new Map<string, { until: number; count: number }>();
  let until = 0, count = 0, active = 0;
  return (source: string): (() => void) | null => {
    const time = now();
    for (const [key, value] of sources) if (value.until <= time) sources.delete(key);
    if (until <= time) { until = time + 60_000; count = 0; }
    if (!source || source.length > 128 || active >= 8 || count >= 64) return null;
    let entry = sources.get(source);
    if (!entry) {
      if (sources.size >= 128) return null;
      entry = { until: time + 60_000, count: 0 }; sources.set(source, entry);
    }
    if (entry.count >= 16) return null;
    entry.count++; count++; active++;
    let released = false;
    return () => { if (!released) { released = true; active--; } };
  };
}
