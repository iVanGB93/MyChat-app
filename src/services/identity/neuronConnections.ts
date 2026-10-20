import type { IdentityPeer } from './identityClient.ts';

export type NeuronRoute = 'lan' | 'private' | 'internet';
export interface NeuronCandidate { account: string; endpoint: string; route: NeuronRoute; expiresAt: number }
export interface NeuronLink { peer: IdentityPeer; close(): void }
export interface ConnectionContext { signal: AbortSignal; onClosed(): void }
export type OpenNeuron = (candidate: NeuronCandidate, context: ConnectionContext) => Promise<NeuronLink | null>;
const accountPattern = /^axonic:1:[0-9a-f]{64}$/;
const routeRank = { lan: 0, private: 1, internet: 2 };

/** Shared scheduling only. open() MUST verify identity with authenticateIdentityPeer (or
 * the symmetric inbound verifier), enforce transport byte limits, and honor abort.
 * Addresses are never fetched here. Adapters classify routes, not remote advertisements.
 * Call tick() periodically. A stalled adapter keeps its reserved slot until it settles,
 * so cancellation cannot silently exceed the socket/handshake limit.
 */
export function createNeuronConnections(d: {
  localAccount: string; now(): number; open: OpenNeuron; limit?: number; jitter?: () => number;
  /** Local policy based on an authenticated session, never discovery priority. */
  preferRtc?(account:string):boolean;
}) {
  const preferredRtc=(c:NeuronCandidate)=>c.route==='internet'&&c.endpoint.startsWith('rtc:')&&d.preferRtc?.(c.account)===true;
  const rank=(c:NeuronCandidate)=>preferredRtc(c)?-1:routeRank[c.route];
  let limit = d.limit ?? 5;
  if (!accountPattern.test(d.localAccount) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw Error('Invalid neuron configuration');
  type Candidate = { value: NeuronCandidate; failures: number; retryAt: number };
  type Slot = { candidate: NeuronCandidate; controller: AbortController; deadline: number;
    state: 'authenticating' | 'connected' | 'closing'; link?: NeuronLink; failed: boolean; promotion: boolean };
  const candidates = new Map<string, Candidate>(), slots = new Map<string, Slot>();
  const upgrades = new Map<string, Slot>();
  const inboundPromotionRetry = new Map<string, number>();
  const allSlots = () => [...slots.values(), ...upgrades.values()];
  const occupied = () => slots.size + upgrades.size;
  const owns = (slot: Slot) => slots.get(slot.candidate.account) === slot || upgrades.get(slot.candidate.account) === slot;
  let stopped = false;
  const close = (link?: NeuronLink) => { try { link?.close(); } catch { /* Closing cannot corrupt scheduling. */ } };
  function fail(slot: Slot) {
    if (slot.failed) return;
    slot.failed = true;
    const c = candidates.get(slot.candidate.account);
    if (c) {
      c.failures = Math.min(7, c.failures + 1);
      const jitter = Math.max(0, Math.min(1, (d.jitter ?? Math.random)()));
      c.retryAt = d.now() + Math.min(60_000, 1000 * 2 ** (c.failures - 1)) + Math.floor(jitter * 250);
    } else if (slot.promotion) inboundPromotionRetry.set(slot.candidate.account, d.now() + 60_000);
  }
  function retire(slot: Slot, failed: boolean) {
    if (!owns(slot)) return;
    if (failed) fail(slot);
    const hadLink = !!slot.link;
    slot.state = 'closing';
    // Remove established slots before callbacks; pending slots remain reserved.
    if (hadLink) slots.delete(slot.candidate.account);
    slot.controller.abort(); close(slot.link);
  }
  function valid(c: NeuronCandidate) {
    return c && accountPattern.test(c.account) && c.account !== d.localAccount
      && typeof c.endpoint === 'string' && c.endpoint.length > 0 && c.endpoint.length <= 2048
      && Object.hasOwn(routeRank, c.route) && Number.isFinite(c.expiresAt)
      && c.expiresAt > d.now() && c.expiresAt <= d.now() + 120_000;
  }
  function offer(c: NeuronCandidate) {
    if (stopped || !valid(c)) return false;
    const old = candidates.get(c.account);
    if (!old && candidates.size >= 128) return false;
    // Refreshes and address changes preserve backoff; repeated discovery cannot bypass it.
    candidates.set(c.account, { value: { ...c }, failures: old?.failures ?? 0, retryAt: old?.retryAt ?? 0 });
    return true;
  }
  function start(candidate: NeuronCandidate, open: OpenNeuron) {
    if (stopped || !valid(candidate) || upgrades.has(candidate.account)) return false;
    const previous = slots.get(candidate.account);
    if (previous && (previous.state !== 'connected' || rank(candidate) >= rank(previous.candidate))) return false;
    const known = candidates.get(candidate.account);
    if (known && known.retryAt > d.now()) return false;
    if (previous && !known && ((inboundPromotionRetry.get(candidate.account) ?? 0) > d.now()
      || inboundPromotionRetry.size >= 128 && !inboundPromotionRetry.has(candidate.account))) return false;
    if (occupied() >= limit && previous && upgrades.size === 0) {
      // A full pool must not pin a known peer to a slower route forever.
      // Retain its working connection until authentication completes, and keep
      // another established wider-network route after a successful LAN upgrade.
      const established = [...slots.values()].filter(s => s.state === 'connected');
      const victim = established.filter(s => s !== previous
        && rank(s.candidate) > rank(candidate)
        && (candidate.route !== 'lan' && !preferredRtc(candidate) || established.some(other =>
          other !== previous && other !== s && other.candidate.route !== 'lan')))
        .sort((a,b) => rank(b.candidate) - rank(a.candidate))[0];
      if (victim) retire(victim, false);
    }
    if (occupied() >= limit) return false;
    const slot: Slot = { candidate: { ...candidate }, controller: new AbortController(),
      deadline: d.now() + 10_000, state: 'authenticating', failed: false, promotion: !!previous };
    // Keep the working link until the preferred route authenticates. The extra
    // handshake consumes a real pool slot; no connection limit is exceeded.
    const owner = previous ? upgrades : slots;
    owner.set(candidate.account, slot);
    void (async () => {
      let link: NeuronLink | null = null;
      try {
        link = await open({ ...candidate }, { signal: slot.controller.signal, onClosed: () => retire(slot, true) });
        if (stopped || slot.state !== 'authenticating' || slot.controller.signal.aborted
          || owner.get(candidate.account) !== slot || d.now() >= slot.deadline
          || !link || link.peer.account !== candidate.account || !Number.isFinite(link.peer.expiresAt)
          || link.peer.expiresAt <= d.now() || !/^[0-9a-f]{64}$/.test(link.peer.device)
          || !/^[0-9a-f]{64}$/.test(link.peer.instance)) {
          fail(slot); close(link ?? undefined); return;
        }
        if (previous) {
          retire(previous, false);
          upgrades.delete(candidate.account);
          slots.set(candidate.account, slot);
        }
        slot.link = link; slot.state = 'connected';
        inboundPromotionRetry.delete(candidate.account);
        const c = candidates.get(candidate.account); if (c) { c.failures = 0; c.retryAt = 0; }
      } catch { fail(slot); close(link ?? undefined); }
      finally { if (slot.state !== 'connected' && owner.get(candidate.account) === slot) owner.delete(candidate.account); }
    })();
    return true;
  }
  function tick() {
    if (stopped) return;
    const now = d.now();
    for (const [account, until] of inboundPromotionRetry) if (until <= now) inboundPromotionRetry.delete(account);
    for (const [id, c] of candidates) if (c.value.expiresAt <= now && !slots.has(id) && c.retryAt <= now) candidates.delete(id);
    for (const slot of allSlots()) {
      if (slot.state === 'authenticating' && slot.deadline <= now) retire(slot, true);
      else if (slot.state === 'connected' && slot.link!.peer.expiresAt <= now) retire(slot, true);
    }
    const available = [...candidates.values()].filter(c => c.retryAt <= now && c.value.expiresAt > now && !slots.has(c.value.account))
      .sort((a, b) => rank(a.value) - rank(b.value) || a.value.account.localeCompare(b.value.account));
    const outside = () => [...slots.values()].some(s => s.state !== 'closing' && s.candidate.route !== 'lan');
    // Reserve one route beyond LAN, including when that candidate arrives after a LAN-only pool filled.
    if (limit > 1 && occupied() === limit && !outside() && available.some(c => c.value.route !== 'lan')) {
      const victim = [...slots.values()].reverse().find(s => s.state === 'connected');
      if (victim) retire(victim, false);
    }
    while (occupied() < limit && available.length) {
      const bridge = limit > 1 && occupied() === limit - 1 && !outside()
        ? available.findIndex(c => c.value.route !== 'lan') : -1;
      const c = available.splice(bridge < 0 ? 0 : bridge, 1)[0]; start(c.value, d.open);
    }
    for (const c of candidates.values()) {
      const old = slots.get(c.value.account);
      if (old?.state === 'connected' && rank(c.value) < rank(old.candidate)) start(c.value, d.open);
    }
  }
  return {
    offer, tick,
    nextDeadline(){
      if(stopped)return Infinity;
      const deadlines=allSlots().filter(s=>s.state!=='closing').map(s=>s.state==='authenticating'?s.deadline:s.link!.peer.expiresAt);
      for(const c of candidates.values())if(!slots.has(c.value.account)&&c.value.expiresAt>d.now()&&occupied()<limit)deadlines.push(Math.max(d.now()+100,c.retryAt));
      return Math.min(Infinity,...deadlines);
    },
    // Local lifecycle wake only: discovery refreshes must still preserve backoff.
    resume() { if (stopped) return; for (const c of candidates.values()) { c.failures = 0; c.retryAt = 0; } tick(); },
    setLimit(next: number) {
      if (!Number.isInteger(next) || next < 1 || next > 20) throw Error('Invalid axon limit');
      limit = next;
      // Keep closer established links; cancel surplus upgrades/handshakes first.
      const ranked = allSlots().filter(s => s.state !== 'closing').sort((a, b) =>
        Number(upgrades.has(a.candidate.account) && upgrades.get(a.candidate.account) === a) - Number(upgrades.has(b.candidate.account) && upgrades.get(b.candidate.account) === b)
        || Number(a.state !== 'connected') - Number(b.state !== 'connected') || rank(a.candidate) - rank(b.candidate));
      for (const slot of ranked.slice(limit)) retire(slot, false);
      tick();
    },
    /** Caller applies per-source rate limiting before accepting any inbound work.
     * An incoming socket's address is not a discovered listening endpoint.
     */
    accept(candidate: NeuronCandidate, authenticate: OpenNeuron) {
      return start(candidate, authenticate);
    },
    stop() { stopped = true; for (const slot of allSlots()) retire(slot, false); candidates.clear(); inboundPromotionRetry.clear(); },
    snapshot() { return { limit, stopped, known: candidates.size, connections: allSlots().map(s => ({
      account: s.candidate.account, route: s.candidate.route, state: s.state,
      expiresAt: s.link?.peer.expiresAt ?? null,
    })), retrying: [...candidates.values()].filter(c => c.retryAt > d.now()).length }; },
  };
}
