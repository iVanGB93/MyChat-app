/** Foreground refresh; backgrounding preserves the lease so push can wake the app. */
export function createPushRegistration(d: { current(): boolean; token(): Promise<string | null>; now(): number; request(raw: string): Promise<string | null>; binding?(): Promise<unknown>; rotateToken?():Promise<void>; diagnostic?(stage:string):void }) {
  let stopped = false, busy = false, next = 0, epoch = 0;
  let retryBindingAt=0;
  return {
    async tick() {
      if (stopped || busy || !d.current() || d.now() < next) return;
      busy = true; const own = epoch; next = d.now() + 30000;
      let stage='token';
      try {
        const token = await d.token(); if (!token || stopped || own !== epoch || !d.current()) return;
        stage='binding';let binding: unknown;
        try { if(d.now()>=retryBindingAt)binding = await d.binding?.(); } catch { /* Older backend: keep direct registration available. */ }
        if (stopped || own !== epoch || !d.current()) return;
        stage='registration';const raw = await d.request(JSON.stringify({ version: 1, operation: 'register', token, ...(binding ? { binding } : {}) }));
        if (stopped || own !== epoch || !d.current()) return;
        const reply = raw ? JSON.parse(raw) : null;
        const known=['registered','token_in_use','binding_rejected','unauthorized','invalid','capacity'];
        d.diagnostic?.(known.includes(reply?.status)?reply.status:raw?'registration-rejected':'route-unavailable');
        // A legacy migration anchor must not block this authenticated crypto device's own wake registration.
        // Retry without a migration ticket; never overwrite the existing Django binding.
        if(reply?.status==='binding_rejected')retryBindingAt=d.now()+300000;
        // A restored installation may retain a token leased to its previous identity.
        // Rotate our own FCM token instead of taking over another identity's lease.
        if(reply?.status==='token_in_use'&&d.rotateToken){stage='token-rotation';await d.rotateToken();}
        if (reply?.status === 'registered' && Number.isSafeInteger(reply.until) && reply.until > d.now()) next = Math.min(d.now() + (d.binding && !reply.bound ? 30000 : 3600000), reply.until - 60000);
      } catch { d.diagnostic?.(stage+'-failed'); /* Never log a token or transport payload. */ }
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
