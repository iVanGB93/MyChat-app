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
  let epoch = 0, stopped = false, depositing = false;
  const unavailable = new Map<string, number>();
  const polls = new Map<string, { busy: boolean; next: number }>();
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
      const l = lease(); if (!l.current()) return;
      const relays = [...new Set(d.relays())].slice(0, 10);
      for (const [peer, state] of polls) if (!state.busy && !relays.includes(peer)) polls.delete(peer);
      await Promise.all(relays.map(async relay => {
        let state = polls.get(relay);
        if (!state) { if (polls.size >= 10) return; state = { busy: false, next: 0 }; polls.set(relay, state); }
        if (state.busy || d.now() < state.next) return;
        state.busy = true; state.next = d.now() + 5000;
        try {
          let skip = skips.get(relay);
          if (!skip || skip.until <= d.now()) {
            skip = { until: d.now() + 60000, ids: [] };
            if (skips.size >= 10) skips.clear(); skips.set(relay, skip);
          }
          // Drain a bounded batch on each independent connection. A slow peer
          // must not consume the entire background recovery window.
          const pass = [...skip.ids];
          for (let count = 0; count < 4 && l.current() && pass.length < 128; count++) {
            const reply = await request(relay, { operation: 'poll', exclude: pass });
            if (!l.current() || reply?.status !== 'ok' || !reply.packet) break;
            const packet = parseCustody(JSON.stringify(reply.packet), d.now());
            if (!packet || pass.includes(packet.id)) break;
            pass.push(packet.id);
            let accepted = false;
            if (packet.kind === 'envelope') {
              if (packet.recipient !== l.owner || !d.allowed(packet.sender)) {
                skip.ids.push(packet.id); continue;
              }
              const receipt = await d.receive(packet);
              if (receipt && l.current()) accepted = (await request(relay, { operation: 'receipt', packet: receipt }))?.status === 'accepted';
            } else {
              if (packet.sender !== l.owner || !d.allowed(packet.recipient) || !await verifyCustody(packet, d.records, d.now()) || !l.current()) continue;
              const saved = await d.own.get(l.owner!, packet.id), e = saved?.envelope;
              if (!e || packet.digest !== custodyDigest(e) || packet.recipient !== e.recipient || packet.recipientDevice !== e.recipientDevice || packet.expires !== e.expires || !l.current()) continue;
              if (d.confirmReceipt) {
                if (!await d.confirmReceipt(packet, l.current) || !l.current()) continue;
              } else {
                const row = (await d.messages?.list(l.owner!) ?? []).find(r => r.direction === 'out' && r.id === packet.id && r.peer === packet.recipient);
                if (!row || !l.current()) continue;
                await d.messages!.update(row, true, 0, l.current);
              }
              if (l.current()) accepted = (await request(relay, { operation: 'consume', id: packet.id, digest: packet.digest }))?.status === 'accepted';
            }
            // Lost acknowledgements retry next pass, not a minute later. The
            // durable recipient store makes duplicate delivery idempotent.
            if (accepted && l.current()) skip.ids.push(packet.id);
          }
        } catch { /* This relay retries without blocking the other custodians. */ }
        finally { state.busy = false; }
      }));
    },
    invalidate() { epoch++; unavailable.clear(); skips.clear(); for (const state of polls.values()) state.next = 0; },
    stop() { stopped = true; epoch++; skips.clear(); },
  };
}
