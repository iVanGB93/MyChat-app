/** OS-protected credential retrieval is the authorization, never a boolean UI result. */
export function createLocalAccountBiometrics(d: {
  identity: { unlock(password: string): Promise<void>; lock(): void; status(): { state: string } };
  available(): boolean; read(): Promise<string | null>; write(password: string): Promise<void>; remove(): Promise<void>;
}) {
  let epoch = 0, busy = false;
  const current = (e: number) => { if (epoch !== e) throw Error('Account operation interrupted'); };
  async function run(work: (e: number) => Promise<void>) {
    if (busy) throw Error('An account operation is already running');
    busy = true; const e = epoch;
    try { await work(e); } finally { busy = false; }
  }
  return {
    available: d.available,
    enroll(password: string) { return run(async e => {
      if (!d.available()) throw Error('Set up biometrics in device settings first');
      await d.identity.unlock(password); current(e);
      let completed = false;
      try { await d.write(password); current(e); completed = true; }
      finally { if (!completed) await d.remove(); }
    }); },
    unlock() { return run(async e => {
      if (!d.available()) throw Error('Biometrics unavailable. Use your password.');
      const password = await d.read(); current(e);
      if (!password) throw Error('Biometric credential unavailable. Use your password and enable biometrics again.');
      await d.identity.unlock(password);
      if (epoch !== e) { d.identity.lock(); current(e); }
    }); },
    disable() { return run(async () => { await d.remove(); }); },
    lock() { epoch++; d.identity.lock(); },
  };
}
