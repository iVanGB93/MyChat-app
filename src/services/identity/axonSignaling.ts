import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { compareRecord, recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
import { pinIdentityRecord, type IdentityRecordStore } from './identityAdmission.ts';
import type { IdentityPeer } from './identityClient.ts';

export interface AxonSignal {
  version: 1; record: IdentityRecord; history?: IdentityRecord[]; device: string;
  target: string; session: string; kind: 'offer' | 'answer'; sdp: string;
  issuedAt: number; expiresAt: number; signature: string;
}
const body = (s: AxonSignal) => utf8ToBytes(JSON.stringify(['axonic-rtc-signal-v1', s.version,
  recordDigest(s.record), s.device, s.target, s.session, s.kind, s.sdp, s.issuedAt, s.expiresAt]));
const bytes = (s: string) => utf8ToBytes(s).length;
export function signAxonSignal(record: IdentityRecord, seed: Uint8Array, history: IdentityRecord[],
  target: string, session: string, kind: AxonSignal['kind'], sdp: string, now: number): string {
  const device = record.devices.find(d => d.signing === bytesToHex(ed25519.getPublicKey(seed)))?.id;
  if (!device) throw Error('Unauthorized signal signer');
  const signal: AxonSignal = { version: 1, record, ...(history.length ? { history } : {}), device,
    target, session, kind, sdp, issuedAt: now, expiresAt: Math.min(now + 30000, record.expiresAt), signature: '' };
  signal.signature = bytesToHex(ed25519.sign(body(signal), seed));
  const raw = JSON.stringify(signal);
  if (!verifyAxonSignal(raw, now)) throw Error('Invalid or oversized signal');
  return raw;
}
export function verifyAxonSignal(raw: string, now: number): AxonSignal | null {
  try {
    if (typeof raw !== 'string' || bytes(raw) > 14000) return null;
    const s: AxonSignal = JSON.parse(raw);
    if (s.version !== 1 || !verifyRecord(s.record, now) || !validAccountId(s.target) || s.target === s.record.account
      || !/^[0-9a-f]{64}$/.test(s.session) || !['offer', 'answer'].includes(s.kind)
      || typeof s.sdp !== 'string' || bytes(s.sdp) > 7000 || !s.sdp.startsWith('v=0\r\n')
      || !Number.isSafeInteger(s.issuedAt) || s.issuedAt < 0 || s.issuedAt > now + 5000
      || !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= now || s.expiresAt <= s.issuedAt
      || s.expiresAt - s.issuedAt > 30000 || s.expiresAt > s.record.expiresAt
      || !/^[0-9a-f]{128}$/.test(s.signature)) return null;
    const device = s.record.devices.find(d => d.id === s.device);
    if (!device || !ed25519.verify(hexToBytes(s.signature), body(s), hexToBytes(device.signing), { zip215: false })) return null;
    return s;
  } catch { return null; }
}
/** One-hop, online-only signaling. No addresses are dialed by this router, and no offline queue exists. */
export function createAxonSignaling(d: {
  account: string; store: IdentityRecordStore; now(): number; current(): boolean;
  connected(account: string): boolean; send(account: string, raw: string): boolean;
  receive(signal: AxonSignal, via: string): void;
}) {
  const seen = new Map<string, number>();
  let busy = 0;
  return {
    async receive(raw: string, via: IdentityPeer) {
      if (!d.current() || busy >= 2 || via.expiresAt <= d.now() || !d.connected(via.account)) return false;
      busy++;
      try {
        const signal = verifyAxonSignal(raw, d.now());
        if (!signal || signal.record.account === d.account) return false;
        const local = signal.target === d.account;
        // A relay only forwards the authenticated sender's own signal, never another relay's report.
        if (!local && (signal.record.account !== via.account || signal.device !== via.device || !d.connected(signal.target))) return false;
        for (const [key, expires] of seen) if (expires <= d.now()) seen.delete(key);
        const key = `${signal.record.account}:${signal.session}:${signal.kind}`;
        if (seen.has(key) || seen.size >= 128) return false;
        seen.set(key, signal.expiresAt);
        const known = await d.store.read(signal.record.account);
        if (!d.current() || compareRecord(signal.record, known, d.now(), signal.history) !== 'accept') return false;
        if (!await pinIdentityRecord(d.store, known, signal.record, signal.history)) return false;
        if (!d.current() || signal.expiresAt <= d.now() || via.expiresAt <= d.now() || !d.connected(via.account)) return false;
        if (local) { d.receive(signal, via.account); return true; }
        return d.connected(signal.target) && d.send(signal.target, raw);
      } catch { return false; }
      finally { busy--; }
    },
    clear() { seen.clear(); },
  };
}
