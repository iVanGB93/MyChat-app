import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { verifyPublicSignature, recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';

export type CallMediaData = { type: 'offer' | 'answer'; sdp: string }
  | { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
export interface CallMediaSignal {
  version: 1; record: IdentityRecord; device: string;
  callId: string; invitation: string; acceptance: string;
  target: string; targetDevice: string; sourceInstance: string; targetInstance: string;
  sequence: number; issuedAt: number; expiresAt: number;
  kind: 'offer' | 'answer' | 'ice-candidate'; data: CallMediaData; signature: string;
}
export const CALL_MEDIA_MAX_BYTES = 12000;
const hex = (v: unknown, n: number) => typeof v === 'string' && v.length === n && /^[0-9a-f]+$/.test(v);
function dataBody(e: CallMediaSignal): unknown[] | null {
  const d = e.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (e.kind === 'offer' || e.kind === 'answer') {
    if (!('type' in d) || d.type !== e.kind || typeof d.sdp !== 'string' || !d.sdp.length
      || utf8ToBytes(d.sdp).length > 9000 || Object.keys(d).some(k => !['type', 'sdp'].includes(k))) return null;
    return [d.type, d.sdp];
  }
  if (e.kind !== 'ice-candidate' || !('candidate' in d) || typeof d.candidate !== 'string'
    || !d.candidate.length || utf8ToBytes(d.candidate).length > 2048
    || !(d.sdpMid === null || typeof d.sdpMid === 'string' && d.sdpMid.length <= 256)
    || !(d.sdpMLineIndex === null || Number.isSafeInteger(d.sdpMLineIndex) && d.sdpMLineIndex >= 0 && d.sdpMLineIndex <= 255)
    || Object.keys(d).some(k => !['candidate', 'sdpMid', 'sdpMLineIndex'].includes(k))) return null;
  return [d.candidate, d.sdpMid, d.sdpMLineIndex];
}
const body = (e: CallMediaSignal) => utf8ToBytes(JSON.stringify(['axonic-call-media-v1', e.version,
  recordDigest(e.record), e.device, e.callId, e.invitation, e.acceptance, e.target, e.targetDevice,
  e.sourceInstance, e.targetInstance, e.sequence, e.issuedAt, e.expiresAt, e.kind, dataBody(e)]));

/** Ephemeral signaling only. Admission additionally requires the durable selected-call state. */
export function verifyCallMediaSignal(raw: string, pinned: IdentityRecord, now: number): CallMediaSignal | null {
  try {
    if (typeof raw !== 'string' || utf8ToBytes(raw).length > CALL_MEDIA_MAX_BYTES
      || !Number.isSafeInteger(now) || now < 0) return null;
    const e: CallMediaSignal = JSON.parse(raw);
    if (e.version !== 1 || !verifyRecord(pinned, now) || !verifyRecord(e.record, now)
      || recordDigest(pinned) !== recordDigest(e.record)
      || !hex(e.callId, 64) || !hex(e.invitation, 64) || !hex(e.acceptance, 64)
      || !validAccountId(e.target) || e.target === e.record.account || !hex(e.targetDevice, 64)
      || !hex(e.sourceInstance, 64) || !hex(e.targetInstance, 64)
      || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || e.sequence > 256
      || !Number.isSafeInteger(e.issuedAt) || e.issuedAt < 0 || e.issuedAt > now + 5000
      || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= now || e.expiresAt <= e.issuedAt
      || e.expiresAt - e.issuedAt > 30000 || e.expiresAt > e.record.expiresAt
      || !hex(e.signature, 128) || !dataBody(e)) return null;
    const device = pinned.devices.find(d => d.id === e.device);
    return device && verifyPublicSignature(hexToBytes(e.signature), body(e), hexToBytes(device.signing), { zip215: false }) ? e : null;
  } catch { return null; }
}
export function signCallMediaSignal(input: Omit<CallMediaSignal, 'version' | 'device' | 'signature'>,
  seed: Uint8Array, now: number): string {
  const device = input.record.devices.find(d => d.signing === bytesToHex(ed25519.getPublicKey(seed)));
  if (!device) throw Error('Unauthorized media signer');
  const e: CallMediaSignal = { ...input, version: 1, device: device.id, signature: '' };
  e.signature = bytesToHex(ed25519.sign(body(e), seed));
  const raw = JSON.stringify(e);
  if (!verifyCallMediaSignal(raw, input.record, now)) throw Error('Invalid media signal');
  return raw;
}
