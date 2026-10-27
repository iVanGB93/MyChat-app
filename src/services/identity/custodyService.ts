import type {CustodyRow,CustodyStore,CustodyLimits} from './relayStorage.ts';
export type {CustodyRow,CustodyStore,CustodyLimits} from './relayStorage.ts';
import { custodyDigest, parseCustody, verifyCustody, CUSTODY_TTL, type CustodyEnvelope, type CustodyReceipt } from './custodyProtocol.ts';
import { validAccountId } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
/** Optional immutable read path; mutation and acknowledgement still use transactions. */
export function readCustodyStore<T>(store:CustodyStore,inspect:(rows:readonly CustodyRow[])=>T):Promise<T>{return store.read?store.read(inspect):store.transaction(inspect);}
export const CUSTODY_LIMIT = 128;

export const DEFAULT_CUSTODY_LIMITS: CustodyLimits = {live:128,rows:1024,bytes:1_024_000,perSender:16,perRecipient:16};
// Exact normalized envelope bytes only. This saves repeated hashing of unchanged
// stored ciphertext, not admission checks: parsing, row bindings, limits and
// signature verification still run where they did before. At most ~896 KB of keys.
const storedDigests = new Map<string,string>();
// Cache only successfully validated, exact serialized rows. Changed ciphertext,
// bindings or receipts always miss. Duplicate/aggregate capacity checks still run.
const validatedRows=new Map<string,number>();
let validatedRowBytes=0;
const VALIDATED_ROW_BYTES=8*1024*1024;
function storedEnvelopeDigest(packet:CustodyEnvelope){
  const bytes=JSON.stringify(packet),cached=storedDigests.get(bytes);
  if(cached!==undefined)return cached;
  const digest=custodyDigest(packet);
  if(storedDigests.size>=128)storedDigests.delete(storedDigests.keys().next().value!);
  storedDigests.set(bytes,digest);return digest;
}
export function validateCustodyRows(value: unknown, limits: CustodyLimits = DEFAULT_CUSTODY_LIMITS): asserts value is CustodyRow[] {
  if (!Array.isArray(value) || value.length > limits.rows) throw Error('Invalid custody store');
  const keys = new Set<string>();
  for (const r of value) {
    const serialized=JSON.stringify(r);
    if(validatedRows.has(serialized)){
      if(keys.has(r.sender+r.id))throw Error('Invalid custody row');
      keys.add(r.sender+r.id);continue;
    }
    if (!r || !validAccountId(r.sender) || !validAccountId(r.recipient) || r.sender === r.recipient
      || !/^[a-f0-9]{64}$/.test(r.id) || !/^[a-f0-9]{64}$/.test(r.recipientDevice) || !/^[a-f0-9]{64}$/.test(r.digest)
      || !Number.isSafeInteger(r.expires) || r.expires < CUSTODY_TTL || keys.has(r.sender + r.id)) throw Error('Invalid custody row');
    keys.add(r.sender + r.id);
    if (r.packet !== null) {
      const p = parseCustody(JSON.stringify(r.packet), r.expires - 1);
      if (!p || p.id !== r.id || p.sender !== r.sender || p.recipient !== r.recipient || p.recipientDevice !== r.recipientDevice
        || p.expires !== r.expires || (p.kind === 'envelope' ? storedEnvelopeDigest(p) : p.digest) !== r.digest) throw Error('Invalid custody packet');
    }
    const cost=serialized.length*2;
    if(cost<=VALIDATED_ROW_BYTES){
      while(validatedRows.size>=4096||validatedRowBytes+cost>VALIDATED_ROW_BYTES){const first=validatedRows.keys().next().value!;validatedRowBytes-=validatedRows.get(first)!;validatedRows.delete(first);}
      validatedRows.set(serialized,cost);validatedRowBytes+=cost;
    }
  }
  if (JSON.stringify(value).length > limits.bytes) throw Error('Custody byte capacity exceeded');
}
/** Ordinary participant's bounded custody service. Authenticated caller is supplied by the Axon, never the payload.
 * No relay-to-relay deposits. Holding confirmation is NOT a delivery receipt.
 */
