/** Portable call control foundation. Transport admission must pin identity updates first. */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { verifyPublicSignature, recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';

export type CallControlKind = 'invite' | 'ringing' | 'accept' | 'selected' | 'reject' | 'busy' | 'cancel' | 'end';
export interface CallControl {
  version: 1; record: IdentityRecord; device: string;
  callId: string; caller: string; callee: string; callerDevice: string;
  media: 'voice' | 'video'; kind: CallControlKind; invitation: string | null;
  sequence: number; issuedAt: number; expiresAt: number; signature: string;
  selectedDevice?: string; acceptance?: string;
}
const hex = (v: unknown, length: number) => typeof v === 'string' && v.length === length && /^[0-9a-f]+$/.test(v);
const body = (e: CallControl) => utf8ToBytes(JSON.stringify(['axonic-call-control-v1', e.version,
  recordDigest(e.record), e.device, e.callId, e.caller, e.callee, e.callerDevice,
  e.media, e.kind, e.invitation, e.sequence, e.issuedAt, e.expiresAt,
  e.selectedDevice ?? null, e.acceptance ?? null]));
export const callControlDigest = (e: CallControl) => bytesToHex(sha256(body(e)));

/** A valid signature is insufficient: require the exact latest locally pinned record. */
export function verifyCallControl(raw: string, pinned: IdentityRecord, now: number): CallControl | null {
  try {
    if (typeof raw !== 'string' || utf8ToBytes(raw).length > 6000 || !Number.isSafeInteger(now) || now < 0) return null;
    const e: CallControl = JSON.parse(raw);
    if (e.version !== 1 || !verifyRecord(e.record, now) || !verifyRecord(pinned, now)
      || recordDigest(e.record) !== recordDigest(pinned) || !hex(e.callId, 64)
      || !validAccountId(e.caller) || !validAccountId(e.callee) || e.caller === e.callee
      || !hex(e.callerDevice, 64) || !['voice', 'video'].includes(e.media)
      || !['invite', 'ringing', 'accept', 'selected', 'reject', 'busy', 'cancel', 'end'].includes(e.kind)
      || !Number.isSafeInteger(e.sequence) || e.sequence < 0 || e.sequence > 64
      || !Number.isSafeInteger(e.issuedAt) || e.issuedAt < 0 || e.issuedAt > now + 5000
      || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= now || e.expiresAt <= e.issuedAt
      || e.expiresAt - e.issuedAt > 60000 || e.expiresAt > e.record.expiresAt
      || !hex(e.signature, 128)) return null;
    const caller = e.record.account === e.caller && e.device === e.callerDevice;
    const callee = e.record.account === e.callee;
    if (!caller && !callee) return null;
    if (e.kind === 'invite' ? (!caller || e.sequence !== 0 || e.invitation !== null)
      : (!hex(e.invitation, 64) || e.sequence === 0)) return null;
    if (['cancel', 'selected'].includes(e.kind) && !caller) return null;
    if (e.kind === 'selected' ? (!hex(e.selectedDevice, 64) || !hex(e.acceptance, 64))
      : (e.selectedDevice !== undefined || e.acceptance !== undefined)) return null;
    if (['ringing', 'accept', 'reject', 'busy'].includes(e.kind) && !callee) return null;
    const device = pinned.devices.find(d => d.id === e.device);
    return device && verifyPublicSignature(hexToBytes(e.signature), body(e), hexToBytes(device.signing), { zip215: false }) ? e : null;
  } catch { return null; }
}

export function signCallControl(input: Omit<CallControl, 'version' | 'device' | 'signature'>,
  seed: Uint8Array, now: number): string {
  const device = input.record.devices.find(d => d.signing === bytesToHex(ed25519.getPublicKey(seed)));
  if (!device) throw Error('Unauthorized call signer');
  const event: CallControl = { ...input, version: 1, device: device.id, signature: '' };
  event.signature = bytesToHex(ed25519.sign(body(event), seed));
  const raw = JSON.stringify(event);
  if (!verifyCallControl(raw, input.record, now)) throw Error('Invalid call control');
  return raw;
}

/** Caller-side arbitration only. Acceptance must later be confirmed to the selected device.
 * Keep terminal state until invitation expiry; persist it before enabling this in production.
 * A relay must never run this on behalf of either participant. */
export function createCallerCallControl(raw: string, pinned: IdentityRecord, now: number) {
  const invite = verifyCallControl(raw, pinned, now);
  if (!invite || invite.kind !== 'invite') throw Error('Invalid call invitation');
  const invitation = callControlDigest(invite);
  let status: 'ringing' | 'accepted' | 'ended' | 'cancelled' | 'expired' = 'ringing';
  let selectedDevice: string | null = null;
  let acceptance: string | null = null;
  let confirmed = false;
  const sequences = new Map<string, number>();
  const declined = new Set<string>();
  const expire = (time: number) => {
    if ((status === 'ringing' || status === 'accepted' && !confirmed) && time >= invite.expiresAt) status = 'expired';
  };
  return {
    snapshot(time: number) { expire(time); return { status, selectedDevice, invitation, acceptance, confirmed }; },
    receive(next: string, latest: IdentityRecord, time: number): boolean {
      expire(time);
      if (['ended', 'cancelled', 'expired'].includes(status)) return false;
      const e = verifyCallControl(next, latest, time);
      if (!e || e.invitation !== invitation || e.callId !== invite.callId || e.caller !== invite.caller
        || e.callee !== invite.callee || e.callerDevice !== invite.callerDevice || e.media !== invite.media
        || e.issuedAt < invite.issuedAt || e.kind === 'invite') return false;
      const caller = e.record.account === invite.caller;
      const key = `${e.record.account}:${e.device}`;
      if (declined.has(key)) return false;
      if (e.sequence <= (sequences.get(key) ?? 0) || (!sequences.has(key) && sequences.size >= 16)) return false;
      if (status === 'accepted' && (!caller && e.device !== selectedDevice || !['end', 'cancel', 'selected'].includes(e.kind))) return false;
      if (e.kind === 'selected' && (confirmed || e.expiresAt > invite.expiresAt || e.selectedDevice !== selectedDevice || e.acceptance !== acceptance)) return false;
      if (status === 'ringing' && (e.expiresAt > invite.expiresAt || ['end', 'selected'].includes(e.kind))) return false;
      sequences.set(key, e.sequence);
      if (e.kind === 'reject' || e.kind === 'busy') declined.add(key);
      if (e.kind === 'accept') { selectedDevice = e.device; acceptance = callControlDigest(e); status = 'accepted'; }
      if (e.kind === 'selected') confirmed = true;
      if (e.kind === 'cancel') status = 'cancelled';
      if (e.kind === 'end') status = 'ended';
      // Busy/reject belongs to one callee device; other authorized devices may still accept.
      return true;
    },
  };
}

/** Recipient checks confirmation against its own signed acceptance, never a relay's assertion.
 * The recipient's durable lifecycle must additionally reject cancelled/ended calls. */
export function verifyCallSelection(inviteRaw: string, acceptanceRaw: string, selectionRaw: string,
  caller: IdentityRecord, callee: IdentityRecord, now: number): boolean {
  const invite = verifyCallControl(inviteRaw, caller, now);
  const accept = verifyCallControl(acceptanceRaw, callee, now);
  const selected = verifyCallControl(selectionRaw, caller, now);
  if (!invite || invite.kind !== 'invite' || !accept || accept.kind !== 'accept' || !selected || selected.kind !== 'selected') return false;
  const state = createCallerCallControl(inviteRaw, caller, now);
  return state.receive(acceptanceRaw, callee, now) && state.receive(selectionRaw, caller, now);
}

/** This device records its own acceptance before processing caller selection. */
export function createRecipientCallControl(raw: string, pinned: IdentityRecord, device: string, now: number) {
  const invite = verifyCallControl(raw, pinned, now);
  if (!invite || invite.kind !== 'invite' || !hex(device, 64)) throw Error('Invalid recipient invitation');
  const inner = createCallerCallControl(raw, pinned, now);
  let terminal: 'rejected' | 'answered-elsewhere' | null = null;
  return {
    snapshot(time: number) {
      const state = inner.snapshot(time);
      return { ...state, status: terminal ?? state.status };
    },
    receive(next: string, latest: IdentityRecord, time: number): boolean {
      const state = inner.snapshot(time);
      if (terminal || ['cancelled', 'ended', 'expired'].includes(state.status)) return false;
      const e = verifyCallControl(next, latest, time);
      if (!e || e.callId !== invite.callId || e.caller !== invite.caller || e.callee !== invite.callee
        || e.callerDevice !== invite.callerDevice || e.media !== invite.media
        || e.invitation !== state.invitation || e.issuedAt < invite.issuedAt) return false;
      if (e.record.account === invite.callee && e.device !== device) return false;
      if (e.kind === 'selected' && e.selectedDevice !== device) {
        // Only the initiating caller can sign selection. Once confirmed locally, a conflicting
        // later selection must not replace that decision.
        if (state.confirmed || time >= invite.expiresAt || e.expiresAt > invite.expiresAt) return false;
        terminal = 'answered-elsewhere'; return true;
      }
      if (!inner.receive(next, latest, time)) return false;
      if (e.kind === 'reject' || e.kind === 'busy') terminal = 'rejected';
      return true;
    },
  };
}
