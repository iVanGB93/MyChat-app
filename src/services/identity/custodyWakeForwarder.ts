import {createCustodyWake, verifyCustody, type CustodyEnvelope} from './custodyProtocol.ts';
import {readCustodyStore,type CustodyStore} from './custodyService.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';

/** The durable custody store is the queue. Optional encrypted envelopes accompany signed wake metadata. */
export function createCustodyWakeForwarder(d: {
  inlineEnvelope?:boolean; store: CustodyStore; records: IdentityRecordStore; current(): boolean; now(): number;
  peers(): string[]; request(peer: string, raw: string): Promise<string | null>;
}) {
  let busy = false, stopped = false, next = 0;
  const attempts = new Map<string, {next:number;failures:number;forwarded:boolean}>();
  let peerSet='';
  let freshRun=0;
  const current = () => !stopped && d.current();
  return {
    async tick() {
      if (busy || !current() || d.now() < next) return;
      busy = true; next = d.now() + 1000;
      try {
        const peers = d.peers().slice(0, 10); if (!peers.length) return;
        const topology=[...peers].sort().join(',');
        if(topology!==peerSet){for(const state of attempts.values())if(!state.forwarded)state.next=0;peerSet=topology;}
        const rows = await readCustodyStore(d.store,rows => rows.filter(r => r.packet?.kind === 'envelope' && r.packet.wakeSignature && r.expires > d.now()).map(r => r.packet as CustodyEnvelope));
        const key = (r: CustodyEnvelope) => r.sender + r.id;
        const ids = new Set(rows.map(key));
        for (const id of attempts.keys()) if (!ids.has(id)) attempts.delete(id);
        const eligible=rows.filter(r => (attempts.get(key(r))?.next ?? 0) <= d.now());
        // Newly deposited messages must not wait behind an offline backlog.
        // Reserve every fourth selection for the oldest due work so continuous
        // arrivals cannot starve retries or recovery after a process restart.
        let fresh:CustodyEnvelope|undefined;
        if(freshRun<3)for(let i=eligible.length-1;i>=0;i--){if(!attempts.has(key(eligible[i]))){fresh=eligible[i];break;}}
        const packet=fresh??eligible[0];
        if (!packet || !current()) return;
        freshRun=fresh?freshRun+1:0;
        const failures=(attempts.get(key(packet))?.failures??0)+1;
        // Retain ciphertext and retry indefinitely until expiry, but do not hammer
        // every gateway every 30 seconds for a device that remains unavailable.
        attempts.set(key(packet), {next:d.now()+Math.min(900000,30000*2**Math.min(failures-1,5)),failures,forwarded:false});
        if (!await verifyCustody(packet, d.records, d.now()) || !current()) return;
        const record = await d.records.read(packet.sender); if (!record || !current()) return;
        const data = createCustodyWake(packet, record, d.inlineEnvelope); if (!data) return;
        const raw = JSON.stringify({version: 1, operation: 'wake-message', data});
        for (const peer of peers) {
          if (!current() || packet.expires <= d.now()) return;
          try {
            let reply = JSON.parse(await d.request(peer, raw) ?? '{}');
            // Older gateways accept signed hints but reject the optional payload.
            if(reply.status==='rejected'&&data.envelope&&current()){
              const {envelope:_,...hint}=data;
              reply=JSON.parse(await d.request(peer,JSON.stringify({version:1,operation:'wake-message',data:hint}))??'{}');
            }
            if (!current()) return;
            if (reply.status === 'forwarded') { attempts.set(key(packet), {next:packet.expires,failures:0,forwarded:true}); return; }
          } catch { /* Another connected gateway, then a bounded retry from durable custody. */ }
        }
      } catch { /* Storage/transport failures retain the encrypted envelope. */ }
      finally { busy = false; }
    },
    diagnostics(){return {trackedEnvelopes:attempts.size,backingOff:[...attempts.values()].filter(s=>!s.forwarded&&s.next>d.now()).length,acceptedEnvelopes:[...attempts.values()].filter(s=>s.forwarded).length,retryPolicy:'30s exponential backoff, capped at 15 minutes; new gateway topology retries promptly; provider acceptance is not delivery'};},
    stop() { stopped = true; attempts.clear(); },
  };
}
