import { createIntroductionService, verifyIntroductions, type IntroductionHooks } from './identityIntroductions.ts';
import { createIdentityExchange } from './identityExchange.ts';
import { createAxonTestMessages, createAxonNormalMessages, type TestMessageHandler } from './axonTestMessages.ts';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { authenticateIdentityPeer, type IdentityPeer } from './identityClient.ts';
import { signIdentityRequest, type IdentityRecordStore } from './identityAdmission.ts';
import { validAccountId, publicDevice, type IdentityRecord } from './identityProtocol.ts';
import type { NeuronLink } from './neuronConnections.ts';
import { verifyCallControl } from './callControlProtocol.ts';
import { verifyCallControlReceipt } from './callControlDelivery.ts';
import { verifyCallMediaSignal, CALL_MEDIA_MAX_BYTES } from './callMediaProtocol.ts';
import {ATTACHMENT_BULK_FRAME_BYTES} from './attachmentBatch.ts';

export const AXON_FRAME_BYTES = 20_000;
// Bidirectional call polling (40/min), custody polling (24/min), renewal
// (12/min), and introductions (8/min) already exceed the handshake budget.
export const AXON_CONTROL_FRAMES_PER_MINUTE = 256;
export interface AxonWire {
  attachments?: boolean;
  mediaLane?: boolean;
  bulkAttachments?: boolean;
  smallAttachmentBatches?: boolean;
  smallAttachmentWindow?: 4;
  enableBulkAttachments?():void;
  enableMediaLane?(): void;
  enableAttachments?(): void;
  send(raw: string): void;
  close(reason?: string): void;
  listen(message: (raw: string) => void, closed: () => void): () => void;
}
/** Symmetric, connection-bound identity/liveness protocol. Optional introductions and opt-in test messages.
 * Caller supplies a NEW secure instance nonce for EACH socket and calls tick() every second.
 * The wire adapter must bound inbound frames before buffering and outbound queued bytes.
 * Stop before locking/replacing keys. Authentication does not imply conversation access.
 */
