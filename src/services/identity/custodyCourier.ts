import { custodyDigest, parseCustody, verifyCustody, type CustodyEnvelope, type CustodyReceipt } from './custodyProtocol.ts';
import type { OwnCustodyStore } from './normalChatContracts.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
import type { IdentityRecord } from './identityProtocol.ts';
import type { TestRow } from './custodyCourierTypes.ts';
import {createRelayPollSchedule} from './relayPollSchedule.ts';
interface TestMessageStore { list(owner: string): Promise<TestRow[]>; update(row: TestRow, delivered: boolean, next: number, current: () => boolean): Promise<void>; }
// Longer than the outbox's maximum retry interval (60s), so a failed
// first-choice peer cannot become eligible again before fallback runs.
const CUSTODIAN_BACKOFF_MS = 120_000;
/** Foreground experimental outbox fallback. Store acceptance never becomes delivery. */
export function createCustodyCourier(d: {
  owner(): string | null; allowed(peer: string): boolean; now(): number; records: IdentityRecordStore;
  own: OwnCustodyStore; messages?: TestMessageStore; relays(): string[];
  eventDriven?(peer:string):boolean;
  /** Normal-chat adapter must durably apply the verified receipt before relay consumption. */
  held?(envelope:CustodyEnvelope):Promise<void>;
  confirmReceipt?(receipt: CustodyReceipt, current: () => boolean, relay:string): Promise<boolean>;
  request(relay: string, raw: string): Promise<string | null>;
  seal(record: IdentityRecord, device: string, id: string, text: string): Promise<CustodyEnvelope>;
  receive(envelope: CustodyEnvelope, relay:string): Promise<CustodyReceipt | null>;
}) {
  let epoch = 0, stopped = false;
  const depositing = new Set<string>();
  const unavailable = new Map<string, number>();
  const polls = createRelayPollSchedule(d.now,10,d.eventDriven);
  const skips = new Map<string, { until: number; ids: string[] }>();
  const deferred = new Map<string, Map<string,{until:number;attempts:number}>>();
  const acknowledged = new Set<string>(), drained = new Set<string>();
  const lease = () => { const owner = d.owner(), generation = epoch; return { owner, current: () => !!owner && !stopped && generation === epoch && d.owner() === owner }; };
  async function request(relay: string, body: unknown) {
    const raw = await d.request(relay, JSON.stringify(body));
    if (!raw || raw.length > 8000) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  return {
    diagnostics:polls.diagnostics,
    nextDeadline:()=>stopped||!d.owner()?Infinity:polls.nextDeadline(d.relays()),
    recoveryComplete(sender:string,id:string) {
      const relays=[...new Set(d.relays())].slice(0,10);
      return !stopped&&acknowledged.has(sender+':'+id)&&depositing.size===0&&relays.length>0&&relays.every(relay=>drained.has(relay)&&!polls.busy(relay));
    },
    async deposit(peer: string, text: string, id: string) {
      const l = lease(); if (!l.current() || !d.allowed(peer) || depositing.has(peer) || depositing.size>=2) return;
      const candidates = d.relays().filter(r => r !== peer && r !== l.owner && (unavailable.get(r+':'+peer) ?? 0) <= d.now()).slice(0, 10);
      if (!candidates.length) return;
      depositing.add(peer);
      try {
        let saved = await d.own.get(l.owner!, id);
        if (!saved) {
          const record = await d.records.read(peer); if (!record || !l.current()) return;
          // First eligible device is deterministic. Multi-device fanout is a separate milestone.
          const envelope = await d.seal(record, record.devices[0].id, id, text);
          if (!l.current()) return;
          saved = await d.own.save(l.owner!, envelope, l.current);
        }
        if (!saved || !l.current() || saved.envelope.recipient !== peer || saved.envelope.expires <= d.now()) return;
        // Keep one custodian when reachable; prefer locally ranked candidates otherwise.
        const preferred = saved.relay && candidates.includes(saved.relay)
          ? saved.relay : candidates[0];
        for(const relay of [preferred,...candidates.filter(r=>r!==preferred)].slice(0,3)){
        if(!l.current())return;
        // A connected socket can still time out or fail to service custody.
        // Back off that peer so it cannot starve the next available custodian.
        let response: { status?: string } | null = null;
        try { response = await request(relay, { operation: 'deposit', packet: saved.envelope }); }
        catch { /* Treat transport failure like an unanswered request. */ }
        if (l.current() && response?.status === 'held') {
          await d.own.held(l.owner!, id, relay, l.current);
          if(l.current())await d.held?.(saved.envelope);
          return l.current();
        }
        if(response?.status==='completed')return;
        else if (l.current()) {
          // Quotas/rejections can belong to one recipient. Do not make that
          // recipient's failed deposit disable this relay for unrelated chats.
          if (unavailable.size >= 256) unavailable.delete(unavailable.keys().next().value!);
          unavailable.set(relay+':'+peer, d.now() + CUSTODIAN_BACKOFF_MS);
        }
        }
      } finally { depositing.delete(peer); }
    },
    async tick() {
      const l = lease(); if (!l.current()) return;
      const relays = [...new Set(d.relays())].slice(0, 10);
      polls.prune(relays);
      await Promise.all(relays.map(async relay => {
        const passSchedule=polls.begin(relay);if(!passSchedule)return;
        const outcome={empty:false,item:false,retryAfterMs:undefined as number|undefined};
        drained.delete(relay);
        try {
          let skip = skips.get(relay);
          if (!skip || skip.until <= d.now()) {
            skip = { until: d.now() + 60000, ids: [] };
            if (skips.size >= 10) skips.clear(); skips.set(relay, skip);
          }
          // Drain a bounded batch on each independent connection. A slow peer
          // must not consume the entire background recovery window.
          let rejected=deferred.get(relay);
          if(!rejected){if(deferred.size>=10)deferred.clear();rejected=new Map();deferred.set(relay,rejected);}
          // Keep attempt counts across retries; only exclusions expire.
          const defer=(id:string)=>{const attempts=(rejected!.get(id)?.attempts??0)+1;if(!rejected!.has(id)&&rejected!.size>=124)rejected!.delete(rejected!.keys().next().value!);rejected!.set(id,{attempts,until:d.now()+Math.min(300000,15000*2**Math.min(attempts-1,5))});};
          // Unusable receipts must not occupy every poll batch forever. Keep
          // them at the relay and retry shortly; never consume or acknowledge them.
          const pass = [...new Set([...skip.ids,...[...rejected].filter(([,v])=>v.until>d.now()).map(([id])=>id)])].slice(-124);
          let incomplete=false;
          for (let count = 0; count < 4 && l.current() && pass.length < 128; count++) {
            const reply = await request(relay, { operation: 'poll', exclude: pass });
            if (!l.current() || reply?.status !== 'ok') {
              if(reply?.status==='retry')outcome.retryAfterMs=reply.retryAfterMs;
              break;
            }
            if (!reply.packet) {
              outcome.empty=true;
              // An expired exclusion that was offered but not returned is no
              // longer held. Keep exclusions actually used by this request.
              for(const [id,value] of rejected)if(value.until<=d.now()&&!pass.includes(id))rejected.delete(id);
              if(!incomplete&&!rejected.size)drained.add(relay);break;
            }
            outcome.item=true;
            const packet = parseCustody(JSON.stringify(reply.packet), d.now());
            if (!packet || pass.includes(packet.id)) break;
            pass.push(packet.id);
            let accepted = false;
            if (packet.kind === 'envelope') {
              if (packet.recipient !== l.owner || !d.allowed(packet.sender)) {
                skip.ids.push(packet.id); continue;
              }
              let receipt:CustodyReceipt|null=null;
              try { receipt=await d.receive(packet, relay); }
              catch { if(l.current())defer(packet.id);continue; }
              if(!receipt&&l.current()){defer(packet.id);continue;}
              if (receipt && l.current()) accepted = (await request(relay, { operation: 'receipt', packet: receipt }))?.status === 'accepted';
            } else {
              if(!l.current())continue;
              if (packet.sender !== l.owner || !d.allowed(packet.recipient) || !await verifyCustody(packet, d.records, d.now())) {if(l.current())defer(packet.id);continue;}
              if(!l.current())continue;
              const saved = await d.own.get(l.owner!, packet.id), e = saved?.envelope;
              if (!l.current())continue;
              if (!e || packet.digest !== custodyDigest(e) || packet.recipient !== e.recipient || packet.recipientDevice !== e.recipientDevice || packet.expires !== e.expires) {defer(packet.id);continue;}
              if (d.confirmReceipt) {
                if (!await d.confirmReceipt(packet, l.current, relay)) {if(l.current())defer(packet.id);continue;}
                if (!l.current()) continue;
              } else {
                const row = (await d.messages?.list(l.owner!) ?? []).find(r => r.direction === 'out' && r.id === packet.id && r.peer === packet.recipient);
                if (!row || !l.current()) continue;
                await d.messages!.update(row, true, 0, l.current);
              }
              if (l.current()) accepted = (await request(relay, { operation: 'consume', id: packet.id, digest: packet.digest }))?.status === 'accepted';
              if (accepted && l.current()) await d.own.consumed?.(l.owner!,packet.id,l.current);
            }
            // Lost acknowledgements retry next pass, not a minute later. The
            // durable recipient store makes duplicate delivery idempotent.
            if (accepted && l.current()) {
              rejected.delete(packet.id);skip.ids.push(packet.id);
              if(packet.kind==='envelope'){
                if(acknowledged.size>=256)acknowledged.delete(acknowledged.values().next().value!);
                acknowledged.add(packet.sender+':'+packet.id);
              }
            }
            else incomplete=true;
          }
        } catch { /* This relay retries without blocking the other custodians. */ }
        finally { passSchedule.finish({...outcome,settled:drained.has(relay)}); }
      }));
    },
    resume(peer?:string) { drained.clear();acknowledged.clear();polls.resume(peer); },
    invalidate() { epoch++; acknowledged.clear();drained.clear();unavailable.clear(); skips.clear(); deferred.clear();polls.resume(); },
    stop() { stopped = true; epoch++; acknowledged.clear();drained.clear();skips.clear(); deferred.clear(); },
  };
}
