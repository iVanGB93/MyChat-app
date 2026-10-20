import { createRtcAxonTransport } from './rtcAxonTransport';
import { createIdentityNetwork } from './identityNetwork';
import { createNativeAxonConnector, adoptNativeAxonWire, type NativeAxonTransport } from './nativeAxonTransport';

export interface NativeAxonLan extends NativeAxonTransport {
  axonLanEvents?():boolean;
  addListener?(event:string,listener:()=>void):{remove():void};
  axonLanStart(account: string): Promise<void>;
  axonLanStop(): void;
  axonLanSnapshot(): { active: boolean; peers: { account: string; host: string; port: number }[] };
  axonAccept(): Promise<{ id: string; account: string; host: string; hello: string } | null>;
  axonClaim(id: string): void;
}
type Dependencies = Omit<Parameters<typeof createIdentityNetwork>[0], 'connect'> & {
  remembered?():import('./neuronConnections').NeuronCandidate[];
  native: NativeAxonLan;
  rtc?: Pick<Parameters<typeof createRtcAxonTransport>[0], 'random' | 'createConnection' | 'sign' | 'authenticated' | 'wait' | 'mediaLane' | 'streamCredit'>;
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
  const streamRequests=new Map<string,{device:string;until:number}>();
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
    if (rtcAccount !== state.account || state.state !== 'active') { rtc?.stop();streamRequests.clear(); rtcAccount = state.account; }
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
    }).finally(() => { starting = false;d.onWorkChanged?.(); });
  }
  const unsubscribe = d.identity.subscribe(reconcile);
  const eventDiscovery=d.native.axonLanEvents?.()===true&&!!d.native.addListener;
  const discoveryListener=eventDiscovery?d.native.addListener!('axonLanChanged',()=>d.onWorkChanged?.()):null;
  return {
    nextDeadline:()=>disposed?Infinity:Math.min(network.nextDeadline(),retryAt>d.now()?retryAt:Infinity,d.now()+(eventDiscovery?30000:5000)),
    tick() {
      if (disposed) return;
      for (const [account, until] of failedLan) if (until <= d.now()) failedLan.delete(account);
      for(const peer of d.remembered?.().slice(0,16)??[]){if(peer.expiresAt>d.now()&&!lanDeferred(peer.account))network.offer(peer);}
      const internetPeers=d.internet?.peers.slice(0,10)??[];
      for (const peer of internetPeers) {
        network.offer({ ...peer, route: 'internet', expiresAt: d.now() + 60_000 });
      }
      if (rtc) {
        const state = network.snapshot();
        let nearby = new Set<string>();
        try { if (active) nearby = new Set(d.native.axonLanSnapshot().peers.map(p => p.account)); } catch { /* RTC remains a fallback. */ }
        // An introduction is a signaling locator, not proof that an endpoint
        // supports RTC. Keep the configured direct route to a bootstrap peer.
        for (const peer of state.introductions) if (state.account && state.account < peer.account
          && !internetPeers.some(seed=>seed.account===peer.account)
          && (!nearby.has(peer.account) || lanDeferred(peer.account)))
          network.offer({ account: peer.account, endpoint: 'rtc:' + peer.via, route: 'internet', expiresAt: peer.expiresAt });
        // Signed signaling travels over the existing authenticated control link.
        // Only a real transfer requests this promotion. The pool retains LAN
        // until RTC authentication succeeds, with its usual limits and backoff.
        for(const [peer,wanted] of streamRequests){
          if(wanted.until<=d.now()){streamRequests.delete(peer);continue;}
          if(state.account&&state.account<peer&&!internetPeers.some(seed=>seed.account===peer)
            &&network.attachmentStreamPeer(peer)?.device===wanted.device)
            network.offer({account:peer,endpoint:'rtc:'+peer,route:'internet',expiresAt:d.now()+30000});
        }
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
    // A real local foreground transition permits a fresh LAN attempt. Periodic
    // discovery refreshes still preserve the stale-peer backoff.
    resume() { retryAt = 0; failedLan.clear(); network.resume(); },
    sendTestMessage: network.sendTestMessage,
    sendChatMessage: network.sendChatMessage,
    subscribeConnected:network.subscribeConnected,profileOfferPeers:network.profileOfferPeers,
    custodyRequest: network.custodyRequest,groupCustodians:network.groupCustodians,
    attachmentStreams:{available:(account:string,device:string)=>rtc?.canStream(account,device)??false,
      request(account:string,device:string){
        const state=network.snapshot();
        if(disposed||!rtc||!d.rtc?.streamCredit||state.state!=='active'||!state.account
          ||d.internet?.peers.some(seed=>seed.account===account)
          ||network.attachmentStreamPeer(account)?.device!==device)return false;
        for(const [peer,wanted] of streamRequests)if(wanted.until<=d.now())streamRequests.delete(peer);
        if(!streamRequests.has(account)&&streamRequests.size>=5)return false;
        streamRequests.set(account,{device,until:d.now()+30000});d.onWorkChanged?.();return true;
      },
      open:(account:string,device:string)=>{if(!rtc)throw Error('RTC unavailable');return rtc.openStream(account,device);},
      listen:(handler:Parameters<NonNullable<typeof rtc>['listenStreams']>[0])=>rtc?.listenStreams(handler)??(()=>{})},
    subscribeTopology:network.subscribeTopology,eventCallPeers:network.eventCallPeers,
    profilePeers:network.profilePeers,timestampPeers:network.timestampPeers,sharedAttachmentPeers:network.sharedAttachmentPeers,attachmentPeers:network.attachmentPeers,attachmentRequest:network.attachmentRequest,
    attachmentBulkPeers:network.attachmentBulkPeers,attachmentBulkRequest:network.attachmentBulkRequest,
    attachmentUploadBatchPeers:network.attachmentUploadBatchPeers,
    attachmentBatchChunks:network.attachmentBatchChunks,
    attachmentBatchWindow:network.attachmentBatchWindow,
    pushRequest: network.pushRequest,
    pushPeers: network.pushPeers,
    mediaRelayPeers:network.mediaRelayPeers,
    sendRelayedMedia:network.sendRelayedMedia,
    forwardMedia:network.forwardMedia,
    relayPeers: network.relayPeers,
    callRelayRequest: network.callRelayRequest,
    callPeers: network.callPeers,
    mediaContexts: network.mediaContexts,
    callMediaRequest: network.callMediaRequest,
    callControlRequest: network.callControlRequest,
    directoryPeers: network.directoryPeers,
    directoryRequest: network.directoryRequest,
    custodians: network.custodians,eventCustodians:network.eventCustodians,
    snapshot: () => ({ ...network.snapshot(), rtc: rtc?.snapshot() ?? [], discovering: !!active && !starting, error }),
    stop() { if (disposed) return; disposed = true; discoveryListener?.remove();unsubscribe(); rtc?.stop(); network.stop(); stopLan(); failedLan.clear();streamRequests.clear(); },
  };
}