export function createPersistentAxon(d: {
  record: IdentityRecord; history?: IdentityRecord[]; signingSeed: Uint8Array; instance: Uint8Array; store: IdentityRecordStore;
  onAttachment?(raw:string,peer:IdentityPeer):Promise<string>;
  onPush?(raw: string, peer: IdentityPeer): Promise<string>;
  onCallMediaRelay?(raw: string, peer: IdentityPeer): Promise<boolean>;
  onRelayedCallMedia?(raw: string, peer: IdentityPeer): Promise<boolean>;
  onCallRelay?(raw: string, peer: IdentityPeer): Promise<string>;
  onCallControl?(raw: string, peer: IdentityPeer): Promise<string | null>;
  onCallMedia?(raw: string, peer: IdentityPeer, localInstance: string): Promise<boolean>;
  onDirectory?(raw: string, peer: IdentityPeer): Promise<string>;
  onCustody?(raw: string, peer: IdentityPeer): Promise<string>;
  onSignal?(raw: string, peer: IdentityPeer): Promise<boolean>;
  testMessages?: { encryptionSeed: Uint8Array; received: TestMessageHandler };
  chatMessages?: { encryptionSeed: Uint8Array; received: TestMessageHandler };
  expectedAccount?: string; introductions?: IntroductionHooks; wire: AxonWire; now(): number; current(): boolean;
  random(size: number): Promise<Uint8Array>; onClosed(): void;
}) {
  let stopped = false, closeReason: string | null = null, remote: string | null = null, peer: IdentityPeer | null = null;
  let deferredFrames: string[] = [], deferredBytes = 0;
  let peerMessageTimestamps=false,peerProfileUpdates=false;
  let peerSharedAttachments=false,peerAttachments=false,attachmentFrames=0,attachmentNext=0,peerMediaLane=false;
  let mediaInbound=0,mediaWaiting=0,mediaWindow=1,mediaSuccesses=0;
  let lastMediaAt=-Infinity;
  let peerBulk=false,bulkInbound=0,bulkFrames=0;
  let smallBatches=false,smallWindow=2;
  const bulkFrameLimit=()=>smallBatches?AXON_FRAME_BYTES:ATTACHMENT_BULK_FRAME_BYTES;
  const smallRequest=(raw:string)=>{try{const r=JSON.parse(raw);return r.operation==='direct-get-batch'&&Number.isSafeInteger(r.count)&&r.count>=1&&r.count<=3;}catch{return false;}};
  let bulkWaiting=0,bulkNext=0;
  // Small RTC batches fit the negotiated two/four-request inbound limit. Start them together
  // instead of forcing the second slot through a mobile timer; keep 200/sec.
  let smallBatchCredits=2,smallBatchCreditAt=d.now();
  function bulkRateReady(){
    if(!smallBatches)return d.now()>=bulkNext;
    const now=d.now();
    if(now>smallBatchCreditAt){smallBatchCredits=Math.min(smallWindow,smallBatchCredits+(now-smallBatchCreditAt)/5);smallBatchCreditAt=now;}
    return smallBatchCredits>=1;
  }
  // Four bounded burst credits, replenished at the existing 200 requests/sec.
  // Mobile timers may run at frame cadence; spacing every request by a timer
  // unnecessarily serializes a negotiated window even on a fast local link.
  let mediaCredits=4,mediaCreditAt=d.now();
  function mediaRateReady(){
    const now=d.now();
    if(now>mediaCreditAt){mediaCredits=Math.min(4,mediaCredits+(now-mediaCreditAt)/5);mediaCreditAt=now;}
    return mediaCredits>=1;
  }
  const mediaPending=new Map<number,{bulk?:boolean;until:number;started:number;resolve(raw:string):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
  // A single slow attachment must not tear down an otherwise authenticated axon.
  // Retain only bounded, short-lived IDs so its late reply cannot match a new request.
  const timedOutMedia=new Map<number,{bulk:boolean;until:number}>();let consecutiveMediaTimeouts=0;
  function expireMedia(id:number){
    const task=mediaPending.get(id);if(!task)return;
    mediaPending.delete(id);clearTimeout(task.timer);
    for(const [key,value] of timedOutMedia)if(value.until<=d.now())timedOutMedia.delete(key);
    if(timedOutMedia.size>=16)timedOutMedia.delete(timedOutMedia.keys().next().value!);
    timedOutMedia.set(id,{bulk:!!task.bulk,until:d.now()+30000});
    mediaWindow=Math.max(1,Math.floor(mediaWindow/2));mediaSuccesses=0;
    task.reject(Error('Attachment request timed out'));
    if(++consecutiveMediaTimeouts>=3)stop('repeated-media-timeout');
  }
  let peerPush = false, peerRelay = false, peerMediaRelay = false, peerMediaForward = false;
  let peerCalls = false;
  let peerMedia = false;
  let peerTests = false, peerDirectory = false, peerCustody = false, peerChat = false;
  const chat = d.chatMessages ? createAxonNormalMessages({
    local: { account: d.record.account, device: publicDevice(d.signingSeed, d.chatMessages.encryptionSeed).id, instance: bytesToHex(d.instance) },
    encryptionSeed: d.chatMessages.encryptionSeed, peer: () => peer, store: d.store, now: d.now, random: d.random,
    current: () => !stopped && peerChat && d.current(), received: d.chatMessages.received,
    send: body => send({ version: 1, kind: 'chat-message', body }),
  }) : null;
  const tests = d.testMessages ? createAxonTestMessages({
    local: { account: d.record.account, device: publicDevice(d.signingSeed, d.testMessages.encryptionSeed).id, instance: bytesToHex(d.instance) },
    encryptionSeed: d.testMessages.encryptionSeed, peer: () => peer, store: d.store, now: d.now, random: d.random,
    current: () => !stopped && peerTests && d.current(), received: d.testMessages.received,
    send: body => send({ version: 1, kind: 'test-message', body }),
  }) : null;
  let peerSignals = false, signalBusy = false, signalWindow = d.now(), signalCount = 0;
  let peerIntroductions = false, introducing = false, introduceAt = d.now() + 5000;
  let authenticating = false, renewalAt = 0, inboundBusy = false, sequence = 0;
  let custodyWaiting = 0, pushWaiting = 0, attachmentWaiting = 0;
  let attachmentTail:Promise<unknown>=Promise.resolve();
  let windowAt = d.now(), frames = 0;
  const traffic: Record<string, number> = {};
  const started = d.now();
  let pending: { until:number; operation:string; id: number; resolve(raw: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  let resolveReady!: (link: NeuronLink) => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<NeuronLink>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Consumers may attach after opening; avoid a transient unhandled rejection on early close.
  void ready.catch(() => {});
  const service = createIdentityExchange({ ...d, current: () => !stopped && d.current() });
  const introduce = d.introductions ? createIntroductionService({ ...d, peer: () => peer,
    current: () => !stopped && d.current(), list: d.introductions.list }) : null;
  // tick() is also driven by the native background wake clock on mobile.
  const sleepers=new Set<{until:number;finish():void}>();
  function wait(ms:number){return new Promise<void>(resolve=>{
    const entry={until:d.now()+ms,finish(){clearTimeout(timer);sleepers.delete(entry);resolve();}};
    const timer=setTimeout(entry.finish,ms);sleepers.add(entry);
  });}
  let unsubscribe = () => {};
  function stop(reason = 'session-stopped') {
    if (stopped) return;
    closeReason = reason;
    stopped = true;
    deferredFrames=[];deferredBytes=0;
    for(const sleeper of [...sleepers])sleeper.finish();
    for(const task of mediaPending.values()){clearTimeout(task.timer);task.reject(Error('Axon closed'));}mediaPending.clear();
    timedOutMedia.clear();
    tests?.stop();
    chat?.stop();
    try { unsubscribe(); } catch { /* Cleanup must continue even if an adapter fails. */ }
    if (pending) { clearTimeout(pending.timer); pending.reject(Error('Axon closed')); pending = null; }
    rejectReady(Error('Axon closed'));
    try { d.wire.close(reason); } catch { /* The session is already closed. */ }
    try { d.onClosed(); } catch { /* Observer failures cannot retain authentication. */ }
  }
  function send(frame: unknown) {
    if (stopped || !d.current()) throw Error('Axon unavailable');
    const raw = JSON.stringify(frame);
    const bulk=(frame as {kind?:string}).kind==='bulk-response';
    if (new TextEncoder().encode(raw).length > (bulk&&peerBulk&&peer?bulkFrameLimit():AXON_FRAME_BYTES)) throw Error('Axon frame too large');
    d.wire.send(raw);
  }
  function exchange(operation: 'attachment' | 'describe' | 'authenticate' | 'introductions' | 'custody' | 'directory' | 'push' | 'call-control' | 'call-media' | 'call-relay' | 'call-media-relay' | 'call-media-forward', body: string): Promise<string> {
    if (pending || stopped) return Promise.reject(Error('Axon exchange unavailable'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      // Give renewal and control traffic sharing an active media channel room
      // for mobile/SCTP stalls. Discovery can begin just before a transfer, so
      // it needs the same bounded grace even before the first media frame.
      // Never extend the proof or initial handshake.
      const grace=peer&&(operation==='describe'||operation==='authenticate'||operation==='introductions'||mediaPending.size>0||mediaInbound>0||d.now()-lastMediaAt<5000);
      const timeout=grace?Math.max(1,Math.min(15000,peer!.expiresAt-d.now())):
        operation === 'call-control' || operation === 'call-media' || operation === 'call-relay' || operation === 'call-media-relay' || operation === 'call-media-forward' ? 15000 : 4000;
      pending = { operation, id, resolve, reject, until:d.now()+timeout, timer:setTimeout(() => stop('exchange-timeout:' + operation),timeout) };
      try { send({ version: 1, kind: 'request', id, operation, body }); }
      catch { stop(); }
    });
  }
  async function authenticate() {
    if (!remote || authenticating || introducing || pending || stopped) return;
    authenticating = true;
    try {
      const result = await authenticateIdentityPeer({ localAccount: d.record.account, expectedAccount: remote,
        store: d.store, now: d.now, random: d.random, current: () => !stopped && d.current(), exchange,
        sign: async audience => signIdentityRequest(d.record, d.signingSeed, audience, 'authenticate', '', await d.random(32), d.now(), d.history) });
      if (!result || stopped || (peer && (peer.account !== result.account || peer.device !== result.device || peer.instance !== result.instance))) { stop('authentication-rejected'); return; }
      if (peer) peer.expiresAt = result.expiresAt;
      else {
        peer = { ...result };
        // Lift only the native transport ceiling after authentication. This
        // layer still enforces negotiated attachment support and both budgets.
        d.wire.enableAttachments?.();
        if(peerMediaLane)d.wire.enableMediaLane?.();
        if(peerBulk)d.wire.enableBulkAttachments?.();
        resolveReady({ peer, close: stop });
      }
      renewalAt = d.now() + 20_000;
    } catch { stop('authentication-error'); }
    finally {
      authenticating = false;
      if(peer&&!stopped){const waiting=deferredFrames;deferredFrames=[];deferredBytes=0;for(const raw of waiting)void receive(raw);}
    }
  }
  async function discover() {
    const source = peer;
    if (!source || !d.introductions || !peerIntroductions || introducing || authenticating || pending || pushWaiting > 0 || stopped) return;
    introducing = true; introduceAt = d.now() + 15_000;
    try {
      const nonce = await d.random(32);
      if (stopped || !d.current() || source.expiresAt <= d.now()) return;
      const request = JSON.stringify(signIdentityRequest(d.record, d.signingSeed,
        { account: source.account, instance: source.instance }, 'lookup', 'introductions-v1', nonce, d.now(), d.history));
      const reply = await exchange('introductions', request);
      const record = await d.store.read(source.account);
      if (stopped || !d.current()) return;
      const peers = record ? verifyIntroductions(reply, request, source, record, d.now()) : null;
      if (!peers) { stop(); return; }
      d.introductions.received(peers);
    } catch { stop(); }
    // A stalled route can delay arrival of the first lookup. Measuring the
    // next interval from its start compresses arrivals after recovery and
    // trips the receiver's ten-second admission limit.
    finally { introducing = false; introduceAt = d.now() + 15_000; }
  }
  async function receive(raw: string) {
    try {
      if (stopped) return;
      const maxBytes=peerBulk&&peer&&peer.expiresAt>d.now()?bulkFrameLimit():AXON_FRAME_BYTES;
      if (!d.current() || typeof raw !== 'string' || raw.length>maxBytes) { stop(); return; }
      const rawBytes=new TextEncoder().encode(raw).length;if(rawBytes>maxBytes){stop();return;}
      if (d.now() - windowAt >= 60_000) { windowAt = d.now(); frames = 0; attachmentFrames=0;bulkFrames=0; }
      const f = JSON.parse(raw);
      // The other side can finish its independent authentication while our
      // final durable identity read is still pending. Bound early application
      // traffic and process it only after our own verification succeeds.
      const application = ['signal','chat-message','test-message','media-request','bulk-request'].includes(f.kind)
        || f.kind==='request' && ['introductions','custody','directory','push','attachment','call-control','call-media','call-relay','call-media-relay','call-media-forward'].includes(f.operation);
      if(!peer&&remote&&authenticating&&f.version===1&&application){
        if(deferredFrames.length>=4||deferredBytes+rawBytes>40000){stop('early-traffic-limit');return;}
        deferredFrames.push(raw);deferredBytes+=rawBytes;return;
      }
      const bulk=f.kind==='bulk-request'||f.kind==='bulk-response';
      if(rawBytes>AXON_FRAME_BYTES&&f.kind!=='bulk-response'){stop('oversized-control');return;}
      if(bulk&&(!peerBulk||!peer||peer.expiresAt<=d.now()||++bulkFrames>(smallBatches?28000:512))){stop('invalid-bulk-frame');return;}
      // Fixed labels only: never retain payloads, identifiers, or untrusted keys.
      const operations = ['describe','authenticate','introductions','custody','directory','push','attachment','call-control','call-media','call-relay','call-media-relay','call-media-forward'];
      const operation = f.kind === 'response' ? pending?.operation : f.operation;
      const label = f.kind === 'request' || f.kind === 'response'
        ? `${f.kind}:${operations.includes(operation) ? operation : 'other'}`
        : ['hello','signal','chat-message','test-message','media-request','media-response','bulk-request','bulk-response'].includes(f.kind) ? f.kind : 'other';
      traffic[label] = (traffic[label] ?? 0) + 1;
      const media=peerMediaLane&&d.onAttachment&&peer&&peer.expiresAt>d.now()&&(bulk||f.kind==='media-request'||f.kind==='media-response');
      if(media)lastMediaAt=d.now();
      const attachment=media||peerAttachments&&d.onAttachment&&peer&&peer.expiresAt>d.now()&&((f.kind==='request'&&f.operation==='attachment')||(f.kind==='response'&&pending?.operation==='attachment'));
      const controlLimit = peer && peer.expiresAt > d.now() ? AXON_CONTROL_FRAMES_PER_MINUTE : 64;
      if(attachment?++attachmentFrames>(peerMediaLane?28000:3600):++frames>controlLimit){stop(attachment?'attachment-rate-limit':'control-rate-limit');return;}
      if (f.version !== 1) { stop('invalid-version'); return; }
      if (f.kind === 'hello') {
        if (remote || !validAccountId(f.account) || f.account === d.record.account || (d.expectedAccount && f.account !== d.expectedAccount)) { stop('invalid-hello'); return; }
        peerAttachments=f.attachments===1&&d.wire.attachments!==false;
        peerMessageTimestamps=f.messageTimestamps===1;peerProfileUpdates=f.profileUpdates===1;
        peerSharedAttachments=peerAttachments&&f.sharedAttachments===2;
        peerMediaLane=peerAttachments&&f.mediaLane===1&&d.wire.mediaLane===true;
        peerBulk=peerMediaLane&&f.bulkAttachments===1&&d.wire.bulkAttachments===true;
        smallBatches=!peerBulk&&peerMediaLane&&f.smallAttachmentBatches===1&&d.wire.smallAttachmentBatches===true;
        peerBulk ||= smallBatches;
        smallWindow=smallBatches&&d.wire.smallAttachmentWindow===4&&f.smallAttachmentWindow===4?4:2;smallBatchCredits=smallWindow;
        peerRelay = f.callRelay === 1;peerMediaRelay=f.callMediaRelay===1;peerMediaForward=f.callMediaForward===1;
        peerPush = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('push-registration-v1');
        peerMedia = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('call-control-v2');
        peerCalls = peerMedia || Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('call-control-v1');
        peerSignals = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('rtc-signals-v1');
        peerDirectory = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('identity-directory-v1');
        peerCustody = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('custody-v1');
        peerTests = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('test-messages-v2');
        peerChat = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('chat-text-v1');
        peerIntroductions = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('introductions-v1');
        remote = f.account; void authenticate(); return;
      }
      if (f.kind === 'signal') {
        if (!peer || peer.expiresAt <= d.now() || !peerSignals || !d.onSignal || signalBusy || typeof f.body !== 'string') { stop(signalBusy?'overlapping-signal':'invalid-signal'); return; }
        if (d.now() - signalWindow >= 60000) { signalWindow = d.now(); signalCount = 0; }
        if (++signalCount > 16) { stop('signal-rate-limit'); return; }
        signalBusy = true;
        try { await d.onSignal(f.body, peer); } finally { signalBusy = false; }
        return;
      }
      if (f.kind === 'test-message') {
        if (!tests || !peerTests || !peer || peer.expiresAt <= d.now() || !await tests.receive(f.body)) stop();
        return;
      }
      if (f.kind === 'chat-message') {
        if (!chat || !peerChat || !peer || peer.expiresAt <= d.now() || !await chat.receive(f.body)) stop();
        return;
      }
      if (!remote || !Number.isSafeInteger(f.id) || f.id < 1 || typeof f.body !== 'string' || f.body.length > (f.kind==='bulk-response'?bulkFrameLimit()-(smallBatches?128:1024):16000)) { stop('invalid-envelope'); return; }
      if(f.kind==='media-response'||f.kind==='bulk-response'){
        const task=mediaPending.get(f.id);
        const expired=timedOutMedia.get(f.id);
        if(!task&&media&&expired&&expired.until>d.now()&&expired.bulk===bulk){timedOutMedia.delete(f.id);return;}
        if(!media||!task||!!task.bulk!==bulk){stop('invalid-media-response');return;}
        mediaPending.delete(f.id);clearTimeout(task.timer);
        consecutiveMediaTimeouts=0;
        // Grow only as replies arrive; slow storage/links reduce the in-flight window.
        if(d.now()-task.started>1000){mediaWindow=Math.max(1,Math.floor(mediaWindow/2));mediaSuccesses=0;}
        else if(++mediaSuccesses>=mediaWindow){mediaWindow=Math.min(4,mediaWindow+1);mediaSuccesses=0;}
        task.resolve(f.body);return;
      }
      if(f.kind==='media-request'||f.kind==='bulk-request'){
        if(bulk&&smallBatches&&!smallRequest(f.body)){stop('invalid-small-batch');return;}
        if(!media||mediaInbound>=4||bulk&&bulkInbound>=(smallBatches?smallWindow:2)||f.body.length>13000){stop('invalid-media-request');return;}
        mediaInbound++;
        if(bulk)bulkInbound++;
        try{
          const source=peer!,response=await d.onAttachment!(f.body,source);
          if(!stopped&&d.current()&&source.expiresAt>d.now())send({version:1,kind:bulk?'bulk-response':'media-response',id:f.id,body:response});
        }finally{mediaInbound--;if(bulk)bulkInbound--;}
        return;
      }
      if (f.kind === 'response') {
        if (!pending || pending.id !== f.id) { stop('unexpected-response'); return; }
        const task = pending; pending = null; clearTimeout(task.timer); task.resolve(f.body); return;
      }
      if (f.kind !== 'request' || inboundBusy) { stop(inboundBusy ? 'overlapping-request' : 'invalid-request'); return; }
      inboundBusy = true;
      try {
        let response: string | null = null;
        if (f.operation === 'describe') {
          const body = JSON.parse(f.body);
          if (body?.version === 1 && typeof body.nonce === 'string') response = service.describe(body.nonce);
        } else if (f.operation === 'authenticate') {
          const body = JSON.parse(f.body);
          if (body?.record?.account === remote) response = await service.authenticate(f.body);
        }
        if ((f.operation === 'call-media-relay' || f.operation === 'call-media-forward') && peer && peer.expiresAt>d.now()
          && new TextEncoder().encode(f.body).length<=12000) {
          const handler=f.operation==='call-media-relay'?d.onCallMediaRelay:d.onRelayedCallMedia;
          response=JSON.stringify({accepted:handler?await handler(f.body,peer):false});
        }
        if (f.operation === 'call-relay' && d.onCallRelay && peer && peer.expiresAt > d.now()
          && new TextEncoder().encode(f.body).length <= 13000) response = await d.onCallRelay(f.body, peer);
        if (f.operation === 'push' && d.onPush && peerPush && peer && peer.expiresAt > d.now()) response = await d.onPush(f.body, peer);
        if (f.operation === 'call-control' && d.onCallControl && peerCalls && peer && peer.expiresAt > d.now()
          && new TextEncoder().encode(f.body).length <= 6000) response = await d.onCallControl(f.body, peer) ?? '{}';
        if (f.operation === 'call-media' && d.onCallMedia && peerMedia && peer && peer.expiresAt > d.now()
          && new TextEncoder().encode(f.body).length <= CALL_MEDIA_MAX_BYTES)
          response = JSON.stringify({ accepted: await d.onCallMedia(f.body, peer, bytesToHex(d.instance)) });
        if (f.operation === 'directory' && d.onDirectory && peerDirectory && peer && peer.expiresAt > d.now()) response = await d.onDirectory(f.body, peer);
        if(f.operation==='attachment'&&peerAttachments&&d.onAttachment&&peer&&peer.expiresAt>d.now()&&f.body.length<=13000)response=await d.onAttachment(f.body,peer);
        if (f.operation === 'custody' && d.onCustody && peer && peer.expiresAt > d.now()) response = await d.onCustody(f.body, peer);
        if (f.operation === 'introductions' && introduce && peerIntroductions) response = await introduce(f.body);
        if (!response || stopped || !d.current()) { stop('request-rejected:'+(operations.includes(f.operation)?f.operation:'other')); return; }
        send({ version: 1, kind: 'response', id: f.id, body: response });
      } finally { inboundBusy = false; }
    } catch { stop('receive-error'); }
  }
  try {
    unsubscribe = d.wire.listen(raw => { void receive(raw); }, () => stop('transport-closed'));
    // An adapter may report an already-closed wire while registering callbacks.
    if (stopped) { try { unsubscribe(); } catch { /* Best-effort cleanup. */ } }
  } catch { stop(); }
  const deadline = setTimeout(() => { if (!peer) stop(); }, 10_000);
  void ready.then(() => clearTimeout(deadline), () => clearTimeout(deadline));
  try { send({ version: 1, kind: 'hello', account: d.record.account, ...(chat?{messageTimestamps:1,profileUpdates:1}:{}), ...(d.onAttachment&&d.wire.attachments!==false?{attachments:1,sharedAttachments:2,...(d.wire.mediaLane===true?{mediaLane:1,...(d.wire.bulkAttachments?{bulkAttachments:1}:{}),...(d.wire.smallAttachmentBatches?{smallAttachmentBatches:1,...(d.wire.smallAttachmentWindow===4?{smallAttachmentWindow:4}:{})}:{})}:{})}:{}), ...(d.onCallRelay ? { callRelay: 1 } : {}), ...(d.onCallMediaRelay ? {callMediaRelay:1}:{}), ...(d.onRelayedCallMedia ? {callMediaForward:1}:{}), features: [...(d.onCallControl ? [d.onCallMedia ? 'call-control-v2' : 'call-control-v1'] : []), ...(d.onPush ? ['push-registration-v1'] : []), ...(d.onDirectory ? ['identity-directory-v1'] : []), ...(d.onCustody ? ['custody-v1'] : []), ...(d.introductions ? ['introductions-v1'] : []), ...(d.onSignal ? ['rtc-signals-v1'] : []), ...(tests ? ['test-messages-v2'] : []), ...(chat ? ['chat-text-v1'] : [])] }); } catch { stop(); }
  return {
    ready, stop,
    mediaRelayPeer:()=>peerMediaRelay && peer && !stopped && d.current() && peer.expiresAt>d.now()?{...peer}:null,
    mediaForwardPeer:()=>peerMediaForward && peer && !stopped && d.current() && peer.expiresAt>d.now()?{...peer}:null,
    async mediaRelayRequest(raw:string,forward=false):Promise<boolean> {
      const permitted=()=>!!peer&&(forward?peerMediaForward:peerMediaRelay)&&peer.expiresAt>d.now()&&!stopped&&d.current();
      if(!permitted()||typeof raw!=='string'||new TextEncoder().encode(raw).length>12000||custodyWaiting>=2||pushWaiting>0)return false;
      custodyWaiting++;
      try {
        for(let waits=0;permitted()&&(authenticating||introducing||pending)&&waits<80;waits++)await wait(25);
        if(!permitted()||authenticating||introducing||pending)return false;
        const reply=await exchange(forward?'call-media-forward':'call-media-relay',raw);
        return permitted()&&JSON.parse(reply)?.accepted===true;
      }catch{return false;}finally{custodyWaiting--;}
    },
    relayPeer: () => peerRelay && peer && !stopped && d.current() && peer.expiresAt > d.now() ? { ...peer } : null,
    async callRelayRequest(raw: string): Promise<string | null> {
      const permitted = () => peerRelay && !!peer && peer.expiresAt > d.now() && !stopped && d.current();
      if (!permitted() || typeof raw !== 'string' || new TextEncoder().encode(raw).length > 13000 || (custodyWaiting >= 2 || pushWaiting > 0)) return null;
      custodyWaiting++;
      try {
        for (let waits = 0; permitted() && (authenticating || introducing || pending) && waits < 80; waits++)
          await wait(25);
        if (!permitted() || authenticating || introducing || pending) return null;
        const result = await exchange('call-relay', raw);
        return permitted() && new TextEncoder().encode(result).length <= 13000 ? result : null;
      } catch { return null; }
      finally { custodyWaiting--; }
    },
    mediaContext: () => d.onCallMedia && peerMedia && peer && !stopped && d.current() && peer.expiresAt > d.now()
      ? { peer: { ...peer }, instance: bytesToHex(d.instance) } : null,
    async callMediaRequest(raw: string): Promise<boolean> {
      const permitted = () => !!d.onCallMedia && peerMedia && !!peer && peer.expiresAt > d.now() && !stopped && d.current();
      const event = verifyCallMediaSignal(raw, d.record, d.now());
      if (!permitted() || !event || event.record.account !== d.record.account || (custodyWaiting >= 2 || pushWaiting > 0)
        || event.sourceInstance !== bytesToHex(d.instance) || event.targetInstance !== peer!.instance
        || event.target !== peer!.account || event.targetDevice !== peer!.device
        || !d.record.devices.some(device => device.id === event.device && device.signing === bytesToHex(ed25519.getPublicKey(d.signingSeed)))) return false;
      custodyWaiting++;
      try {
        for (let waits = 0; permitted() && (authenticating || introducing || pending) && waits < 80; waits++)
          await wait(25);
        if (!permitted() || authenticating || introducing || pending || event.expiresAt <= d.now()) return false;
        const reply = await exchange('call-media', raw);
        return permitted() && JSON.parse(reply)?.accepted === true;
      } catch { return false; }
      finally { custodyWaiting--; }
    },
    callPeer: () => d.onCallControl && peerCalls && peer && !stopped && d.current() && peer.expiresAt > d.now() ? { ...peer } : null,
    supportsCallControl: () => !!d.onCallControl && peerCalls && !!peer && !stopped && d.current() && peer.expiresAt > d.now(),
    async callControlRequest(raw: string): Promise<string | null> {
      const permitted = () => !!d.onCallControl && peerCalls && !!peer && peer.expiresAt > d.now() && !stopped && d.current();
      const event = verifyCallControl(raw, d.record, d.now());
      if (!permitted() || !event || event.record.account !== d.record.account || (custodyWaiting >= 2 || pushWaiting > 0)
        || !d.record.devices.some(device => device.id === event.device && device.signing === bytesToHex(ed25519.getPublicKey(d.signingSeed)))) return null;
      if (
        (event.record.account === event.caller ? event.callee : event.caller) !== peer!.account) return null;
      custodyWaiting++;
      try {
        for (let waits = 0; permitted() && (authenticating || introducing || pending) && waits < 80; waits++)
          await wait(25);
        if (!permitted() || authenticating || introducing || pending || event.expiresAt <= d.now()) return null;
        const reply = await exchange('call-control', raw);
        const latest = await d.store.read(peer!.account);
        const receipt = latest && verifyCallControlReceipt(reply, event, latest, d.now());
        return permitted() && receipt?.device === peer!.device ? reply : null;
      } catch { return null; }
      finally { custodyWaiting--; }
    },
    supportsDirectory: () => !!d.onDirectory && peerDirectory && !!peer && !stopped && d.current() && peer.expiresAt > d.now(),
    supportsPush: () => !!d.onPush && peerPush && !!peer && !stopped && d.current() && peer.expiresAt > d.now(),
    async pushRequest(raw: string): Promise<string | null> {
      const permitted = () => !!d.onPush && !!peer && peer.expiresAt > d.now() && peerPush && !stopped && d.current();
      if (!permitted() || raw.length > 5000 || pushWaiting>=3) return null;
      // Stop new polling reservations briefly so registration cannot starve behind them.
      pushWaiting++;let reserved=false;
      try {
        for(let waits=0;permitted()&&custodyWaiting>=2&&waits<160;waits++)await wait(25);
        if(!permitted()||custodyWaiting>=2)return null;
        custodyWaiting++;reserved=true;
        for(let waits=0;permitted()&&(authenticating||introducing||pending)&&waits<160;waits++)await wait(25);
        if(!permitted()||authenticating||introducing||pending)return null;
        const result=await exchange('push',raw);return permitted()?result:null;
      }catch{return null;}finally{if(reserved)custodyWaiting--;pushWaiting--;}
    },
    async directoryRequest(raw: string): Promise<string | null> {
      const permitted = () => !!d.onDirectory && !!peer && peer.expiresAt > d.now() && peerDirectory && !stopped && d.current();
      if (!permitted() || raw.length > 13_000 || (custodyWaiting >= 2 || pushWaiting > 0)) return null;
      custodyWaiting++;
      try {
        for (let waits = 0; permitted() && (authenticating || introducing || pending) && waits < 80; waits++)
          await wait(25);
        if (!permitted() || authenticating || introducing || pending) return null;
        const result = await exchange('directory', raw);
        return permitted() ? result : null;
      } catch { return null; }
      finally { custodyWaiting--; }
    },
    supportsProfileUpdates:()=>peerProfileUpdates&&!!peer&&!stopped&&d.current()&&peer.expiresAt>d.now(),
    supportsMessageTimestamps:()=>peerMessageTimestamps&&!!peer&&!stopped&&d.current()&&peer.expiresAt>d.now(),
    supportsSharedAttachments:()=>peerSharedAttachments&&!!d.onAttachment&&!!peer&&!stopped&&d.current()&&peer.expiresAt>d.now(),
    supportsAttachments:()=>peerAttachments&&!!d.onAttachment&&!!peer&&!stopped&&d.current()&&peer.expiresAt>d.now(),
    supportsAttachmentBulk:()=>peerBulk&&!!peer&&!stopped&&d.current()&&peer.expiresAt>d.now(),
    attachmentBatchChunks:()=>smallBatches?3:128,
    attachmentBatchWindow:()=>smallBatches?smallWindow:1,
    async attachmentBulkRequest(raw:string):Promise<string|null>{
      const permitted=()=>peerBulk&&!!peer&&peer.expiresAt>d.now()&&!stopped&&d.current();
      if(!permitted()||raw.length>13000||bulkWaiting>=(smallBatches?smallWindow:2)||smallBatches&&!smallRequest(raw))return null;
      bulkWaiting++;
      try{
        for(let n=0;permitted()&&(authenticating||custodyWaiting||pushWaiting||mediaPending.size>=4||!bulkRateReady())&&n<400;n++)await wait(5);
        if(!permitted()||authenticating||custodyWaiting||pushWaiting||mediaPending.size>=4||!bulkRateReady())return null;
        if(smallBatches)smallBatchCredits--;else bulkNext=d.now()+250;
        return await new Promise<string>((resolve,reject)=>{
          const id=++sequence;mediaPending.set(id,{bulk:true,until:d.now()+15000,started:d.now(),resolve,reject,timer:setTimeout(()=>expireMedia(id),15000)});
          try{send({version:1,kind:'bulk-request',id,body:raw});}catch{stop('bulk-send-failed');}
        }).then(value=>permitted()?value:null);
      }catch{return null;}finally{bulkWaiting--;}
    },
    async attachmentRequest(raw:string):Promise<string|null>{
      const permitted=()=>peerAttachments&&!!d.onAttachment&&!!peer&&peer.expiresAt>d.now()&&!stopped&&d.current();
      if(!permitted()||raw.length>13000||attachmentWaiting>=4)return null;
      if(peerMediaLane){
        if(mediaWaiting>=4)return null;mediaWaiting++;
        try{
          // A separate request-ID lane leaves authentication, messages and calls free.
          // Bound the window, total queue and start rate, even on zero-latency links.
          for(let waits=0;permitted()&&(mediaPending.size>=mediaWindow||authenticating||custodyWaiting>0||pushWaiting>0||!mediaRateReady())&&waits<400;waits++)await wait(5);
          if(!permitted()||mediaPending.size>=mediaWindow||authenticating||custodyWaiting>0||pushWaiting>0||!mediaRateReady())return null;
          mediaCredits--;
          return await new Promise<string>((resolve,reject)=>{
            const id=++sequence,until=d.now()+4000;
            mediaPending.set(id,{until,started:d.now(),resolve,reject,timer:setTimeout(()=>expireMedia(id),4000)});
            try{send({version:1,kind:'media-request',id,body:raw});}catch{stop('media-send-failed');}
          }).then(value=>permitted()?value:null);
        }catch{return null;}finally{mediaWaiting--;}
      }
      // Bound read-ahead locally while preserving the single-exchange wire protocol.
      attachmentWaiting++;
      const previous=attachmentTail;let release!:()=>void;
      attachmentTail=new Promise<void>(resolve=>{release=resolve;});
      await previous;
      try{
        for(let waits=0;permitted()&&(authenticating||introducing||pending||custodyWaiting>0||pushWaiting>0||d.now()<attachmentNext)&&waits<80;waits++)await wait(25);
        if(!permitted()||authenticating||introducing||pending||custodyWaiting>0||pushWaiting>0||d.now()<attachmentNext)return null;
        // Both endpoints can transfer at once. Reserve headroom within the shared
        // 3,600 incoming attachment frames/minute budget (requests plus responses).
        attachmentNext=d.now()+50;const result=await exchange('attachment',raw);return permitted()?result:null;
      }catch{return null;}finally{attachmentWaiting--;release();}
    },
    supportsCustody: () => peerCustody && !!peer && !stopped && d.current() && peer.expiresAt > d.now(),
    async custodyRequest(raw: string): Promise<string | null> {
      const permitted = () => !!peer && peer.expiresAt > d.now() && peerCustody && !stopped && d.current();
      if (!permitted() || raw.length > 8000 || (custodyWaiting >= 2 || pushWaiting > 0)) return null;
      custodyWaiting++;
      try {
        // Bounded local contention must not immediately mark a healthy relay unavailable.
        // Use a bounded number of waits so clock changes cannot prolong the queue.
        for (let waits = 0; permitted() && (authenticating || introducing || pending) && waits < 80; waits++)
          await wait(25);
        if (!permitted() || authenticating || introducing || pending) return null;
        const result = await exchange('custody', raw);
        return permitted() ? result : null;
      } catch { return null; }
      finally { custodyWaiting--; }
    },
    sendTestMessage: (text: string, id?: string) => tests?.send(text, id) ?? Promise.resolve(false),
    sendChatMessage: (text: string, id: string) => chat?.send(text, id) ?? Promise.resolve(false),
    sendSignal(raw: string) {
      if (!peer || peer.expiresAt <= d.now() || !peerSignals || !d.onSignal || stopped || !d.current()) return false;
      try { send({ version: 1, kind: 'signal', body: raw }); return true; } catch { stop(); return false; }
    },
    tick() {
      if (stopped) return;
      if (!d.current()) { stop('inactive-session'); return; }
      // Android can suspend JS timers while the native wake clock still ticks.
      // Drain contention waits and enforce exchanges from that clock as well.
      for (const sleeper of [...sleepers]) if (sleeper.until <= d.now()) sleeper.finish();
      for(const [id,task] of mediaPending)if(task.until<=d.now())expireMedia(id);
      if(stopped)return;
      if (pending && pending.until <= d.now()) { stop('exchange-timeout:' + pending.operation); return; }
      if (!peer && d.now() - started >= 10_000) { stop('handshake-timeout'); return; }
      if (peer && peer.expiresAt <= d.now()) { stop('authentication-expired'); return; }
      if (peer && d.now() >= renewalAt) void authenticate();
      else if (peer && d.now() >= introduceAt) void discover();
    },
    snapshot: () => ({ state: stopped ? 'closed' : peer ? 'connected' : 'authenticating',
      account: peer?.account ?? null, expiresAt: peer?.expiresAt ?? null, closeReason, mediaLane:peerMediaLane,bulkAttachments:peerBulk,mediaWindow,mediaInFlight:mediaPending.size,consecutiveMediaTimeouts, traffic: {...traffic} }),
  };
}
