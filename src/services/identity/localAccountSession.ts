/** A remembered login lives in the OS keystore, never in public/local profile storage. */
export function createLocalAccountSession(d: {
  identity: { status(): {state: string; account: string | null}; unlock(password: string): Promise<void>; lock(): void };
  readPolicy(): Promise<string | null>; writePolicy(value: string): Promise<void>;
  readCredential(): Promise<string | null>; writeCredential(value: string): Promise<void>; removeCredential(): Promise<void>;
}) {
  let autoLock = false, manuallyLocked = false, epoch = 0;
  let queue = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work); queue = result.then(() => {}, () => {}); return result;
  };
  async function remember(password: string) {
    const own = epoch, account = d.identity.status().account;
    if (autoLock || !account || d.identity.status().state !== 'unlocked') return;
    await serialize(async () => {
      if (own !== epoch || autoLock || d.identity.status().state !== 'unlocked' || d.identity.status().account !== account) return;
      await d.writeCredential(JSON.stringify({version: 1, account, password}));
      if (own !== epoch || autoLock || d.identity.status().state !== 'unlocked') { await d.removeCredential(); return; }
      // A successful explicit login clears a previous manual-lock marker.
      if (manuallyLocked) {
        await d.writePolicy('0');
        if (own === epoch) manuallyLocked = false;
      }
    });
  }
  return {
    autoLock: () => autoLock,
    remember,
    async initialize() {
      const own = epoch;
      const policy = await d.readPolicy();
      if (own !== epoch) return;
      // Only an absent preference (the default) or an explicit opt-out allows resume.
      manuallyLocked = policy === 'locked';
      autoLock = policy !== null && policy !== '0' && !manuallyLocked;
      if (autoLock || manuallyLocked) {
        // Persisted policy denies automatic login even when optional cleanup fails.
        await serialize(d.removeCredential).catch(() => {}); return;
      }
      const account = d.identity.status().account;
      const raw = await d.readCredential();
      if (!raw || !account || own !== epoch || d.identity.status().state !== 'locked') return;
      try {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || saved.account !== account || typeof saved.password !== 'string') throw Error('Invalid remembered login');
        if (own !== epoch || autoLock) return;
        await d.identity.unlock(saved.password);
        if (own !== epoch || autoLock) d.identity.lock();
      } catch { if (own === epoch) await serialize(d.removeCredential); }
    },
    async setAutoLock(enabled: boolean, password?: string) {
      const own = ++epoch;
      if (!enabled) {
        if (!password) throw Error('Enter your password to keep this device signed in');
        await d.identity.unlock(password);
        if (own !== epoch) { d.identity.lock(); throw Error('Account operation interrupted'); }
      }
      autoLock = true; // Fail closed while persistence is in progress.
      await serialize(async () => {
        if (own !== epoch) throw Error('Account operation interrupted');
        // Persist the opt-in first: a failed keystore deletion must not resume at startup.
        if (enabled) {
          try { await d.writePolicy('1'); } finally { await d.removeCredential(); }
        } else await d.removeCredential();
        if (own !== epoch) throw Error('Account operation interrupted');
        if (!enabled) await d.writePolicy('0');
      });
      if (own !== epoch) throw Error('Account operation interrupted');
      autoLock = enabled; manuallyLocked = false;
      if (!enabled) await remember(password!);
    },
    async lock() {
      epoch++; manuallyLocked = true; d.identity.lock();
      await serialize(async () => {
        // Manual lock requires a new explicit login, without changing the user's default.
        try { await d.writePolicy(autoLock ? '1' : 'locked'); }
        finally { await d.removeCredential(); }
      });
    },
    async forget() { epoch++; await serialize(d.removeCredential); },
  };
}