export function createCustodyService(d: { owner: string; store: CustodyStore; records: IdentityRecordStore; now(): number; current(): boolean; stored?(packet:CustodyEnvelope):Promise<void>;
  receiveOwn?(packet:CustodyEnvelope,relay:string):Promise<CustodyReceipt|null>;
  changed?(peer:string):void;
}) {
  const limits = d.store.limits ?? DEFAULT_CUSTODY_LIMITS;
  let queued = 0;
  const prune = (rows: CustodyRow[]) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].expires <= d.now()) rows.splice(i, 1); };
  async function handle(peer: string, raw: string): Promise<string> {
    if (!d.current() || !validAccountId(peer) || peer === d.owner || raw.length > 8000) return JSON.stringify({ status: 'rejected' });
    const request = JSON.parse(raw);
    // A delivery terminates at its addressed recipient. It can never become
    // another deposit, so even an authenticated relay cannot extend the route.
    if(request.operation==='deliver'){
      const envelope=parseCustody(JSON.stringify(request.packet),d.now());
      if(!envelope||envelope.kind!=='envelope'||envelope.recipient!==d.owner||!d.receiveOwn
        ||!await verifyCustody(envelope,d.records,d.now())||!d.current())return JSON.stringify({status:'rejected'});
      const receipt=await d.receiveOwn(envelope,peer);
      return JSON.stringify(receipt&&d.current()?{status:'delivered',packet:receipt}:{status:'rejected'});
    }
    let packet: CustodyEnvelope | CustodyReceipt | null = null;
    if (request.operation === 'deposit' || request.operation === 'receipt') {
      packet = parseCustody(JSON.stringify(request.packet), d.now());
      if (!packet || packet.kind !== (request.operation === 'deposit' ? 'envelope' : 'receipt')
        || peer !== (packet.kind === 'envelope' ? packet.sender : packet.recipient) || packet.sender === d.owner || packet.recipient === d.owner
        || !await verifyCustody(packet, d.records, d.now()) || !d.current()) return JSON.stringify({ status: 'rejected' });
    }
    // Polls do not mutate custody. Indexed hosts can reuse validated immutable
    // rows; expired rows are hidden here and reclaimed by the ordinary sweep.
    if(request.operation==='poll'&&d.store.read){
      const exclude:unknown=request.exclude??[];
      if(!Array.isArray(exclude)||exclude.length>128||!exclude.every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))return JSON.stringify({status:'rejected'});
      return d.store.read(rows=>{
        validateCustodyRows(rows,limits);
        if(!d.current())return JSON.stringify({status:'rejected'});
        const row=rows.find(r=>r.expires>d.now()&&r.packet&&!exclude.includes(r.id)&&(r.packet.kind==='envelope'?r.recipient===peer:r.sender===peer));
        return JSON.stringify({status:'ok',packet:row?.packet??null});
      });
    }
    let deposited:CustodyEnvelope|null=null,changed:string|null=null;
    const result=await d.store.transaction(rows => {
      validateCustodyRows(rows, limits); prune(rows);
      if (!d.current()) return JSON.stringify({ status: 'rejected' });
      if (packet) {
        if (packet.expires <= d.now()) return JSON.stringify({ status: 'rejected' });
        const old = rows.find(r => r.sender === packet!.sender && r.id === packet!.id);
        if (packet.kind === 'receipt') {
          if (!old || old.recipient !== packet.recipient || old.recipientDevice !== packet.recipientDevice
            || old.expires !== packet.expires || old.digest !== packet.digest) return JSON.stringify({ status: 'rejected' });
          // Replace ciphertext atomically. A consumed receipt remains only a digest tombstone.
          if (old.packet) {if(old.packet.kind==='envelope')changed=packet.sender;old.packet = packet;}
          return JSON.stringify({ status: 'accepted' });
        }
        const digest = custodyDigest(packet);
        if (old) return JSON.stringify({ status: old.digest === digest ? (old.packet?.kind === 'envelope' ? 'held' : 'completed') : 'rejected' });
        // Consumed receipts retain replay protection, but no longer occupy a live mailbox slot.
        if (rows.length >= limits.rows || rows.filter(r => r.packet !== null).length >= limits.live || rows.filter(r => r.packet !== null && r.sender === peer).length >= limits.perSender
          || rows.filter(r => r.packet !== null && r.recipient === packet!.recipient).length >= limits.perRecipient
          || JSON.stringify(rows).length + JSON.stringify(packet).length + 600 > limits.bytes) return JSON.stringify({ status: 'full' });
        rows.push({ sender: packet.sender, recipient: packet.recipient, recipientDevice: packet.recipientDevice,
          id: packet.id, expires: packet.expires, digest, packet });
        deposited=packet;
        changed=packet.recipient;
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
    if(changed&&d.current())try{d.changed?.(changed);}catch{/* The committed row is recovered on reconnect. */}
    return result;
  }
  return {
    /** Only the existing authenticated recipient connection is eligible. */
    async deliverDirect(packet:CustodyEnvelope,request:(recipient:string,raw:string)=>Promise<string|null>):Promise<boolean>{
      if(!d.current()||packet.expires<=d.now())return false;
      try{
        const response=JSON.parse(await request(packet.recipient,JSON.stringify({operation:'deliver',packet}))??'{}');
        const receipt=parseCustody(JSON.stringify(response.packet),d.now());
        if(response.status!=='delivered'||receipt?.kind!=='receipt'||receipt.id!==packet.id
          ||receipt.sender!==packet.sender||receipt.recipient!==packet.recipient||receipt.digest!==custodyDigest(packet))return false;
        // The ordinary receipt handler verifies signatures, device/expiry and
        // durable row bindings before removing ciphertext.
        return JSON.parse(await handle(packet.recipient,JSON.stringify({operation:'receipt',packet:receipt}))).status==='accepted';
      }catch{return false;}
    },
    async receive(peer: string, raw: string): Promise<string> {
      if (queued >= 16 || typeof raw !== 'string' || raw.length > 8000) return JSON.stringify({ status: 'rejected' });
      queued++;
      try { return await handle(peer, raw); } catch { return JSON.stringify({ status: 'rejected' }); } finally { queued--; }
    },
    sweep: () => d.store.transaction(rows => { validateCustodyRows(rows, limits); prune(rows); }),
  };
}
