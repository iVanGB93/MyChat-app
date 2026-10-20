import {createCustodyWake, CUSTODY_WAKE_DATA_BYTES, verifyCustody, verifyCustodyWake, type CustodyEnvelope} from './custodyProtocol.ts';
import {readCustodyStore,type CustodyStore} from './custodyService.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';

/** The durable custody store is the queue. Optional encrypted envelopes accompany signed wake metadata. */
export function createCustodyWakeForwarder(d: {
  inlineEnvelope?:boolean; store: CustodyStore; records: IdentityRecordStore; current(): boolean; now(): number;
  peers(): string[]; request(peer: string, raw: string): Promise<string | null>;
  isLocalPeer?(peer:string):boolean;
  custodian?:string;
  deliverDirect?(packet:CustodyEnvelope):Promise<boolean>;
  groupPayload?(packet:CustodyEnvelope):Promise<unknown>;
  eventDriven?:boolean;
}) {
  let busy = false, stopped = false, next = 0;
  let cached:CustodyEnvelope[]|undefined, cachedRevision:number|string|undefined, refreshAt=0;
  let generation=0,cachedGeneration=-1;
  const reconnected=new Set<string>();
  const attempts = new Map<string, {next:number;failures:number;forwarded:boolean;seen:Set<string>;defer:Map<string,number>;requests:number;last:string;at:number}>();
  const work={schedulerChecks:0,storeReads:0,selectedItems:0,localGatewayCalls:0,remoteGatewayCalls:0,requestPayloadBytes:0,responsePayloadBytes:0,elapsedMs:0};
  const outcomes:Record<string,number>={};
  // Legacy peers can advertise the push protocol without providing a gateway.
  // Remember an explicit unsupported reply across messages, but retry after a
  // bounded interval so an upgraded peer can become useful without losing mail.
  const unsupportedUntil=new Map<string,number>();
  const gateways=()=>d.peers().slice(0,10).filter(p=>(unsupportedUntil.get(p)??0)<=d.now());
  let freshRun=0;
  const current = () => !stopped && d.current();
  return {
    nextDeadline(){
      if(!current()||busy)return Infinity;
      if(!cached||cachedGeneration!==generation||d.store.revision?.()!==cachedRevision)return Math.max(d.now(),next);
      const peers=gateways();let at=Infinity;
      for(const packet of cached){
        if(packet.expires<=d.now())continue;
        const state=attempts.get(packet.sender+packet.id);
        if(!state){at=Math.min(at,Math.max(d.now(),next));continue;}
        if(state.forwarded)continue;
        if(d.deliverDirect)at=Math.min(at,Math.max(next,state.next));
        for(const peer of peers)at=Math.min(at,Math.max(next,state.defer.get(peer)??0,state.seen.size<64&&!state.seen.has(peer)?d.now():state.next));
      }
      if(!d.eventDriven)at=Math.min(at,refreshAt);
      for(const until of unsupportedUntil.values())if(until>d.now())at=Math.min(at,until);
      return at;
    },
    changed(){generation++;next=0;},
    connected(recipient:string){
      // FCM acceptance did not deliver the message. A new authenticated recipient
      // connection must get a fresh direct attempt, even after gateway acceptance.
      if(reconnected.size<128)reconnected.add(recipient);
      generation++;next=0;
    },
    async tick() {
      work.schedulerChecks++;
      if (busy || !current() || d.now() < next) return;
      busy = true; next = d.now() + 1000;
      try {
        const peers = gateways(); if (!peers.length&&!d.deliverDirect) return;
        const revision=d.store.revision?.();
        // Unversioned adapters retain their existing behavior. Periodic refresh
        // also bounds staleness if another process writes the underlying store.
        if(!cached||generation!==cachedGeneration||revision!==cachedRevision||!d.eventDriven&&(revision===undefined||d.now()>=refreshAt)){
          work.storeReads++;
          const observedGeneration=generation;
          cached=await readCustodyStore(d.store,rows => rows.filter(r => r.packet?.kind === 'envelope' && r.packet.wakeSignature && r.expires > d.now()).map(r => r.packet as CustodyEnvelope));
          cachedRevision=revision;cachedGeneration=observedGeneration;refreshAt=d.now()+30000;
        }
        const rows=cached.filter(r=>r.expires>d.now());
        for(const packet of rows)if(reconnected.has(packet.recipient)){
          const state=attempts.get(packet.sender+packet.id);
          if(state){state.forwarded=false;state.next=0;state.defer.clear();}
        }
        reconnected.clear();
        const key = (r: CustodyEnvelope) => r.sender + r.id;
        const ids = new Set(rows.map(key));
        for (const id of attempts.keys()) if (!ids.has(id)) attempts.delete(id);
        // A genuinely new gateway gets one prompt attempt. Removing/reconnecting
        // known gateways must not reset every envelope's exponential backoff.
        const eligible=rows.filter(r => {const s=attempts.get(key(r));return !s||!s.forwarded&&((!!d.deliverDirect&&s.next<=d.now())||peers.some(p=>(s.defer.get(p)??0)<=d.now()&&(s.next<=d.now()||s.seen.size<64&&!s.seen.has(p))));});
        // Newly deposited messages must not wait behind an offline backlog.
        // Reserve every fourth selection for the oldest due work so continuous
        // arrivals cannot starve retries or recovery after a process restart.
        let fresh:CustodyEnvelope|undefined;
        if(freshRun<3)for(let i=eligible.length-1;i>=0;i--){if(!attempts.has(key(eligible[i]))){fresh=eligible[i];break;}}
        const packet=fresh??eligible[0];
        if (!packet || !current()) return;
        freshRun=fresh?freshRun+1:0;
        const previous=attempts.get(key(packet)),due=!previous||previous.next<=d.now();
        const targets=(due?peers:peers.filter(p=>!previous!.seen.has(p))).filter(p=>(previous?.defer.get(p)??0)<=d.now());
        const failures=(previous?.failures??0)+(due?1:0),seen=previous?.seen??new Set<string>();
        for(const peer of targets)if(seen.size<64)seen.add(peer);
        // Retain ciphertext and retry indefinitely until expiry, but do not hammer
        // every gateway every 30 seconds for a device that remains unavailable.
        const state={next:due?d.now()+Math.min(900000,30000*2**Math.min(failures-1,5)):previous!.next,failures,forwarded:false,seen,defer:previous?.defer??new Map<string,number>(),requests:previous?.requests??0,last:'validation',at:d.now()};
        attempts.set(key(packet),state);work.selectedItems++;
        if (!await verifyCustody(packet, d.records, d.now()) || !current()) return;
        if(d.deliverDirect&&await d.deliverDirect(packet)){
          state.forwarded=true;state.last='recipient_receipt';state.next=packet.expires;
          outcomes.recipient_receipt=(outcomes.recipient_receipt??0)+1;return;
        }
        if(!current())return;
        const record = await d.records.read(packet.sender); if (!record || !current()) return;
        const data: (NonNullable<ReturnType<typeof createCustodyWake>>&{payload?:string})|null = createCustodyWake(packet, record, d.inlineEnvelope,d.custodian); if (!data) return;
        if(d.groupPayload){
          const payload=await d.groupPayload(packet);
          const candidate={...data,envelope:JSON.stringify(packet),payload:JSON.stringify(payload)};
          // A grant alone cannot decode a group message. Include both or neither.
          if(payload&&new TextEncoder().encode(JSON.stringify(candidate)).length<=CUSTODY_WAKE_DATA_BYTES)Object.assign(data,candidate);
          else delete data.envelope;
        }
        // The envelope signature and wake signature bind different statements.
        // Never send a known-invalid wake repeatedly to each gateway. Keep its
        // ciphertext for normal delivery; this is not a receipt or deletion.
        if(!verifyCustodyWake(data,record,packet.recipient,packet.recipientDevice,d.now())){
          // Counterfactual verification is diagnostic only. Never forward or
          // rewrite a packet under the alternate flag, even if it verifies.
          const alternate=JSON.parse(data.event);
          if(alternate.wakeMode==='silent')delete alternate.wakeMode;else alternate.wakeMode='silent';
          const reason=verifyCustodyWake({...data,event:JSON.stringify(alternate)},record,packet.recipient,packet.recipientDevice,d.now())
            ?'local_silent_flag_binding_mismatch':'local_wake_verification_failed';
          state.last=reason;state.at=d.now();outcomes[reason]=(outcomes[reason]??0)+1;
          return;
        }
        const raw = JSON.stringify({version: 1, operation: 'wake-message', data});
        async function request(peer:string,body:string){
          const start=d.now();state.requests++;if(d.isLocalPeer?.(peer))work.localGatewayCalls++;else work.remoteGatewayCalls++;
          work.requestPayloadBytes+=new TextEncoder().encode(body).length;
          try{const response=await d.request(peer,body);work.responsePayloadBytes+=new TextEncoder().encode(response??'').length;return JSON.parse(response??'{}');}
          finally{work.elapsedMs+=Math.max(0,d.now()-start);}
        }
        for (const peer of targets) {
          if (!current() || packet.expires <= d.now()) return;
          try {
            let reply = await request(peer,raw);
            // Older gateways accept signed hints but reject the optional payload.
            if(reply.status==='rejected'&&(data.envelope||data.custodian)&&current()){
              const {envelope:_,custodian:__,payload:___,...hint}=data;
              reply=await request(peer,JSON.stringify({version:1,operation:'wake-message',data:hint}));
            }
            if (!current()) return;
            const status=['forwarded','retry','rejected','unsupported'].includes(reply?.status)?reply.status:'unavailable';
            state.last=status;state.at=d.now();outcomes[status]=(outcomes[status]??0)+1;
            if(status==='unsupported'){
              if(unsupportedUntil.size>=128&&!unsupportedUntil.has(peer))unsupportedUntil.delete(unsupportedUntil.keys().next().value!);
              unsupportedUntil.set(peer,d.now()+300000);
            }
            if(status==='retry'&&Number.isSafeInteger(reply.retryAfterMs)&&reply.retryAfterMs>0){if(state.defer.size<64||state.defer.has(peer))state.defer.set(peer,Math.min(packet.expires,d.now()+Math.min(900000,reply.retryAfterMs)));}
            if (status === 'forwarded') {state.next=packet.expires;state.failures=0;state.forwarded=true;return;}
          } catch {state.last='exception';state.at=d.now();outcomes.exception=(outcomes.exception??0)+1; /* Another gateway, then bounded retry. */ }
        }
      } catch { /* Storage/transport failures retain the encrypted envelope. */ }
      finally { busy = false; }
    },
    diagnostics(){const peers=gateways(),rows=[...attempts.values()],nextAt=(s:typeof rows[number])=>peers.length?Math.min(...peers.map(p=>Math.max(s.seen.size<64&&!s.seen.has(p)?d.now():s.next,s.defer.get(p)??0))):null;return {purpose:'Wake a recipient for retained message custody; not call wakes or message delivery',work:{...work},outcomes:{...outcomes},workScope:'Runtime counters. Gateway calls are adapter invocations, not confirmed transmissions; bytes are JSON payload bytes, not wire bytes; elapsedMs sums local and remote request time.',trackedEnvelopes:attempts.size,backingOff:rows.filter(s=>!s.forwarded&&(nextAt(s)??Infinity)>d.now()).length,acceptedEnvelopes:rows.filter(s=>s.forwarded&&s.last==='forwarded').length,pendingSample:rows.filter(s=>!s.forwarded).slice(0,8).map(s=>({requests:s.requests,lastOutcome:s.last,lastObservedAt:s.at,nextRetryAt:nextAt(s)})),sampleScope:'Up to eight currently tracked items; no message/account IDs; not lifetime unique counts',retryPolicy:'30s exponential backoff capped at 15 minutes; honor per-gateway retry delays up to 15 minutes; new gateways get one prompt attempt; reconnects do not reset backoff; gateway acceptance is not delivery'};},
    stop() { stopped = true; cached=undefined; attempts.clear(); unsupportedUntil.clear();reconnected.clear(); },
  };
}
