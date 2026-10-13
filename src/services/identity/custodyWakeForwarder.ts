import {createCustodyWake, verifyCustody, type CustodyEnvelope} from './custodyProtocol.ts';
import type {CustodyStore} from './custodyService.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';

/** The durable custody store is the queue. Only signed public wake metadata leaves it. */
export function createCustodyWakeForwarder(d: {
  store: CustodyStore; records: IdentityRecordStore; current(): boolean; now(): number;
  peers(): string[]; request(peer: string, raw: string): Promise<string | null>;
}) {
  let busy = false, stopped = false, next = 0;
  const attempts = new Map<string, {next:number;failures:number;forwarded:boolean}>();
  let peerSet='';
  const current = () => !stopped && d.current();
  return {
    async tick() {
      if (busy || !current() || d.now() < next) return;
      busy = true; next = d.now() + 1000;
      try {
        const peers = d.peers().slice(0, 10); if (!peers.length) return;
        const topology=[...peers].sort().join(',');
        if(topology!==peerSet){for(const state of attempts.values())if(!state.forwarded)state.next=0;peerSet=topology;}
        const rows = await d.store.transaction(rows => rows.filter(r => r.packet?.kind === 'envelope' && r.packet.wakeSignature && r.expires > d.now()).map(r => r.packet as CustodyEnvelope));
        const key = (r: CustodyEnvelope) => r.sender + r.id;
        const ids = new Set(rows.map(key));
        for (const id of attempts.keys()) if (!ids.has(id)) attempts.delete(id);
        const packet = rows.find(r => (attempts.get(key(r))?.next ?? 0) <= d.now());
        if (!packet || !current()) return;
        const failures=(attempts.get(key(packet))?.failures??0)+1;
        // Retain ciphertext and retry indefinitely until expiry, but do not hammer
        // every gateway every 30 seconds for a device that remains unavailable.
        attempts.set(key(packet), {next:d.now()+Math.min(900000,30000*2**Math.min(failures-1,5)),failures,forwarded:false});
        if (!await verifyCustody(packet, d.records, d.now()) || !current()) return;
        const record = await d.records.read(packet.sender); if (!record || !current()) return;
        const data = createCustodyWake(packet, record); if (!data) return;
        const raw = JSON.stringify({version: 1, operation: 'wake-message', data});
        for (const peer of peers) {
          if (!current() || packet.expires <= d.now()) return;
          try {
            const reply = JSON.parse(await d.request(peer, raw) ?? '{}');
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
