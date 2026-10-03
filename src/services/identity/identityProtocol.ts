/** Experimental portable identity protocol. No server, platform, or legacy user IDs. */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const RECORD_LIFETIME = 30 * 24 * 60 * 60 * 1000;
export const CHALLENGE_LIFETIME = 60_000;
/** Cache only the cryptographic result for exact signed bytes, never identity policy.
 * Expiry, revocation, replay and target checks must still run at every admission.
 * Bounded and memory-only; negative results never occupy the cache. */
const signatureCache = new Set<string>();
export function verifyPublicSignature(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array, _options: {zip215:false}) {
  if(signature.length!==64||publicKey.length!==32)return false;
  const key=bytesToHex(publicKey)+bytesToHex(signature)+bytesToHex(sha256(message));
  if(signatureCache.has(key))return true;
  if(!ed25519.verify(signature,message,publicKey,{zip215:false}))return false;
  if(signatureCache.size>=256)signatureCache.delete(signatureCache.values().next().value!);
  signatureCache.add(key);return true;
}

export interface IdentityDevice { id: string; signing: string; encryption: string }
export interface IdentityRecord {
  version: 1; account: string; root: string; revision: number;
  previous: string | null; issuedAt: number; expiresAt: number;
  devices: IdentityDevice[]; signature: string;
}
export interface IdentityChallenge {
  version: 1; verifier: string; nonce: string; issuedAt: number; expiresAt: number;
}
export interface IdentityProof {
  version: 1; record: IdentityRecord; device: string; challenge: IdentityChallenge; signature: string;
}
const hex = (v: unknown, n: number): v is string => typeof v === 'string' && v.length === n * 2 && /^[0-9a-f]+$/.test(v);
export const validAccountId = (v: unknown): v is string => typeof v === 'string' && /^axonic:1:[0-9a-f]{64}$/.test(v);
const time = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const wire = (v: unknown[]) => utf8ToBytes(JSON.stringify(v));
const hash = (v: unknown[]) => bytesToHex(sha256(wire(v)));
export function accountId(root: string): string {
  if (!hex(root, 32)) throw Error('Invalid identity public key');
  return `axonic:1:${hash(['axonic-account-v1', root])}`;
}
export function deviceId(signing: string, encryption: string): string {
  if (!hex(signing, 32) || !hex(encryption, 32)) throw Error('Invalid device keys');
  return hash(['axonic-device-v1', signing, encryption]);
}
export function publicDevice(signingSeed: Uint8Array, encryptionSeed: Uint8Array): IdentityDevice {
  const signing = bytesToHex(ed25519.getPublicKey(signingSeed));
  const encryption = bytesToHex(x25519.getPublicKey(encryptionSeed));
  return { id: deviceId(signing, encryption), signing, encryption };
}
function recordBody(r: IdentityRecord): Uint8Array {
  return wire(['axonic-identity-record-v1', r.version, r.account, r.root, r.revision,
    r.previous, r.issuedAt, r.expiresAt, r.devices.map(d => [d.id, d.signing, d.encryption])]);
}
export function recordDigest(r: IdentityRecord): string { return bytesToHex(sha256(recordBody(r))); }
function validRecordShape(r: any): r is IdentityRecord {
  return !!r && r.version === 1 && hex(r.root, 32) && r.account === accountId(r.root)
    && time(r.revision) && (r.revision === 0 ? r.previous === null : hex(r.previous, 32))
    && time(r.issuedAt) && time(r.expiresAt) && r.expiresAt > r.issuedAt
    && r.expiresAt - r.issuedAt <= RECORD_LIFETIME && hex(r.signature, 64)
    && Array.isArray(r.devices) && r.devices.length >= 1 && r.devices.length <= 8
    && r.devices.every((d: any, i: number) => d && hex(d.signing, 32) && hex(d.encryption, 32)
      && d.id === deviceId(d.signing, d.encryption) && (i === 0 || r.devices[i - 1].id < d.id));
}
export function verifyRecord(record: unknown, now: number, allowExpired = false): record is IdentityRecord {
  try {
    return time(now) && validRecordShape(record) && record.issuedAt <= now + 30_000
      && (allowExpired || record.expiresAt > now)
      && verifyPublicSignature(hexToBytes(record.signature), recordBody(record), hexToBytes(record.root), { zip215: false });
  } catch { return false; }
}
export function issueRecord(rootSeed: Uint8Array, devices: IdentityDevice[], now: number, previous?: IdentityRecord): IdentityRecord {
  const root = bytesToHex(ed25519.getPublicKey(rootSeed));
  if (previous && (!verifyRecord(previous, now, true) || previous.root !== root)) throw Error('Invalid previous identity record');
  const record: IdentityRecord = { version: 1, account: accountId(root), root,
    revision: previous ? previous.revision + 1 : 0, previous: previous ? recordDigest(previous) : null,
    issuedAt: now, expiresAt: now + RECORD_LIFETIME,
    devices: devices.map(d => ({ ...d })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), signature: '00'.repeat(64) };
  if (!validRecordShape(record)) throw Error('Invalid identity record');
  record.signature = bytesToHex(ed25519.sign(recordBody(record), rootSeed));
  return record;
}
function challengeBody(c: IdentityChallenge): unknown[] {
  return [c.version, c.verifier, c.nonce, c.issuedAt, c.expiresAt];
}
function validChallenge(c: any, now: number): c is IdentityChallenge {
  return !!c && c.version === 1 && validAccountId(c.verifier) && hex(c.nonce, 32)
    && time(c.issuedAt) && time(c.expiresAt) && c.issuedAt <= now + 30_000
    && c.expiresAt > now && c.expiresAt > c.issuedAt && c.expiresAt - c.issuedAt <= CHALLENGE_LIFETIME;
}
function proofBody(record: IdentityRecord, device: string, challenge: IdentityChallenge): Uint8Array {
  return wire(['axonic-auth-proof-v1', recordDigest(record), device, ...challengeBody(challenge)]);
}
export function proveIdentity(record: IdentityRecord, device: IdentityDevice, signingSeed: Uint8Array,
  challenge: IdentityChallenge, expectedVerifier: string, now: number): IdentityProof {
  if (!verifyRecord(record, now) || !validChallenge(challenge, now) || challenge.verifier !== expectedVerifier
    || !record.devices.some(d => d.id === device.id && d.signing === bytesToHex(ed25519.getPublicKey(signingSeed)))) {
    throw Error('Invalid authentication request');
  }
  return { version: 1, record, device: device.id, challenge,
    signature: bytesToHex(ed25519.sign(proofBody(record, device.id, challenge), signingSeed)) };
}
export const RENEW_BEFORE = 7 * 24 * 60 * 60 * 1000;
export const HISTORY_BYTES = 8000, HISTORY_RECORDS = 8;
/** Root-signed contiguous predecessors. Expired historical records prove ancestry, not admission. */
export function validRecordHistory(history: unknown, next: IdentityRecord, now: number): history is IdentityRecord[] {
  if (!Array.isArray(history) || history.length > HISTORY_RECORDS
    || new TextEncoder().encode(JSON.stringify(history)).length > HISTORY_BYTES) return false;
  let last: IdentityRecord | undefined;
  for (const record of [...history, next]) {
    if (!verifyRecord(record, now, true) || record.account !== next.account) return false;
    if (last && (record.revision !== last.revision + 1 || record.previous !== recordDigest(last)
      || record.issuedAt < last.issuedAt)) return false;
    last = record;
  }
  return true;
}
export function renewIdentityRecord(rootSeed: Uint8Array, record: IdentityRecord, history: IdentityRecord[], now: number) {
  if (!validRecordHistory(history, record, now)) throw Error('Invalid identity history');
  if (record.expiresAt - now > RENEW_BEFORE) return null;
  const next = issueRecord(rootSeed, record.devices, now, record);
  const retained = [...history, record];
  while (retained.length > HISTORY_RECORDS || new TextEncoder().encode(JSON.stringify(retained)).length > HISTORY_BYTES) retained.shift();
  return { record: next, history: retained };
}
export type RecordDecision = 'accept' | 'stale' | 'conflict' | 'missing-history' | 'invalid';
/** Persist accepted records atomically before granting a session. No global freshness claim. */
export function compareRecord(next: IdentityRecord, previous: IdentityRecord | null, now: number, history: IdentityRecord[] = []): RecordDecision {
  if (!verifyRecord(next, now) || (previous && (!verifyRecord(previous, now, true) || next.account !== previous.account))) return 'invalid';
  if (!validRecordHistory(history, next, now)) return 'invalid';
  if (!previous) return 'accept';
  if (next.revision < previous.revision) return 'stale';
  if (next.revision === previous.revision) return recordDigest(next) === recordDigest(previous) ? 'accept' : 'conflict';
  if (next.revision !== previous.revision + 1) {
    const anchor = history.find(r => r.revision === previous.revision);
    return !anchor ? 'missing-history' : recordDigest(anchor) !== recordDigest(previous) ? 'conflict' : 'accept';
  }
  return next.previous === recordDigest(previous) && next.issuedAt >= previous.issuedAt ? 'accept' : 'conflict';
}
/** Every participant uses this verifier. Admission/storage limits are an additional layer. */
export function createIdentityVerifier(verifier: string, random: (size: number) => Uint8Array, now: () => number) {
  if (!validAccountId(verifier)) throw Error('Invalid verifier identity');
  const pending = new Map<string, IdentityChallenge>();
  const prune = () => { for (const [key, c] of pending) if (c.expiresAt <= now()) pending.delete(key); };
  return {
    challenge(): IdentityChallenge {
      prune();
      if (pending.size >= 256) throw Error('Authentication capacity reached');
      const bytes = random(32);
      if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw Error('Secure randomness unavailable');
      const nonce = bytesToHex(bytes), issuedAt = now();
      if (pending.has(nonce) || !time(issuedAt)) throw Error('Invalid authentication nonce');
      const c: IdentityChallenge = { version: 1, verifier, nonce, issuedAt, expiresAt: issuedAt + CHALLENGE_LIFETIME };
      pending.set(nonce, c); return { ...c };
    },
    verify(raw: string, previous: IdentityRecord | null): IdentityRecord | null {
      prune();
      if (typeof raw !== 'string' || raw.length > 12_000) return null;
      try {
        const p = JSON.parse(raw) as IdentityProof, c = p?.challenge;
        if (!validChallenge(c, now()) || c.verifier !== verifier) return null;
        const issued = pending.get(c.nonce);
        if (!issued || JSON.stringify(challengeBody(issued)) !== JSON.stringify(challengeBody(c))) return null;
        // A presented challenge is single-use even when the proof fails.
        pending.delete(c.nonce);
        if (p.version !== 1 || !hex(p.signature, 64) || compareRecord(p.record, previous, now()) !== 'accept') return null;
        const device = p.record.devices.find(d => d.id === p.device);
        if (!device || !verifyPublicSignature(hexToBytes(p.signature), proofBody(p.record, p.device, c),
          hexToBytes(device.signing), { zip215: false })) return null;
        return p.record;
      } catch { return null; }
    },
    clear() { pending.clear(); },
  };
}
