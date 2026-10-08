import { custodyDigest, parseCustody, verifyCustody, CUSTODY_TTL, type CustodyEnvelope, type CustodyReceipt } from './custodyProtocol.ts';
import { validAccountId } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
export interface CustodyRow { sender: string; recipient: string; id: string; recipientDevice: string;
  expires: number; digest: string; packet: CustodyEnvelope | CustodyReceipt | null }
/** Store must serialize transactions across ALL instances sharing the same owner. Commit or throw. */
export interface CustodyStore { transaction<T>(change: (rows: CustodyRow[]) => T): Promise<T> }
export const CUSTODY_LIMIT = 128;
export function validateCustodyRows(value: unknown): asserts value is CustodyRow[] {
  if (!Array.isArray(value) || value.length > CUSTODY_LIMIT) throw Error('Invalid custody store');
  const keys = new Set<string>();
  for (const r of value) {
    if (!r || !validAccountId(r.sender) || !validAccountId(r.recipient) || r.sender === r.recipient
      || !/^[a-f0-9]{64}$/.test(r.id) || !/^[a-f0-9]{64}$/.test(r.recipientDevice) || !/^[a-f0-9]{64}$/.test(r.digest)
      || !Number.isSafeInteger(r.expires) || r.expires < CUSTODY_TTL || keys.has(r.sender + r.id)) throw Error('Invalid custody row');
    keys.add(r.sender + r.id);
    if (r.packet !== null) {
      const p = parseCustody(JSON.stringify(r.packet), r.expires - 1);
      if (!p || p.id !== r.id || p.sender !== r.sender || p.recipient !== r.recipient || p.recipientDevice !== r.recipientDevice
        || p.expires !== r.expires || (p.kind === 'envelope' ? custodyDigest(p) : p.digest) !== r.digest) throw Error('Invalid custody packet');
    }
  }
  if (JSON.stringify(value).length > 512_000) throw Error('Custody byte capacity exceeded');
}
/** Ordinary participant's bounded custody service. Authenticated caller is supplied by the Axon, never the payload.
 * No relay-to-relay deposits. Holding confirmation is NOT a delivery receipt.
 */
export function createCustodyService(d: { owner: string; store: CustodyStore; records: IdentityRecordStore; now(): number; current(): boolean; stored?(packet:CustodyEnvelope):Promise<void> }) {
  let queued = 0;
  const prune = (rows: CustodyRow[]) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].expires <= d.now()) rows.splice(i, 1); };
  async function handle(peer: string, raw: string): Promise<string> {
    if (!d.current() || !validAccountId(peer) || peer === d.owner || raw.length > 8000) return JSON.stringify({ status: 'rejected' });
    const request = JSON.parse(raw);
    let packet: CustodyEnvelope | CustodyReceipt | null = null;
    if (request.operation === 'deposit' || request.operation === 'receipt') {
      packet = parseCustody(JSON.stringify(request.packet), d.now());
      if (!packet || packet.kind !== (request.operation === 'deposit' ? 'envelope' : 'receipt')
        || peer !== (packet.kind === 'envelope' ? packet.sender : packet.recipient) || packet.sender === d.owner || packet.recipient === d.owner
        || !await verifyCustody(packet, d.records, d.now()) || !d.current()) return JSON.stringify({ status: 'rejected' });
    }
    let deposited:CustodyEnvelope|null=null;
    const result=await d.store.transaction(rows => {
      validateCustodyRows(rows); prune(rows);
      if (!d.current()) return JSON.stringify({ status: 'rejected' });
      if (packet) {
        if (packet.expires <= d.now()) return JSON.stringify({ status: 'rejected' });
        const old = rows.find(r => r.sender === packet!.sender && r.id === packet!.id);
        if (packet.kind === 'receipt') {
          if (!old || old.recipient !== packet.recipient || old.recipientDevice !== packet.recipientDevice
            || old.expires !== packet.expires || old.digest !== packet.digest) return JSON.stringify({ status: 'rejected' });
          // Replace ciphertext atomically. A consumed receipt remains only a digest tombstone.
          if (old.packet) old.packet = packet;
          return JSON.stringify({ status: 'accepted' });
        }
        const digest = custodyDigest(packet);
        if (old) return JSON.stringify({ status: old.digest === digest ? (old.packet?.kind === 'envelope' ? 'held' : 'completed') : 'rejected' });
        if (rows.length >= CUSTODY_LIMIT || rows.filter(r => r.sender === peer).length >= 16
          || rows.filter(r => r.recipient === packet!.recipient).length >= 16
          || JSON.stringify(rows).length + JSON.stringify(packet).length + 600 > 512_000) return JSON.stringify({ status: 'full' });
        rows.push({ sender: packet.sender, recipient: packet.recipient, recipientDevice: packet.recipientDevice,
          id: packet.id, expires: packet.expires, digest, packet });
        deposited=packet;
        return JSON.stringify({ status: 'held' });
      }
      if (request.operation === 'poll') {
        // One packet per response; the caller may exclude already processed IDs for this pass.
        const exclude: unknown = request.exclude ?? [];
        if (!Array.isArray(exclude) || exclude.length > 128 || !exclude.every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) return JSON.stringify({ status: 'rejected' });
        const row = rows.find(r => r.packet && !exclude.includes(r.id) && (r.packet.kind === 'envelope' ? r.recipient === peer : r.sender === peer));
        return JSON.stringify({ status: 'ok', packet: row?.packet ?? null });
      }
      if (request.operation === 'consume' && typeof request.id === 'string' && typeof request.digest === 'string') {
        const row = rows.find(r => r.sender === peer && r.id === request.id && r.digest === request.digest);
        if (!row || row.packet?.kind === 'envelope') return JSON.stringify({ status: 'rejected' });
        row.packet = null; return JSON.stringify({ status: 'accepted' });
      }
      return JSON.stringify({ status: 'rejected' });
    });
    // Notify only after durable commit. Push failure must never undo custody or imply delivery.
    if(deposited&&d.current()&&d.stored)void Promise.resolve().then(()=>d.stored!(deposited!)).catch(()=>{});
    return result;
  }
  return {
    async receive(peer: string, raw: string): Promise<string> {
      if (queued >= 16 || typeof raw !== 'string' || raw.length > 8000) return JSON.stringify({ status: 'rejected' });
      queued++;
      try { return await handle(peer, raw); } catch { return JSON.stringify({ status: 'rejected' }); } finally { queued--; }
    },
    sweep: () => d.store.transaction(rows => { validateCustodyRows(rows); prune(rows); }),
  };
}
