/** Signed call admission. Direct and relayed transport have separate sender checks. */
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { verifyPublicSignature, recordDigest, verifyRecord, validAccountId, type IdentityRecord } from './identityProtocol.ts';
import { callControlDigest, verifyCallControl, type CallControl } from './callControlProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';

export interface CallControlReceipt {
  version: 1; record: IdentityRecord; device: string; callId: string; event: string;
  target: string; targetDevice: string; issuedAt: number; expiresAt: number; signature: string;
}
const body = (r: CallControlReceipt) => utf8ToBytes(JSON.stringify(['axonic-call-control-receipt-v1', r.version,
  recordDigest(r.record), r.device, r.callId, r.event, r.target, r.targetDevice, r.issuedAt, r.expiresAt]));
export function signCallControlReceipt(event: CallControl, record: IdentityRecord, seed: Uint8Array, now: number): string {
  const device = record.devices.find(d => d.signing === bytesToHex(ed25519.getPublicKey(seed)));
  if (!device) throw Error('Unauthorized receipt signer');
  const r: CallControlReceipt = { version: 1, record, device: device.id, callId: event.callId,
    event: callControlDigest(event), target: event.record.account, targetDevice: event.device,
    issuedAt: now, expiresAt: Math.min(now + 60000, event.expiresAt, record.expiresAt), signature: '' };
  r.signature = bytesToHex(ed25519.sign(body(r), seed));
  const raw = JSON.stringify(r);
  if (!verifyCallControlReceipt(raw, event, record, now)) throw Error('Invalid call receipt');
  return raw;
}
/** Receipt means this exact event was durably admitted, not that the phone rang or media connected. */
export function verifyCallControlReceipt(raw: string, event: CallControl, latest: IdentityRecord, now: number): CallControlReceipt | null {
  try {
    if (typeof raw !== 'string' || utf8ToBytes(raw).length > 6000) return null;
    const r: CallControlReceipt = JSON.parse(raw);
    const recipient = event.record.account === event.caller ? event.callee : event.caller;
    if (r.version !== 1 || !verifyRecord(latest, now) || !verifyRecord(r.record, now)
      || recordDigest(r.record) !== recordDigest(latest) || r.record.account !== recipient
      || r.callId !== event.callId || r.event !== callControlDigest(event)
      || r.target !== event.record.account || r.targetDevice !== event.device
      || (recipient === event.caller && r.device !== event.callerDevice)
      || (event.kind === 'selected' && r.device !== event.selectedDevice)
      || !Number.isSafeInteger(r.issuedAt) || r.issuedAt < event.issuedAt || r.issuedAt > now + 5000
      || !Number.isSafeInteger(r.expiresAt) || r.expiresAt <= now || r.expiresAt <= r.issuedAt
      || r.expiresAt > event.expiresAt || r.expiresAt > r.record.expiresAt || r.expiresAt - r.issuedAt > 60000
      || typeof r.signature !== 'string' || !/^[0-9a-f]{128}$/.test(r.signature)) return null;
    const device = latest.devices.find(d => d.id === r.device);
    return device && verifyPublicSignature(hexToBytes(r.signature), body(r), hexToBytes(device.signing), { zip215: false }) ? r : null;
  } catch { return null; }
}

export function createCallControlDelivery(d: {
  account: string; device: string; records: Pick<IdentityRecordStore, 'read'>;
  current(): boolean; now(): number; blocked(account: string): boolean;
  /** Must return true only after atomic persistence, including verified durable duplicates. */
  commit(raw: string, latest: IdentityRecord, now: number): Promise<boolean>;
  courierBlocked?(account: string): boolean;
  signReceipt(event: CallControl, now: number): Promise<string>;
}) {
  let busy = 0;
  async function receive(raw: string, peer: IdentityPeer, relayed = false): Promise<string | null> {
      const active = () => d.current() && peer.expiresAt > d.now() && !(relayed ? (d.courierBlocked ?? d.blocked)(peer.account) : d.blocked(peer.account));
      if (busy >= 2 || !active() || typeof raw !== 'string' || utf8ToBytes(raw).length > 6000) return null;
      busy++;
      try {
        let sender = peer.account;
        if (relayed) {
          // The axon authenticates the courier, never the original caller.
          const courier = await d.records.read(peer.account);
          if (!courier || !verifyRecord(courier, d.now()) || !courier.devices.some(device => device.id === peer.device) || !active()) return null;
          sender = JSON.parse(raw)?.record?.account;
          if (!validAccountId(sender) || d.blocked(sender)) return null;
        }
        const allowed = () => active() && !d.blocked(sender);
        const latest = await d.records.read(sender);
        if (!latest || !allowed()) return null;
        const event = verifyCallControl(raw, latest, d.now());
        if (!event || event.record.account !== sender || (!relayed && event.device !== peer.device)
          || (event.record.account === event.caller ? event.callee : event.caller) !== d.account
          || (event.callee === d.account ? event.kind === 'selected' && event.selectedDevice !== d.device
            : event.callerDevice !== d.device)) return null;
        if (!await d.commit(raw, latest, d.now()) || !allowed()) return null;
        const current = await d.records.read(sender);
        if (!current || !verifyCallControl(raw, current, d.now()) || !allowed()) return null;
        const receipt = await d.signReceipt(event, d.now());
        const local = await d.records.read(d.account);
        const verified = local && verifyCallControlReceipt(receipt, event, local, d.now());
        if (relayed) {
          const courier = await d.records.read(peer.account);
          if (!courier || !verifyRecord(courier, d.now()) || !courier.devices.some(device => device.id === peer.device)) return null;
        }
        return allowed() && verified?.device === d.device ? receipt : null;
      } catch { return null; }
      finally { busy--; }
  }
  return {
    receive: (raw: string, peer: IdentityPeer) => receive(raw, peer),
    /** Pass an authenticated courier session, never identity data from a push hint. */
    receiveRelayed: (raw: string, courier: IdentityPeer) => receive(raw, courier, true),
  };
}
