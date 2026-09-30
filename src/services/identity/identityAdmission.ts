import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { compareRecord, recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';

export interface IdentityRequest {
  version: 1; target: string; instance: string; operation: 'authenticate' | 'announce' | 'lookup';
  payload: string; time: number; nonce: string; record: IdentityRecord; history?: IdentityRecord[]; device: string; signature: string;
}
export interface IdentityRecordStore {
  read(account: string): Promise<IdentityRecord | null>;
  /** Atomic, bounded and durable. null means absent. Never evict a pin to admit a new identity. */
  compareAndSet(account: string, expectedDigest: string | null, next: IdentityRecord, history?: IdentityRecord[]): Promise<boolean>;
}
/** Mutual handshakes can pin the same record concurrently. A lost CAS is safe
 * only when a fresh read confirms that exact record was durably stored.
 */
export async function pinIdentityRecord(store: IdentityRecordStore, previous: IdentityRecord | null, next: IdentityRecord, history: IdentityRecord[] = []): Promise<boolean> {
  if (await store.compareAndSet(next.account, previous ? recordDigest(previous) : null, next, history)) return true;
  const latest = await store.read(next.account);
  return !!latest && recordDigest(latest) === recordDigest(next);
}
export interface AdmittedIdentityRequest {
  account: string; device: string; operation: IdentityRequest['operation']; payload: string; record: IdentityRecord;
}
const TTL = 60_000, SKEW = 30_000;
function body(r: IdentityRequest): Uint8Array {
  return utf8ToBytes(JSON.stringify(['axonic-identity-request-v1', r.version, r.target, r.instance, r.operation,
    r.payload, r.time, r.nonce, recordDigest(r.record), r.device]));
}
function shape(r: any): r is IdentityRequest {
  return !!r && r.version === 1 && validAccountId(r.target)
    && typeof r.instance === 'string' && /^[0-9a-f]{64}$/.test(r.instance)
    && ['authenticate', 'announce', 'lookup'].includes(r.operation)
    && typeof r.payload === 'string' && r.payload.length <= 4096
    && Number.isSafeInteger(r.time) && r.time >= 0
    && typeof r.nonce === 'string' && /^[0-9a-f]{64}$/.test(r.nonce)
    && typeof r.device === 'string' && /^[0-9a-f]{64}$/.test(r.device)
    && typeof r.signature === 'string' && /^[0-9a-f]{128}$/.test(r.signature);
}
export function signIdentityRequest(record: IdentityRecord, signingSeed: Uint8Array, audience: { account: string; instance: string },
  operation: IdentityRequest['operation'], payload: string, nonce: Uint8Array, now: number, history: IdentityRecord[] = []): IdentityRequest {
  if (!verifyRecord(record, now) || nonce.length !== 32) throw Error('Invalid identity request');
  const key = bytesToHex(ed25519.getPublicKey(signingSeed)), device = record.devices.find(d => d.signing === key);
  if (!device) throw Error('Device is not authorized');
  const request: IdentityRequest = { version: 1, record: JSON.parse(JSON.stringify(record)), ...(history.length ? { history: JSON.parse(JSON.stringify(history)) } : {}), target: audience.account, instance: audience.instance,
    operation, payload, time: now, nonce: bytesToHex(nonce), device: device.id, signature: '00'.repeat(64) };
  if (!shape(request)) throw Error('Invalid identity request');
  request.signature = bytesToHex(ed25519.sign(body(request), signingSeed)); return request;
}
/** Shared admission for every neuron; proves key ownership, not permission to read others' data.
 * Callers must additionally enforce source/global traffic limits and operation-specific policy.
 * This is NOT a reusable bearer session. The returned operation and payload alone are authorized.
 */
export function createIdentityAdmission(d: { account: string; instance: Uint8Array; store: IdentityRecordStore; now(): number; current(): boolean }) {
  if (!validAccountId(d.account)) throw Error('Invalid local identity');
  // Caller supplies a new cryptographically random instance on every runtime start.
  // Old requests cannot replay after restart, even if their timestamp was in the future.
  if (d.instance.length !== 32) throw Error('Secure instance nonce required');
  const instance = bytesToHex(d.instance);
  const seen = new Map<string, number>();
  let inFlight = 0;
  return {
    audience: () => ({ account: d.account, instance }),
    async accept(raw: string): Promise<AdmittedIdentityRequest | null> {
      if (!d.current() || typeof raw !== 'string' || raw.length > 16_000 || inFlight >= 16) return null;
      inFlight++;
      try {
        const now = d.now();
        for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
        const r = JSON.parse(raw) as IdentityRequest;
        if (!shape(r) || r.target !== d.account || r.instance !== instance || r.time > now + SKEW
          || r.time + TTL <= now || !verifyRecord(r.record, now)) return null;
        const device = r.record.devices.find(p => p.id === r.device);
        if (!device || !ed25519.verify(hexToBytes(r.signature), body(r), hexToBytes(device.signing), { zip215: false })) return null;
        const replay = `${r.record.account}:${r.device}:${r.nonce}`;
        if (seen.has(replay) || seen.size >= 1024) return null;
        // Reserve synchronously before any await so concurrent copies cannot both pass.
        // On persistence failure, retry with a fresh signed request, never the same nonce.
        seen.set(replay, r.time + TTL);
        const previous = await d.store.read(r.record.account);
        if (!d.current() || compareRecord(r.record, previous, d.now(), r.history) !== 'accept') return null;
        if (!await pinIdentityRecord(d.store, previous, r.record, r.history)) return null;
        if (!d.current() || r.time + TTL <= d.now() || !verifyRecord(r.record, d.now())) return null;
        return { account: r.record.account, device: device.id, operation: r.operation, payload: r.payload, record: r.record };
      } catch { return null; }
      finally { inFlight--; }
    },
  };
}
