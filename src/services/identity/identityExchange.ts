import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { compareRecord, recordDigest, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
import { createIdentityAdmission, type IdentityRecordStore, type IdentityRequest } from './identityAdmission.ts';

export interface IdentityDescriptor {
  version: 1; nonce: string; instance: string; record: IdentityRecord; history?: IdentityRecord[]; device: string;
  issuedAt: number; expiresAt: number; signature: string;
}
interface IdentityResponse {
  version: 1; request: string; instance: string; issuer: string; device: string;
  account: string; requester: string; issuedAt: number; expiresAt: number; signature: string;
}
const wire = (v: unknown[]) => utf8ToBytes(JSON.stringify(v));
const digest = (raw: string) => bytesToHex(sha256(utf8ToBytes(raw)));
const hex = (v: unknown, length: number): v is string => typeof v === 'string' && v.length === length * 2 && /^[0-9a-f]+$/.test(v);
const fresh = (v: { issuedAt: number; expiresAt: number }, now: number) => Number.isSafeInteger(v.issuedAt)
  && Number.isSafeInteger(v.expiresAt) && v.issuedAt >= 0 && v.issuedAt <= now + 30_000
  && v.expiresAt > now && v.expiresAt > v.issuedAt && v.expiresAt - v.issuedAt <= 60_000;
const descriptorBody = (v: IdentityDescriptor) => wire(['axonic-identity-descriptor-v1', v.version, v.nonce,
  v.instance, recordDigest(v.record), v.device, v.issuedAt, v.expiresAt]);
const responseBody = (v: IdentityResponse) => wire(['axonic-identity-response-v1', v.version, v.request,
  v.instance, v.issuer, v.device, v.account, v.requester, v.issuedAt, v.expiresAt]);
function authorizedKey(record: IdentityRecord, signingSeed: Uint8Array): string {
  const key = bytesToHex(ed25519.getPublicKey(signingSeed));
  const device = record.devices.find(d => d.signing === key);
  if (!device) throw Error('Local device is not authorized');
  return device.id;
}
/** Same service for phones and hosted apps. It only authenticates; no chat access is granted. */
export function createIdentityExchange(d: { record: IdentityRecord; history?: IdentityRecord[]; signingSeed: Uint8Array; instance: Uint8Array;
  store: IdentityRecordStore; now(): number; current(): boolean }) {
  if (!verifyRecord(d.record, d.now())) throw Error('Invalid local identity record');
  const record: IdentityRecord = JSON.parse(JSON.stringify(d.record));
  const device = authorizedKey(record, d.signingSeed);
  const admission = createIdentityAdmission({ account: record.account, instance: d.instance, store: d.store, now: d.now, current: d.current });
  return {
    describe(nonce: string): string | null {
      if (!d.current() || !hex(nonce, 32) || !verifyRecord(record, d.now())) return null;
      const now = d.now();
      const result: IdentityDescriptor = { version: 1, nonce, instance: admission.audience().instance,
        record, ...(d.history?.length ? { history: d.history } : {}), device, issuedAt: now, expiresAt: Math.min(now + 60_000, record.expiresAt), signature: '' };
      result.signature = bytesToHex(ed25519.sign(descriptorBody(result), d.signingSeed));
      return JSON.stringify(result);
    },
    async authenticate(raw: string): Promise<string | null> {
      if (!d.current() || typeof raw !== 'string' || raw.length > 16_000 || !verifyRecord(record, d.now())) return null;
      // Only this operation is implemented. Other actions cannot use this endpoint
      // as a generic signature oracle or silently acquire application privileges.
      let request: IdentityRequest;
      try { request = JSON.parse(raw); } catch { return null; }
      if (request?.operation !== 'authenticate' || request.payload !== '') return null;
      const accepted = await admission.accept(raw);
      if (!accepted || !d.current() || !verifyRecord(record, d.now())) return null;
      const now = d.now();
      const result: IdentityResponse = { version: 1, request: digest(raw), instance: admission.audience().instance,
        issuer: record.account, device, account: accepted.account, requester: accepted.device,
        issuedAt: now, expiresAt: Math.min(now + 60_000, record.expiresAt), signature: '' };
      result.signature = bytesToHex(ed25519.sign(responseBody(result), d.signingSeed));
      return JSON.stringify(result);
    },
  };
}
/** Callers persist this public record atomically before trusting subsequent responses. */
export function verifyIdentityDescriptor(raw: string, expectedAccount: string, nonce: string,
  previous: IdentityRecord | null, now: number): IdentityDescriptor | null {
  try {
    if (typeof raw !== 'string' || raw.length > 12_000 || !hex(nonce, 32)) return null;
    const r = JSON.parse(raw) as IdentityDescriptor;
    if (r.version !== 1 || r.nonce !== nonce || !hex(r.instance, 32) || !hex(r.signature, 64)
      || !fresh(r, now) || !verifyRecord(r.record, now) || r.record.account !== expectedAccount
      || compareRecord(r.record, previous, now, r.history) !== 'accept') return null;
    const device = r.record.devices.find(d => d.id === r.device);
    return device && ed25519.verify(hexToBytes(r.signature), descriptorBody(r), hexToBytes(device.signing), { zip215: false }) ? r : null;
  } catch { return null; }
}
/** Verify against a previously verified descriptor and the exact outstanding request. */
export function verifyIdentityResponse(raw: string, requestRaw: string, descriptor: IdentityDescriptor, now: number): boolean {
  try {
    if (typeof raw !== 'string' || raw.length > 2048 || typeof requestRaw !== 'string' || requestRaw.length > 16_000
      || !verifyIdentityDescriptor(JSON.stringify(descriptor), descriptor.record.account, descriptor.nonce, null, now)) return false;
    const r = JSON.parse(raw) as IdentityResponse, request = JSON.parse(requestRaw) as IdentityRequest;
    if (r.version !== 1 || !fresh(r, now) || !hex(r.signature, 64) || r.request !== digest(requestRaw)
      || r.instance !== descriptor.instance || r.issuer !== descriptor.record.account || r.device !== descriptor.device
      || request.target !== r.issuer || request.instance !== r.instance || request.operation !== 'authenticate' || request.payload !== ''
      || r.account !== request.record.account || r.requester !== request.device) return false;
    const key = descriptor.record.devices.find(d => d.id === descriptor.device)!.signing;
    return ed25519.verify(hexToBytes(r.signature), responseBody(r), hexToBytes(key), { zip215: false });
  } catch { return false; }
}
