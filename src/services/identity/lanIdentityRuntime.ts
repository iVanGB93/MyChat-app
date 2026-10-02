import { createRtcAxonTransport } from './rtcAxonTransport';
import { createIdentityNetwork } from './identityNetwork';
import { createNativeAxonConnector, adoptNativeAxonWire, type NativeAxonTransport } from './nativeAxonTransport';

export interface NativeAxonLan extends NativeAxonTransport {
  axonLanStart(account: string): Promise<void>;
  axonLanStop(): void;
  axonLanSnapshot(): { active: boolean; peers: { account: string; host: string; port: number }[] };
  axonAccept(): Promise<{ id: string; account: string; host: string; hello: string } | null>;
  axonClaim(id: string): void;
}
type Dependencies = Omit<Parameters<typeof createIdentityNetwork>[0], 'connect'> & {
  native: NativeAxonLan;
  rtc?: Pick<Parameters<typeof createRtcAxonTransport>[0], 'random' | 'createConnection' | 'sign'>;
  internet?: { connect: Parameters<typeof createIdentityNetwork>[0]['connect'];
    peers: { account: string; endpoint: string }[] };
};
const validAccount = (id: string) => /^axonic:1:[0-9a-f]{64}$/.test(id);
/** Development-only foreground LAN composition. Call tick once per second.
 * No account in an advertisement is trusted until the axon verifies its signatures.
 */
export function createLanIdentityRuntime(d: Dependencies) {
  const lan = createNativeAxonConnector(d.native);
  // Discovery can retain a vanished Wi-Fi peer. A failed dial must not let
  // that advertisement suppress an independently authenticated RTC route.
  const failedLan = new Map<string, number>();
  const deferLan = (account: string) => {
    if (failedLan.size < 128 || failedLan.has(account)) failedLan.set(account, d.now() + 120_000);
  };
  const lanDeferred = (account: string) => (failedLan.get(account) ?? 0) > d.now();
  let rtc: ReturnType<typeof createRtcAxonTransport> | null = null;
  const network = createIdentityNetwork({ ...d, limit: d.limit ?? 5,
    onSignal: (signal, via) => rtc?.receive(signal, via),
    connect: async (candidate, context) => {
      if (candidate.endpoint.startsWith('rtc:') && rtc) return rtc.connect(candidate, context);
      if (candidate.route === 'internet' && d.internet) return d.internet.connect(candidate, context);
      try {
        const wire = await lan(candidate, context);
        return { ...wire, listen(message, closed) {
          return wire.listen(message, () => {
            if (!context.signal.aborted) deferLan(candidate.account);
            closed();
          });
        } };
      } catch (error) { deferLan(candidate.account); throw error; }
    } });
  if (d.rtc) rtc = createRtcAxonTransport({ ...d.rtc, account: () => network.snapshot().account,
    now: d.now, send: network.sendSignal, accept: network.accept });
  let rtcAccount: string | null = null;
  let active: { account: string; abort: AbortController } | null = null;
  let starting = false, disposed = false, retryAt = 0, error: string | null = null;
  function stopLan() {
    const old = active; active = null; old?.abort.abort();
    try { d.native.axonLanStop(); } catch { /* Native lifecycle also closes sockets. */ }
  }
  async function accept(own: NonNullable<typeof active>) {
    while (!disposed && active === own && !own.abort.signal.aborted) {
      let incoming: Awaited<ReturnType<NativeAxonLan['axonAccept']>> = null;
      try {
        incoming = await d.native.axonAccept();
        if (!incoming) { await new Promise(resolve => setTimeout(resolve, 25)); continue; }
        if (active !== own || own.abort.signal.aborted || !validAccount(incoming.account) || incoming.account >= own.account) {
          d.native.axonClose(incoming.id); continue;
        }
        d.native.axonClaim(incoming.id);
        const wire = await adoptNativeAxonWire(d.native, incoming.id, incoming.hello, { signal: own.abort.signal, onClosed() {} });
        if (active !== own) { wire.close(); continue; }
        network.accept({ account: incoming.account, endpoint: `accepted:${incoming.id}`, route: 'lan', expiresAt: d.now() + 60_000 }, wire);
      } catch {
        if (incoming) { try { d.native.axonClose(incoming.id); } catch { /* Already closed. */ } }
        if (active === own) { error = 'LAN listener unavailable'; retryAt = d.now() + 5000; stopLan(); }
        return;
      }
    }
  }
  function reconcile() {
    const state = network.snapshot();
    if (rtcAccount !== state.account || state.state !== 'active') { rtc?.stop(); rtcAccount = state.account; }
    const desired = !disposed && state.state === 'active' ? state.account : null;
    if (active && active.account !== desired) stopLan();
    if (!desired || active || starting || d.now() < retryAt) return;
    starting = true;
    const own = { account: desired, abort: new AbortController() }; active = own;
    void d.native.axonLanStart(desired).then(() => {
      if (disposed || active !== own || own.abort.signal.aborted) { d.native.axonLanStop(); return; }
      error = null; void accept(own);
    }).catch(() => {
      if (active === own) { error = 'Connect to Wi-Fi to discover nearby neurons'; retryAt = d.now() + 5000; stopLan(); }
    }).finally(() => { starting = false; });
  }
  const unsubscribe = d.identity.subscribe(reconcile);
  return {
    tick() {
      if (disposed) return;
      for (const [account, until] of failedLan) if (until <= d.now()) failedLan.delete(account);
      for (const peer of d.internet?.peers.slice(0, 10) ?? []) {
        network.offer({ ...peer, route: 'internet', expiresAt: d.now() + 60_000 });
      }
      if (rtc) {
        const state = network.snapshot();
        let nearby = new Set<string>();
        try { if (active) nearby = new Set(d.native.axonLanSnapshot().peers.map(p => p.account)); } catch { /* RTC remains a fallback. */ }
        for (const peer of state.introductions) if (state.account && state.account < peer.account
          && (!nearby.has(peer.account) || lanDeferred(peer.account)))
          network.offer({ account: peer.account, endpoint: 'rtc:' + peer.via, route: 'internet', expiresAt: peer.expiresAt });
      }
      network.tick(); reconcile();
      if (!active || starting) return;
      try {
        const snapshot = d.native.axonLanSnapshot();
        if (!snapshot.active) { error = 'Wi-Fi discovery stopped'; retryAt = d.now() + 5000; stopLan(); return; }
        for (const peer of snapshot.peers.slice(0, 32)) {
          // Stable tie-breaking: the lower account dials; the higher accepts.
          if (!validAccount(peer.account) || peer.account <= active.account || (rtc && lanDeferred(peer.account))) continue;
          network.offer({ account: peer.account, endpoint: `axon-lan://${peer.host}:${peer.port}`, route: 'lan', expiresAt: d.now() + 60_000 });
        }
        network.tick();
      } catch { error = 'LAN discovery unavailable'; retryAt = d.now() + 5000; stopLan(); }
    },
    setLimit: network.setLimit,
    sendTestMessage: network.sendTestMessage,
    sendChatMessage: network.sendChatMessage,
    custodyRequest: network.custodyRequest,
    custodians: network.custodians,
    snapshot: () => ({ ...network.snapshot(), rtc: rtc?.snapshot() ?? [], discovering: !!active && !starting, error }),
    stop() { if (disposed) return; disposed = true; unsubscribe(); rtc?.stop(); network.stop(); stopLan(); failedLan.clear(); },
  };
}
