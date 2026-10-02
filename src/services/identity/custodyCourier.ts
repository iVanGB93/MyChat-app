import { custodyDigest, parseCustody, verifyCustody, type CustodyEnvelope, type CustodyReceipt } from './custodyProtocol.ts';
import type { OwnCustodyStore } from './normalChatContracts.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
import type { IdentityRecord } from './identityProtocol.ts';
import type { TestRow } from './custodyCourierTypes.ts';
interface TestMessageStore { list(owner: string): Promise<TestRow[]>; update(row: TestRow, delivered: boolean, next: number, current: () => boolean): Promise<void>; }
// Longer than the outbox's maximum retry interval (60s), so a failed
// first-choice peer cannot become eligible again before fallback runs.
const CUSTODIAN_BACKOFF_MS = 120_000;
/** Foreground experimental outbox fallback. Store acceptance never becomes delivery. */
export function createCustodyCourier(d: {
  owner(): string | null; allowed(peer: string): boolean; now(): number; records: IdentityRecordStore;
  own: OwnCustodyStore; messages?: TestMessageStore; relays(): string[];
  /** Normal-chat adapter must durably apply the verified receipt before relay consumption. */
  confirmReceipt?(receipt: CustodyReceipt, current: () => boolean): Promise<boolean>;
  request(relay: string, raw: string): Promise<string | null>;
  seal(record: IdentityRecord, device: string, id: string, text: string): Promise<CustodyEnvelope>;
  receive(envelope: CustodyEnvelope): Promise<CustodyReceipt | null>;
}) {
  let epoch = 0, stopped = false, polling = false, depositing = false, nextPoll = 0, cursor = 0;
  const unavailable = new Map<string, number>();
  const skips = new Map<string, { until: number; ids: string[] }>();
  const lease = () => { const owner = d.owner(), generation = epoch; return { owner, current: () => !!owner && !stopped && generation === epoch && d.owner() === owner }; };
  async function request(relay: string, body: unknown) {
    const raw = await d.request(relay, JSON.stringify(body));
    if (!raw || raw.length > 8000) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  return {
    async deposit(peer: string, text: string, id: string) {
      const l = lease(); if (!l.current() || !d.allowed(peer) || depositing) return;
      const candidates = d.relays().filter(r => r !== peer && r !== l.owner && (unavailable.get(r) ?? 0) <= d.now()).slice(0, 10);
      if (!candidates.length) return;
      depositing = true;
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
        const relay = saved.relay && candidates.includes(saved.relay) ? saved.relay : candidates[0];
        // A connected socket can still time out or fail to service custody.
        // Back off that peer so it cannot starve the next available custodian.
        let response: { status?: string } | null = null;
        try { response = await request(relay, { operation: 'deposit', packet: saved.envelope }); }
        catch { /* Treat transport failure like an unanswered request. */ }
        if (l.current() && response?.status === 'held') {
          await d.own.held(l.owner!, id, relay, l.current);
          return l.current();
        }
        else if (l.current() && response?.status !== 'completed') {
          if (unavailable.size >= 10) unavailable.clear(); unavailable.set(relay, d.now() + CUSTODIAN_BACKOFF_MS);
        }
      } finally { depositing = false; }
    },
    async tick() {
      const l = lease(); if (!l.current() || polling || d.now() < nextPoll) return;
      const relays = d.relays().slice(0, 10); if (!relays.length) return;
      const relay = relays[cursor++ % relays.length]; nextPoll = d.now() + 5000; polling = true;
      try {
        let skip = skips.get(relay); if (!skip || skip.until <= d.now()) { skip = { until: d.now() + 60000, ids: [] }; if (skips.size >= 10) skips.clear(); skips.set(relay, skip); }
        const reply = await request(relay, { operation: 'poll', exclude: skip.ids });
        if (!l.current() || reply?.status !== 'ok' || !reply.packet) return;
        const packet = parseCustody(JSON.stringify(reply.packet), d.now());
        if (!packet) return;
        if (skip.ids.length < 128) skip.ids.push(packet.id);
        if (packet.kind === 'envelope') {
          if (packet.recipient !== l.owner || !d.allowed(packet.sender)) return;
          const receipt = await d.receive(packet);
          if (receipt && l.current()) await request(relay, { operation: 'receipt', packet: receipt });
        } else {
          if (packet.sender !== l.owner || !d.allowed(packet.recipient) || !await verifyCustody(packet, d.records, d.now()) || !l.current()) return;
          const saved = await d.own.get(l.owner!, packet.id);
          const e = saved?.envelope;
          if (!e || packet.digest !== custodyDigest(e) || packet.recipient !== e.recipient || packet.recipientDevice !== e.recipientDevice || packet.expires !== e.expires) return;
          if (d.confirmReceipt) {
            if (!await d.confirmReceipt(packet, l.current) || !l.current()) return;
          } else {
            const row = (await d.messages?.list(l.owner!) ?? []).find(r => r.direction === 'out' && r.id === packet.id && r.peer === packet.recipient);
            if (!row || !l.current()) return;
            await d.messages!.update(row, true, 0, l.current);
          }
          if (l.current()) await request(relay, { operation: 'consume', id: packet.id, digest: packet.digest });
        }
      } finally { polling = false; }
    },
    invalidate() { epoch++; unavailable.clear(); skips.clear(); nextPoll = 0; },
    stop() { stopped = true; epoch++; skips.clear(); },
  };
}
