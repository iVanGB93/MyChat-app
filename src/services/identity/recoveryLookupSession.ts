import { createLocalIdentity, destroyIdentity, type SecureRandom, type UnlockedIdentity } from './identityVault';
import { createPersistentAxon, type AxonWire } from './persistentAxon';
import { createIdentityDirectoryLookup, unavailableDirectoryLookup } from './identityDirectoryLookup';
import { DIRECTORY_DOMAIN } from './identityDirectory';
import type { IdentityRecordStore } from './identityAdmission';
import type { IdentityRecord } from './identityProtocol';
/** One in-memory visitor per recovery screen. Never signs a change to the recovering account.
 * The peer may retain its ordinary admission pin for this visitor; no directory record is published.
 */
export function createRecoveryLookupSession(d: {
  random: SecureRandom; now(): number; peer: string; store: IdentityRecordStore;
  connect(account: string, signal: AbortSignal): Promise<AxonWire>;
}) {
  const abort = new AbortController();
  let identity: UnlockedIdentity | undefined, wire: AxonWire | undefined;
  let session: ReturnType<typeof createPersistentAxon> | undefined;
  let connecting: Promise<void> | undefined, busy = false;
  let tick: ReturnType<typeof setInterval> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { clearInterval(tick); clearTimeout(lifetime); abort.abort(); session?.stop(); wire?.close(); if (identity) destroyIdentity(identity); };
  async function start() {
    if (abort.signal.aborted) throw Error('Recovery lookup closed');
    const created = await createLocalIdentity(d.random, d.now());
    identity = created.identity;
    if (abort.signal.aborted) { destroyIdentity(identity); throw Error('Recovery lookup closed'); }
    wire = await d.connect(identity.record.account, abort.signal);
    if (abort.signal.aborted) { wire.close(); throw Error('Recovery lookup closed'); }
    const instance = await d.random(32);
    if (abort.signal.aborted) throw Error('Recovery lookup closed');
    session = createPersistentAxon({ record: identity.record, signingSeed: identity.signingSeed, instance,
      wire, store: d.store, expectedAccount: d.peer, now: d.now, random: d.random,
      current: () => !abort.signal.aborted, onClosed: stop,
      onDirectory: async () => JSON.stringify({ domain: DIRECTORY_DOMAIN, status: 'not-found' }) });
    await session.ready;
    if (abort.signal.aborted) throw Error('Recovery lookup closed');
    tick = setInterval(() => session?.tick(), 1000);
    lifetime = setTimeout(stop, 5 * 60_000);
  }
  return {
    async lookup(checkpoint: IdentityRecord) {
      if (busy) return { ...unavailableDirectoryLookup(), status: 'busy' as const };
      busy = true;
      // Bounded dial/handshake/query; close also cancels an unresolved native dial.
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { deadline = setTimeout(() => { stop(); reject(Error('Recovery lookup timed out')); }, 20000); });
      try {
        return await Promise.race([timeout, (async () => {
          await (connecting ??= start());
          const lookup = createIdentityDirectoryLookup({ pins: { read: async () => checkpoint }, now: d.now,
            current: () => !abort.signal.aborted, peers: () => session?.supportsDirectory() ? [d.peer] : [],
            request: async (_peer, raw) => session?.directoryRequest(raw) ?? null });
          try { return await lookup.lookup(checkpoint.account); } finally { lookup.stop(); }
        })()]);
      } catch { stop(); return unavailableDirectoryLookup(); }
      finally { clearTimeout(deadline); busy = false; }
    }, stop,
  };
}
