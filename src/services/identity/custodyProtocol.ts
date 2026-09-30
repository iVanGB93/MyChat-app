/** Experimental offline envelope. Separate from connection-bound direct test packets. */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { publicDevice, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
export const CUSTODY_TTL = 24 * 60 * 60 * 1000;
export interface CustodyEnvelope {
  version: 1; kind: 'envelope'; id: string; sender: string; senderDevice: string;
  recipient: string; recipientDevice: string; created: number; expires: number;
  ephemeral: string; nonce: string; ciphertext: string; signature: string;
}
export interface CustodyReceipt {
  version: 1; kind: 'receipt'; id: string; sender: string; recipient: string;
  recipientDevice: string; expires: number; digest: string; signature: string;
}
const hex = (v: unknown, n: number): v is string => typeof v === 'string' && v.length === n * 2 && /^[a-f0-9]+$/.test(v);
const bytes = (v: unknown[]) => utf8ToBytes(JSON.stringify(v));
const header = (e: CustodyEnvelope) => ['axonic-custody-envelope-v1', e.id, e.sender, e.senderDevice,
  e.recipient, e.recipientDevice, e.created, e.expires, e.ephemeral, e.nonce];
const signedEnvelope = (e: CustodyEnvelope) => bytes([...header(e), e.ciphertext]);
const signedReceipt = (r: CustodyReceipt) => bytes(['axonic-custody-receipt-v1', r.id, r.sender, r.recipient, r.recipientDevice, r.expires, r.digest]);
export const custodyDigest = (e: CustodyEnvelope) => bytesToHex(sha256(bytes([bytesToHex(signedEnvelope(e)), e.signature])));
export function parseCustody(raw: string, now: number): CustodyEnvelope | CustodyReceipt | null {
  if (typeof raw !== 'string' || raw.length > 7000 || !Number.isSafeInteger(now) || now < 0) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || p.version !== 1 || !hex(p.id, 32) || !validAccountId(p.sender) || !validAccountId(p.recipient)
      || p.sender === p.recipient || !hex(p.recipientDevice, 32) || !hex(p.signature, 64)
      || !Number.isSafeInteger(p.expires) || p.expires <= now || p.expires > now + CUSTODY_TTL) return null;
    if (p.kind === 'envelope' && hex(p.senderDevice, 32) && hex(p.ephemeral, 32) && hex(p.nonce, 24)
      && typeof p.ciphertext === 'string' && p.ciphertext.length >= 34 && p.ciphertext.length <= 4128 && /^(?:[a-f0-9]{2})+$/.test(p.ciphertext)
      && Number.isSafeInteger(p.created) && p.created >= 0 && p.created <= now + 30000 && p.expires > p.created && p.expires - p.created <= CUSTODY_TTL) {
      const { version, kind, id, sender, senderDevice, recipient, recipientDevice, created, expires, ephemeral, nonce, ciphertext, signature } = p;
      return { version, kind, id, sender, senderDevice, recipient, recipientDevice, created, expires, ephemeral, nonce, ciphertext, signature };
    }
    if (p.kind === 'receipt' && hex(p.digest, 32)) {
      const { version, kind, id, sender, recipient, recipientDevice, expires, digest, signature } = p;
      return { version, kind, id, sender, recipient, recipientDevice, expires, digest, signature };
    }
  } catch { /* Malformed packets are not admission requests. */ }
  return null;
}
export async function verifyCustody(p: CustodyEnvelope | CustodyReceipt, records: IdentityRecordStore, now: number) {
  try {
    if (!parseCustody(JSON.stringify(p), now)) return false;
    const signer = await records.read(p.kind === 'envelope' ? p.sender : p.recipient);
    if (!signer || signer.account !== (p.kind === 'envelope' ? p.sender : p.recipient) || !verifyRecord(signer, now)) return false;
    const device = signer.devices.find(d => d.id === (p.kind === 'envelope' ? p.senderDevice : p.recipientDevice));
    if (!device) return false;
    return ed25519.verify(hexToBytes(p.signature), p.kind === 'envelope' ? signedEnvelope(p) : signedReceipt(p), hexToBytes(device.signing), { zip215: false });
  } catch { return false; }
}
export async function sealCustody(d: { record: IdentityRecord; signingSeed: Uint8Array; encryptionSeed: Uint8Array;
  recipient: IdentityRecord; recipientDevice: string; id: string; text: string; now: number; random(n: number): Promise<Uint8Array> }): Promise<CustodyEnvelope> {
  const device = publicDevice(d.signingSeed, d.encryptionSeed), recipient = d.recipient.devices.find(v => v.id === d.recipientDevice);
  if (!verifyRecord(d.record, d.now) || !verifyRecord(d.recipient, d.now) || !d.record.devices.some(v => v.id === device.id)
    || !recipient || d.record.account === d.recipient.account || !hex(d.id, 32) || typeof d.text !== 'string'
    || !d.text.length || utf8ToBytes(d.text).length > 2048) throw Error('Invalid custody message');
  const secret = await d.random(32); let shared: Uint8Array | undefined, key: Uint8Array | undefined;
  const plain = utf8ToBytes(d.text);
  try {
    const nonce = await d.random(24); if (secret.length !== 32 || nonce.length !== 24) throw Error('Invalid randomness');
    const e: CustodyEnvelope = { version: 1, kind: 'envelope', id: d.id, sender: d.record.account, senderDevice: device.id,
      recipient: d.recipient.account, recipientDevice: recipient.id, created: d.now, expires: d.now + CUSTODY_TTL,
      ephemeral: bytesToHex(x25519.getPublicKey(secret)), nonce: bytesToHex(nonce), ciphertext: '', signature: '' };
    const aad = bytes(header(e)); shared = x25519.getSharedSecret(secret, hexToBytes(recipient.encryption));
    key = hkdf(sha256, shared, sha256(aad), utf8ToBytes('axonic-custody-key-v1'), 32);
    e.ciphertext = bytesToHex(xchacha20poly1305(key, nonce, aad).encrypt(plain));
    e.signature = bytesToHex(ed25519.sign(signedEnvelope(e), d.signingSeed)); return e;
  } finally { secret.fill(0); shared?.fill(0); key?.fill(0); plain.fill(0); }
}
/** Caller verifies the envelope against current pinned records before decrypting. */
export function openCustody(e: CustodyEnvelope, account: string, signingSeed: Uint8Array, encryptionSeed: Uint8Array): string {
  if (e.recipient !== account || e.recipientDevice !== publicDevice(signingSeed, encryptionSeed).id) throw Error('Wrong custody recipient');
  const aad = bytes(header(e)), shared = x25519.getSharedSecret(encryptionSeed, hexToBytes(e.ephemeral));
  let key: Uint8Array | undefined, plain: Uint8Array | undefined;
  try {
    key = hkdf(sha256, shared, sha256(aad), utf8ToBytes('axonic-custody-key-v1'), 32);
    plain = xchacha20poly1305(key, hexToBytes(e.nonce), aad).decrypt(hexToBytes(e.ciphertext));
    const text = new TextDecoder().decode(plain);
    if (!text.length || plain.length > 2048 || bytesToHex(utf8ToBytes(text)) !== bytesToHex(plain)) throw Error('Invalid custody text');
    return text;
  } finally { shared.fill(0); key?.fill(0); plain?.fill(0); }
}
/** Call only AFTER the recipient durably saves/deduplicates its own message. */
export function signCustodyReceipt(e: CustodyEnvelope, signingSeed: Uint8Array, encryptionSeed: Uint8Array): CustodyReceipt {
  if (publicDevice(signingSeed, encryptionSeed).id !== e.recipientDevice) throw Error('Wrong receipt device');
  const r: CustodyReceipt = { version: 1, kind: 'receipt', id: e.id, sender: e.sender, recipient: e.recipient,
    recipientDevice: e.recipientDevice, expires: e.expires, digest: custodyDigest(e), signature: '' };
  r.signature = bytesToHex(ed25519.sign(signedReceipt(r), signingSeed)); return r;
}
