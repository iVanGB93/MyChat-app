/** One foreground identity owner. Superseded opens finish before another open starts,
 * while their keys and session permissions are invalidated immediately.
 */
export function createAccountIdentityLifecycle<T extends { lock(): void }>(d: {
  create(owner: number): T;
  unlock(owner: number, identity: T, current: () => boolean): Promise<void>;
  attach(owner: number, identity: T, current: () => boolean): () => void;
}) {
  let desired: number | null = null, epoch = 0, stopped = false, running: Promise<void> | null = null;
  let opened: T | null = null, detach: (() => void) | null = null;
  let state: 'idle' | 'opening' | 'ready' | 'error' = 'idle';
  function release() {
    const stop = detach; detach = null;
    try { stop?.(); } catch { /* Still release keys if session cleanup fails. */ }
    const previous = opened; opened = null;
    previous?.lock();
  }
  function launch() {
    if (running || stopped || desired === null) return;
    const owner = desired, generation = epoch;
    const current = () => !stopped && epoch === generation && desired === owner;
    state = 'opening';
    // Defer creation so the running marker is installed before callbacks can reenter.
    running = Promise.resolve().then(async () => {
      let identity: T | null = null;
      try {
        if (!current()) return;
        identity = d.create(owner); opened = identity;
        await d.unlock(owner, identity, current);
        if (!current()) return;
        const stop = d.attach(owner, identity, current);
        if (!current()) { stop(); return; }
        detach = stop; state = 'ready';
      } catch {
        if (current()) { release(); state = 'error'; }
      } finally {
        if (!current()) identity?.lock();
      }
    }).finally(() => {
      running = null;
      if (epoch !== generation) launch();
    });
  }
  return {
    set(owner: number | null, foreground: boolean) {
      const next = foreground && Number.isSafeInteger(owner) && Number(owner) > 0 ? owner : null;
      if (stopped || next === desired) return;
      desired = next; epoch++; release(); state = 'idle'; launch();
    },
    retry() { if (!stopped && state === 'error') { epoch++; state = 'idle'; launch(); } },
    snapshot: () => ({ owner: desired, state }),
    async settled() { while (running) await running; },
    stop() { stopped = true; desired = null; epoch++; release(); state = 'idle'; },
  };
}
