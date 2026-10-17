import {createCustodyWake, verifyCustody, verifyCustodyWake, type CustodyEnvelope} from './custodyProtocol.ts';
import {readCustodyStore,type CustodyStore} from './custodyService.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';

/** The durable custody store is the queue. Optional encrypted envelopes accompany signed wake metadata. */
export function createCustodyWakeForwarder(d: {
  inlineEnvelope?:boolean; store: CustodyStore; records: IdentityRecordStore; current(): boolean; now(): number;
  peers(): string[]; request(peer: string, raw: string): Promise<string | null>;
  isLocalPeer?(peer:string):boolean;
}) {
  let busy = false, stopped = false, next = 0;
  let cached:CustodyEnvelope[]|undefined, cachedRevision:number|string|undefined, refreshAt=0;
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
    async tick() {
      work.schedulerChecks++;
      if (busy || !current() || d.now() < next) return;
      busy = true; next = d.now() + 1000;
      try {
        const peers = gateways(); if (!peers.length) return;
        const revision=d.store.revision?.();
        // Unversioned adapters retain their existing behavior. Periodic refresh
        // also bounds staleness if another process writes the underlying store.
        if(!cached||revision===undefined||revision!==cachedRevision||d.now()>=refreshAt){
          work.storeReads++;
          cached=await readCustodyStore(d.store,rows => rows.filter(r => r.packet?.kind === 'envelope' && r.packet.wakeSignature && r.expires > d.now()).map(r => r.packet as CustodyEnvelope));
          cachedRevision=revision;refreshAt=d.now()+30000;
        }
        const rows=cached.filter(r=>r.expires>d.now());
        const key = (r: CustodyEnvelope) => r.sender + r.id;
        const ids = new Set(rows.map(key));
        for (const id of attempts.keys()) if (!ids.has(id)) attempts.delete(id);
        // A genuinely new gateway gets one prompt attempt. Removing/reconnecting
        // known gateways must not reset every envelope's exponential backoff.
        const eligible=rows.filter(r => {const s=attempts.get(key(r));return !s||!s.forwarded&&peers.some(p=>(s.defer.get(p)??0)<=d.now()&&(s.next<=d.now()||s.seen.size<64&&!s.seen.has(p)));});
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
        const record = await d.records.read(packet.sender); if (!record || !current()) return;
        const data = createCustodyWake(packet, record, d.inlineEnvelope); if (!data) return;
        // The envelope signature and wake signature bind different statements.
        // Never send a known-invalid wake repeatedly to each gateway. Keep its
        // ciphertext for normal delivery; this is not a receipt or deletion.
        if(!verifyCustodyWake(data,record,packet.recipient,packet.recipientDevice,d.now())){
          state.last='local_wake_verification_failed';state.at=d.now();
          outcomes.local_wake_verification_failed=(outcomes.local_wake_verification_failed??0)+1;
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
            if(reply.status==='rejected'&&data.envelope&&current()){
              const {envelope:_,...hint}=data;
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
    diagnostics(){const peers=gateways(),rows=[...attempts.values()],nextAt=(s:typeof rows[number])=>peers.length?Math.min(...peers.map(p=>Math.max(s.seen.size<64&&!s.seen.has(p)?d.now():s.next,s.defer.get(p)??0))):null;return {purpose:'Wake a recipient for retained message custody; not call wakes or message delivery',work:{...work},outcomes:{...outcomes},workScope:'Runtime counters. Gateway calls are adapter invocations, not confirmed transmissions; bytes are JSON payload bytes, not wire bytes; elapsedMs sums local and remote request time.',trackedEnvelopes:attempts.size,backingOff:rows.filter(s=>!s.forwarded&&(nextAt(s)??Infinity)>d.now()).length,acceptedEnvelopes:rows.filter(s=>s.forwarded).length,pendingSample:rows.filter(s=>!s.forwarded).slice(0,8).map(s=>({requests:s.requests,lastOutcome:s.last,lastObservedAt:s.at,nextRetryAt:nextAt(s)})),sampleScope:'Up to eight currently tracked items; no message/account IDs; not lifetime unique counts',retryPolicy:'30s exponential backoff capped at 15 minutes; honor per-gateway retry delays up to 15 minutes; new gateways get one prompt attempt; reconnects do not reset backoff; gateway acceptance is not delivery'};},
    stop() { stopped = true; cached=undefined; attempts.clear(); unsupportedUntil.clear(); },
  };
}
