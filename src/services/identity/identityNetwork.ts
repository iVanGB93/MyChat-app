import {createSessionRouting} from './sessionRouting';
import { createAxonSignaling, type AxonSignal } from './axonSignaling';
import {routeCallMedia} from './callMediaRouting';
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
  onConnected?(candidate:NeuronCandidate):void;
  onWorkChanged?():void;
  onQualityChanged?():void;
  identity: Identity; store: IdentityRecordStore; now(): number; limit?: number;
  onSignal?(signal: AxonSignal, via: string): void;
  onTestMessage?: TestMessageHandler;
  onChatMessage?: TestMessageHandler;
  onPush?: Parameters<typeof createPersistentAxon>[0]['onPush'];
  onCallMediaRelay?: Parameters<typeof createPersistentAxon>[0]['onCallMediaRelay'];
  onRelayedCallMedia?: Parameters<typeof createPersistentAxon>[0]['onRelayedCallMedia'];
  onCallRelay?: Parameters<typeof createPersistentAxon>[0]['onCallRelay'];
  onCallControl?: Parameters<typeof createPersistentAxon>[0]['onCallControl'];
  onCallMedia?: Parameters<typeof createPersistentAxon>[0]['onCallMedia'];
  onDirectory?: Parameters<typeof createPersistentAxon>[0]['onDirectory'];
  onAttachment?: Parameters<typeof createPersistentAxon>[0]['onAttachment'];
  onCustody?: Parameters<typeof createPersistentAxon>[0]['onCustody'];
  connect(candidate: NeuronCandidate, context: ConnectionContext): Promise<AxonWire>;
}) {
  let limit = d.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw Error('Invalid axon limit');
  let pool: ReturnType<typeof createNeuronConnections> | null = null;
  let admit: ((candidate: NeuronCandidate, wire: AxonWire) => boolean) | null = null;
  let account: string | null = null, enabled = true, disposed = false, generation = 0;
  const sessions = new Set<Session>();
  const streamPeer=(peer:string)=>[...sessions].map(s=>s.attachmentStreamPeer?.()).find(p=>p?.account===peer)??null;
  const routing=createSessionRouting({now:d.now,sessions:()=>sessions,connections:()=>pool?.snapshot().connections??[]});
  const {rankedConnections,rankedSessions}=routing;
  const connectedListeners=new Set<(peer:string)=>void>();
  const topologyListeners=new Set<()=>void>();
  const topologyChanged=()=>{d.onWorkChanged?.();for(const listener of topologyListeners)try{listener();}catch{/* Observers cannot close sockets. */}};
  let signaling: ReturnType<typeof createAxonSignaling> | null = null;
  const sendSignal = (via: string, raw: string) => [...sessions].some(s => s.snapshot().account === via && s.sendSignal(raw));
  const directory = createIntroductionDirectory(d.now);
  function pause() {
    generation++; signaling?.clear(); signaling = null; directory.clear(); admit = null; pool?.stop();
    for (const session of [...sessions]) session.stop();
    account = null; routing.clear();
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
        let unSchedule:(()=>void)|undefined;
        let wire: AxonWire | undefined, session: Session | undefined, closed = false;
        const valid = () => !disposed && enabled && own === generation && !context.signal.aborted;
        const close = () => {
          if (closed) return;
          closed = true;unSchedule?.(); directory.remove(candidate.account);
          context.signal.removeEventListener('abort', close);
          if (session) { sessions.delete(session); session.stop(); topologyChanged(); }
          try { wire?.close(); } catch { /* Continue releasing the pool reservation. */ }
        };
        context.signal.addEventListener('abort', close, { once: true });
        try {
          wire = incoming ?? await d.connect(candidate, context);
          if (!valid()) { try { wire.close(); } catch { /* Late transport cleanup. */ } close(); return null; }
          session = await d.identity.createAxon(wire, d.store, candidate.account, () => {
            if(session)routing.closed(session.snapshot());
            console.info('[Axonic connection]', candidate.route, session?.snapshot().closeReason ?? 'handshake-closed', JSON.stringify(session?.snapshot().traffic ?? {}));
            close(); context.onClosed();
          }, {
            list: () => (pool?.snapshot().connections ?? []).filter(c => c.state === 'connected' && c.expiresAt !== null)
              .filter(c=>![...sessions].some(s=>s.snapshot().account===c.account&&s.supportsRtcEndpoint?.()===false))
              .map(c => ({ account: c.account, expiresAt: c.expiresAt! })),
            received: peers => { if (valid()) {directory.replace(candidate.account, peers);d.onWorkChanged?.();} },
          }, (raw, peer) => signaling?.receive(raw, peer) ?? Promise.resolve(false), d.onTestMessage, d.onCustody, d.onChatMessage, d.onDirectory, d.onPush, d.onCallControl, d.onCallMedia, d.onCallRelay, d.onCallMediaRelay, d.onRelayedCallMedia, d.onAttachment);
          if (closed || !valid() || session.snapshot().state === 'closed') { session.stop(); close(); return null; }
          sessions.add(session);const offSchedule=session.subscribeSchedule?.(()=>d.onWorkChanged?.()),offQuality=session.subscribeQuality?.(()=>d.onQualityChanged?.());unSchedule=()=>{offSchedule?.();offQuality?.();};
          const link = await session.ready;
          if (!valid()) { try { wire.close(); } catch { /* Late transport cleanup. */ } close(); return null; }
          if(!incoming){try{d.onConnected?.({...candidate});}catch{/* Locator persistence cannot hold an authenticated socket open. */}}
          for(const listener of connectedListeners){try{listener(candidate.account);}catch{/* Observers do not own the connection. */}}
          topologyChanged();
          return { peer: link.peer, close };
        } catch { close(); return null; }
        finally { if (!session || session.snapshot().state === 'closed') context.signal.removeEventListener('abort', close);d.onWorkChanged?.(); }
      };
    const ownedPool = createNeuronConnections({ localAccount: desired, limit, now: d.now, open,preferRtc:peer=>!!streamPeer(peer) });
    pool = ownedPool;
    admit = (candidate, wire) => ownedPool.accept(candidate, (c, context) => open(c, context, wire));
  }
  const unsubscribe = d.identity.subscribe(reconcile);
  reconcile();
  return {
    subscribeConnected(listener:(peer:string)=>void){connectedListeners.add(listener);return()=>{connectedListeners.delete(listener);};},
    eventCallPeers:()=>[...sessions].filter(s=>s.supportsCallInboxEvents()).map(s=>s.snapshot().account!),
    subscribeTopology(listener:()=>void){topologyListeners.add(listener);return()=>{topologyListeners.delete(listener);};},
    attachmentStreamPeer:streamPeer,
    wssStreamPeer:(account:string)=>[...sessions].map(s=>s.wssStreamPeer()).find(p=>p?.account===account)??null,
    supportsWssBinary:(account:string,instance:string)=>[...sessions].some(s=>s.wssStreamPeer()?.account===account&&s.wssStreamPeer()?.instance===instance&&s.supportsWssBinary()),
    sendWssBinary:(account:string,instance:string,raw:Uint8Array)=>[...sessions].find(s=>s.wssStreamPeer()?.account===account&&s.wssStreamPeer()?.instance===instance)?.sendWssBinary(raw,instance)??false,
    sendWssStream:(account:string,instance:string,raw:string)=>[...sessions].find(s=>s.wssStreamPeer()?.account===account&&s.wssStreamPeer()?.instance===instance)?.sendWssStream(raw,instance)??false,
    profileOfferPeers:()=>[...sessions].filter(s=>s.supportsProfileOffers()).map(s=>s.snapshot().account!).filter(Boolean),
    sendSignal,
    mediaContexts: () => [...sessions].flatMap(s => { const c=s.mediaContext(); return c ? [c] : []; }),
    callMediaRequest(target: string, device: string, raw: string) {
      const session=[...sessions].find(s=>s.mediaContext()?.peer.account===target && s.mediaContext()?.peer.device===device);
      return session?.callMediaRequest(raw) ?? Promise.resolve(false);
    },
    mediaRelayPeers:()=>rankedSessions('media').flatMap(s=>{const p=s.mediaRelayPeer();return p?[p]:[];}),
    async sendRelayedMedia(raw:string) {
      const epoch=generation,own=account,current=()=>!!own&&account===own&&generation===epoch&&!disposed&&d.identity.status().state==='unlocked';
      return routeCallMedia(raw,{current,direct:async(target,device,body)=>{
        const session=[...sessions].find(s=>{const peer=s.mediaForwardPeer();return peer?.account===target&&peer.device===device;});
        return session?.mediaRelayRequest(body,true)??false;
      },relay:async body=>{
        for(const session of rankedSessions('media')){if(!current())return false;if(session.mediaRelayPeer()&&await session.mediaRelayRequest(body))return true;}
        return false;
      }});
    },
    forwardMedia(account:string,device:string,raw:string) {
      const session=[...sessions].find(s=>s.mediaForwardPeer()?.account===account&&s.mediaForwardPeer()?.device===device);
      return session?.mediaRelayRequest(raw,true)??Promise.resolve(false);
    },
    relayPeers: () => rankedSessions().flatMap(s => { const peer=s.relayPeer(); return peer ? [peer] : []; }),
    callRelayRequest(peer: import('./identityClient').IdentityPeer, raw: string) {
      const session=[...sessions].find(s=>{const p=s.relayPeer();return p?.account===peer.account&&p.device===peer.device&&p.instance===peer.instance;});
      return session?.callRelayRequest(raw) ?? Promise.resolve(null);
    },
    callPeers: () => [...sessions].flatMap(s => { const peer=s.callPeer(); return peer ? [peer] : []; }),
    callControlRequest(target: string, device: string, raw: string) {
      const session=[...sessions].find(s=>s.callPeer()?.account===target && s.callPeer()?.device===device);
      return session?.callControlRequest(raw) ?? Promise.resolve(null);
    },
    setLimit(next: number) {
      if (!Number.isInteger(next) || next < 3 || next > 10) throw Error('Allow axons must be between 3 and 10');
      limit = next; pool?.setLimit(next);
    },
    pushPeers: () => rankedSessions().filter(s => s.snapshot().state === 'connected' && s.supportsPush()).map(s => s.snapshot().account!).filter(Boolean),
    pushRequest(target: string, raw: string) {
      const session = [...sessions].find(s => s.snapshot().account === target && s.snapshot().state === 'connected');
      return session?.supportsPush() ? session.pushRequest(raw) : Promise.resolve(null);
    },
    directoryPeers() { return rankedConnections().filter(c => c.state === 'connected'
      && [...sessions].some(s => s.snapshot().account === c.account && s.supportsDirectory())).map(c => c.account); },
    directoryRequest(target: string, raw: string) {
      const session = [...sessions].find(s => s.snapshot().account === target && s.snapshot().state === 'connected');
      return session?.directoryRequest(raw) ?? Promise.resolve(null);
    },
    eventCustodians:()=>[...sessions].filter(s=>s.supportsCustodyEvents()).map(s=>s.snapshot().account!).filter(Boolean),
    custodians() {return rankedConnections().filter(c=>[...sessions].some(s=>s.snapshot().account===c.account&&s.supportsCustody())).map(c=>c.account);},
    profilePeers:()=>[...sessions].filter(s=>s.snapshot().state==='connected'&&s.supportsProfileUpdates()).map(s=>s.snapshot().account!).filter(Boolean),
    timestampPeers:()=>[...sessions].filter(s=>s.snapshot().state==='connected'&&s.supportsMessageTimestamps()).map(s=>s.snapshot().account!).filter(Boolean),
    groupCustodians:()=>rankedSessions().filter(s=>s.snapshot().state==='connected'&&s.supportsGroupCustody()).map(s=>s.snapshot().account!).filter(Boolean),
    sharedAttachmentPeers:()=>[...sessions].filter(s=>s.snapshot().state==='connected'&&s.supportsSharedAttachments()).map(s=>s.snapshot().account!).filter(Boolean),
    attachmentPeers(){return rankedConnections('media').filter(c=>[...sessions].some(s=>s.snapshot().account===c.account&&s.supportsAttachments())).map(c=>c.account);},
    attachmentRequest(target:string,raw:string){return [...sessions].find(s=>s.snapshot().account===target&&s.snapshot().state==='connected')?.attachmentRequest(raw)??Promise.resolve(null);},
    attachmentBlockStreamPeers(){return [...sessions].filter(s=>s.supportsAttachmentBlockStreams()).map(s=>s.snapshot().account!);},
    attachmentBulkPeers(){return [...sessions].filter(s=>s.supportsAttachmentBulk()).map(s=>s.snapshot().account!);},
    attachmentUploadBatchPeers(){return [...sessions].filter(s=>s.supportsAttachmentUploadBatch()).map(s=>s.snapshot().account!);},
    attachmentBatchChunks(target:string){return [...sessions].find(s=>s.snapshot().account===target&&s.supportsAttachmentBulk())?.attachmentBatchChunks()??1;},
    attachmentBatchWindow(target:string){return [...sessions].find(s=>s.snapshot().account===target&&s.supportsAttachmentBulk())?.attachmentBatchWindow()??1;},
    attachmentBulkRequest(target:string,raw:string){return [...sessions].find(s=>s.snapshot().account===target&&s.supportsAttachmentBulk())?.attachmentBulkRequest(raw)??Promise.resolve(null);},
    custodyRequest(target: string, raw: string) {
      const session = routing.connectedSession(target);
      return session?.custodyRequest(raw) ?? Promise.resolve(null);
    },
    sendTestMessage(target: string, text: string, id?: string) {
      const session = routing.connectedSession(target);
      return session?.sendTestMessage(text, id) ?? Promise.resolve(false);
    },
    sendChatMessage(target: string, text: string, id: string) {
      const session = routing.connectedSession(target);
      return session?.sendChatMessage(text, id) ?? Promise.resolve(false);
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
    resume() { reconcile(); if (account) pool?.resume(); },
    nextDeadline:()=>Math.min(pool?.nextDeadline()??Infinity,...[...sessions].map(s=>s.nextDeadline())),
    tick() { reconcile(); for (const session of sessions) session.tick(); if (account) pool?.tick(); },
    setParticipation(value: boolean) { enabled = value; reconcile(); },
    snapshot() {
      const status = d.identity.status();
      return { state: disposed ? 'stopped' : !enabled ? 'paused' : status.state !== 'unlocked' ? 'locked'
        : account ? 'active' : 'waiting', account, limit, pool: pool ? {...pool.snapshot(),connections:[...rankedConnections(),...pool.snapshot().connections.filter(c=>c.state!=='connected')]} : null, sessions:[...sessions].map(s=>({...s.snapshot(),push:s.supportsPush(),custody:s.supportsCustody()})), introductions: directory.snapshot() };
    },
    stop() { if (disposed) return; disposed = true; unsubscribe(); pause(); },
  };
}
