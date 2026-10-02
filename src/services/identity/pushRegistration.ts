/** Foreground refresh; backgrounding preserves the lease so push can wake the app. */
export function createPushRegistration(d: { current(): boolean; token(): Promise<string | null>; now(): number; request(raw: string): Promise<string | null>; binding?(): Promise<unknown> }) {
  let stopped = false, busy = false, next = 0, epoch = 0;
  return {
    async tick() {
      if (stopped || busy || !d.current() || d.now() < next) return;
      busy = true; const own = epoch; next = d.now() + 30000;
      try {
        const token = await d.token(); if (!token || stopped || own !== epoch || !d.current()) return;
        let binding: unknown;
        try { binding = await d.binding?.(); } catch { /* Older backend: keep direct registration available. */ }
        if (stopped || own !== epoch || !d.current()) return;
        const raw = await d.request(JSON.stringify({ version: 1, operation: 'register', token, ...(binding ? { binding } : {}) }));
        if (stopped || own !== epoch || !d.current()) return;
        const reply = raw ? JSON.parse(raw) : null;
        if (reply?.status === 'registered' && Number.isSafeInteger(reply.until) && reply.until > d.now()) next = Math.min(d.now() + (d.binding && !reply.bound ? 30000 : 3600000), reply.until - 60000);
      } catch { /* Retry without logging a token or transport payload. */ }
      finally { busy = false; }
    },
    invalidate() { epoch++; next = 0; },
    async revoke() {
      epoch++; stopped = true;
      try { return JSON.parse(await d.request(JSON.stringify({ version: 1, operation: 'unregister' })) ?? '{}').status === 'removed'; }
      catch { return false; }
    },
    stop() { epoch++; stopped = true; },
  };
}
