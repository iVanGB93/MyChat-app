import { bytesToHex } from '@noble/hashes/utils.js';
import { compareRecord, type IdentityRecord } from './identityProtocol.ts';
import { pinIdentityRecord, type IdentityRecordStore, type IdentityRequest } from './identityAdmission.ts';
import { verifyIdentityDescriptor, verifyIdentityResponse } from './identityExchange.ts';

export interface IdentityPeer { account: string; device: string; instance: string; expiresAt: number }
/** No privileged bootstrap account. The transport must impose byte/time limits before buffering.
 * An authenticated peer is not authorization to send messages or read another user's data.
 */
export async function authenticateIdentityPeer(d: {
  expectedAccount: string; localAccount: string; store: IdentityRecordStore;
  random(size: number): Promise<Uint8Array>; now(): number; current(): boolean;
  exchange(operation: 'describe' | 'authenticate', payload: string): Promise<string>;
  sign(audience: { account: string; instance: string }): Promise<IdentityRequest>;
}): Promise<IdentityPeer | null> {
  try {
    if (!d.current()) return null;
    const random = await d.random(32);
    if (random.length !== 32 || !d.current()) return null;
    const nonce = bytesToHex(random);
    const raw = await d.exchange('describe', JSON.stringify({ version: 1, nonce }));
    if (!d.current()) return null;
    const known = await d.store.read(d.expectedAccount);
    if (!d.current()) return null;
    const descriptor = verifyIdentityDescriptor(raw, d.expectedAccount, nonce, known, d.now());
    if (!descriptor) return null;
    if (!await pinIdentityRecord(d.store, known, descriptor.record, descriptor.history) || !d.current()) return null;
    const request = await d.sign({ account: descriptor.record.account, instance: descriptor.instance });
    if (!d.current() || request.record.account !== d.localAccount || request.target !== d.expectedAccount
      || request.instance !== descriptor.instance || request.operation !== 'authenticate' || request.payload !== '') return null;
    const requestRaw = JSON.stringify(request);
    const reply = await d.exchange('authenticate', requestRaw);
    if (!d.current() || !verifyIdentityResponse(reply, requestRaw, descriptor, d.now())) return null;
    // A concurrent revocation or identity update may have arrived during the exchange.
    const latest: IdentityRecord | null = await d.store.read(d.expectedAccount);
    if (!d.current() || !latest || compareRecord(descriptor.record, latest, d.now()) !== 'accept') return null;
    return { account: descriptor.record.account, device: descriptor.device, instance: descriptor.instance,
      expiresAt: Math.min(descriptor.expiresAt, descriptor.record.expiresAt) };
  } catch { return null; }
}
