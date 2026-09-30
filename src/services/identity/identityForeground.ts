/** App-wide key ownership. Screens observe identity state; backgrounding locks it.
 * A late unlock while inactive is immediately locked again, including during startup.
 */
export function observeIdentityForeground(d: {
  identity: { status(): { state: string }; lock(): void; subscribe(fn: () => void): () => void };
  currentState(): string | null;
  subscribeState(fn: (state: string) => void): () => void;
}) {
  let state = d.currentState(), disposed = false, locking = false;
  function lock() {
    if (locking) return;
    locking = true;
    try { d.identity.lock(); } finally { locking = false; }
  }
  function enforce() {
    if (disposed || state === 'active') return;
    if (['unlocked', 'backup'].includes(d.identity.status().state)) lock();
  }
  const unsubscribeIdentity = d.identity.subscribe(enforce);
  const unsubscribeState = d.subscribeState(next => {
    if (disposed) return;
    state = next;
    if (state !== 'active') lock();
  });
  if (state !== 'active') lock();
  return () => {
    if (disposed) return;
    disposed = true; unsubscribeIdentity(); unsubscribeState(); lock();
  };
}
