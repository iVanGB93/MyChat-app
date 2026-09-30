import { createAxonSignaling, type AxonSignal } from './axonSignaling';
import { createIntroductionDirectory } from './identityIntroductions';
import type { TestMessageHandler } from './axonTestMessages';
import type { createLocalIdentityController } from './localIdentityController';
import { createNeuronConnections, type NeuronCandidate, type ConnectionContext } from './neuronConnections';
import type { AxonWire, createPersistentAxon } from './persistentAxon';
import type { IdentityRecordStore } from './identityAdmission';

type Identity = Pick<ReturnType<typeof createLocalIdentityController>, 'status' | 'subscribe' | 'createAxon'>;
type Session = ReturnType<typeof createPersistentAxon>;
/** Runtime ownership for the experimental identity network. The injected transport must
 * enforce byte/queue limits (including before listen), classify endpoints locally and honor abort while dialing.
 * Caller drives tick every second. No discovery or transport is implicitly enabled.
 */
export function createIdentityNetwork(d: {
  identity: Identity; store: IdentityRecordStore; now(): number; limit?: number;
  onSignal?(signal: AxonSignal, via: string): void;
  onTestMessage?: TestMessageHandler;
  onCustody?: Parameters<typeof createPersistentAxon>[0]['onCustody'];
  connect(candidate: NeuronCandidate, context: ConnectionContext): Promise<AxonWire>;
}) {
  let limit = d.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw Error('Invalid axon limit');
  let pool: ReturnType<typeof createNeuronConnections> | null = null;
  let admit: ((candidate: NeuronCandidate, wire: AxonWire) => boolean) | null = null;
  let account: string | null = null, enabled = true, disposed = false, generation = 0;
  const sessions = new Set<Session>();
  let signaling: ReturnType<typeof createAxonSignaling> | null = null;
  const sendSignal = (via: string, raw: string) => [...sessions].some(s => s.snapshot().account === via && s.sendSignal(raw));
  const directory = createIntroductionDirectory(d.now);
  function pause() {
    generation++; signaling?.clear(); signaling = null; directory.clear(); admit = null; pool?.stop();
    for (const session of [...sessions]) session.stop();
    account = null;
  }
  function reconcile() {
    const status = d.identity.status();
    const desired = !disposed && enabled && status.state === 'unlocked' && !status.busy ? status.account : null;
    if (account && account !== desired) pause();
    if (!desired || account === desired) return;
    // A canceled dial keeps its slot until it settles, even across lock/unlock cycles.
    if (pool?.snapshot().connections.length) return;
    const own = ++generation;
    account = desired;
    signaling = createAxonSignaling({ account: desired, store: d.store, now: d.now,
      current: () => own === generation && !disposed && enabled,
      connected: id => !!pool?.snapshot().connections.some(c => c.account === id && c.state === 'connected'),
      send: sendSignal, receive: (signal, via) => d.onSignal?.(signal, via),
    });
    const open = async (candidate: NeuronCandidate, context: ConnectionContext, incoming?: AxonWire) => {
        let wire: AxonWire | undefined, session: Session | undefined, closed = false;
        const valid = () => !disposed && enabled && own === generation && !context.signal.aborted;
        const close = () => {
          if (closed) return;
          closed = true; directory.remove(candidate.account);
          context.signal.removeEventListener('abort', close);
          if (session) { sessions.delete(session); session.stop(); }
          try { wire?.close(); } catch { /* Continue releasing the pool reservation. */ }
        };
        context.signal.addEventListener('abort', close, { once: true });
        try {
          wire = incoming ?? await d.connect(candidate, context);
          if (!valid()) { try { wire.close(); } catch { /* Late transport cleanup. */ } close(); return null; }
          session = await d.identity.createAxon(wire, d.store, candidate.account, () => { close(); context.onClosed(); }, {
            list: () => (pool?.snapshot().connections ?? []).filter(c => c.state === 'connected' && c.expiresAt !== null)
              .map(c => ({ account: c.account, expiresAt: c.expiresAt! })),
            received: peers => { if (valid()) directory.replace(candidate.account, peers); },
          }, (raw, peer) => signaling?.receive(raw, peer) ?? Promise.resolve(false), d.onTestMessage, d.onCustody);
          if (closed || !valid() || session.snapshot().state === 'closed') { session.stop(); close(); return null; }
          sessions.add(session);
          const link = await session.ready;
          if (!valid()) { try { wire.close(); } catch { /* Late transport cleanup. */ } close(); return null; }
          return { peer: link.peer, close };
        } catch { close(); return null; }
        finally { if (!session || session.snapshot().state === 'closed') context.signal.removeEventListener('abort', close); }
      };
    const ownedPool = createNeuronConnections({ localAccount: desired, limit, now: d.now, open });
    pool = ownedPool;
    admit = (candidate, wire) => ownedPool.accept(candidate, (c, context) => open(c, context, wire));
  }
  const unsubscribe = d.identity.subscribe(reconcile);
  reconcile();
  return {
    sendSignal,
    setLimit(next: number) {
      if (!Number.isInteger(next) || next < 3 || next > 10) throw Error('Allow axons must be between 3 and 10');
      limit = next; pool?.setLimit(next);
    },
    custodians() {
      const ranks = { lan: 0, private: 1, internet: 2 };
      return (pool?.snapshot().connections ?? []).filter(c => c.state === 'connected' && [...sessions].some(s => s.snapshot().account === c.account && s.supportsCustody()))
        .sort((a, b) => ranks[a.route] - ranks[b.route]).map(c => c.account);
    },
    custodyRequest(target: string, raw: string) {
      const session = [...sessions].find(s => s.snapshot().account === target && s.snapshot().state === 'connected');
      return session?.custodyRequest(raw) ?? Promise.resolve(null);
    },
    sendTestMessage(target: string, text: string, id?: string) {
      const session = [...sessions].find(s => s.snapshot().account === target && s.snapshot().state === 'connected');
      return session?.sendTestMessage(text, id) ?? Promise.resolve(false);
    },
    offer(candidate: NeuronCandidate) { reconcile(); return !!account && !!pool?.offer(candidate); },
    /** Transport reserves native capacity and rate-limits before reading the initial hello.
     * The claimed account only selects a pool slot; createAxon verifies it cryptographically.
     */
    accept(candidate: NeuronCandidate, wire: AxonWire) {
      reconcile();
      if (account && admit?.(candidate, wire)) return true;
      try { wire.close(); } catch { /* Rejected inbound sockets must not remain owned. */ }
      return false;
    },
    tick() { reconcile(); for (const session of sessions) session.tick(); if (account) pool?.tick(); },
    setParticipation(value: boolean) { enabled = value; reconcile(); },
    snapshot() {
      const status = d.identity.status();
      return { state: disposed ? 'stopped' : !enabled ? 'paused' : status.state !== 'unlocked' ? 'locked'
        : account ? 'active' : 'waiting', account, limit, pool: pool?.snapshot() ?? null, introductions: directory.snapshot() };
    },
    stop() { if (disposed) return; disposed = true; unsubscribe(); pause(); },
  };
}
