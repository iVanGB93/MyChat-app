import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
import type { NormalChatBinding } from './normalChatBoundary.ts';

/** Migration metadata only. Authenticated Axion supplies the numeric sender; neurons cannot do so. */
export interface ChatBindingChallenge {
  version: 1; roomId: string; requester: number; requesterAccount: string;
  peer: number; nonce: string; expiresAt: number;
}
export interface ChatBindingProof {
  version: 1; challenge: ChatBindingChallenge; record: IdentityRecord; device: string; signature: string;
}
const hex = (v: unknown, n: number): v is string => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const user = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function challengeValues(c: ChatBindingChallenge): unknown[] {
  return [c.version, c.roomId, c.requester, c.requesterAccount, c.peer, c.nonce, c.expiresAt];
}
export function validChatBindingChallenge(c: ChatBindingChallenge, now: number): boolean {
  return !!c && c.version === 1 && typeof c.roomId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.roomId)
    && user(c.requester) && user(c.peer) && c.requester !== c.peer && validAccountId(c.requesterAccount)
    && hex(c.nonce, 64) && Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(c.expiresAt)
    && c.expiresAt > now && c.expiresAt <= now + 60_000;
}
const valid = validChatBindingChallenge;
function body(c: ChatBindingChallenge, record: IdentityRecord, device: string) {
  return utf8ToBytes(JSON.stringify(['axonic-chat-binding-v1', ...challengeValues(c), recordDigest(record), device]));
}
export function signChatBinding(record: IdentityRecord, signingSeed: Uint8Array, owner: number,
  challenge: ChatBindingChallenge, now: number): ChatBindingProof {
  if (!valid(challenge, now) || challenge.peer !== owner || !verifyRecord(record, now)
    || record.account === challenge.requesterAccount) throw Error('Invalid chat binding challenge');
  const signing = bytesToHex(ed25519.getPublicKey(signingSeed));
  const device = record.devices.find(d => d.signing === signing)?.id;
  if (!device) throw Error('Identity signing device unavailable');
  return { version: 1, challenge: { ...challenge }, record: JSON.parse(JSON.stringify(record)), device,
    signature: bytesToHex(ed25519.sign(body(challenge, record, device), signingSeed)) };
}
export function verifyChatBinding(proof: ChatBindingProof, expected: ChatBindingChallenge, authenticatedSender: number, now: number): boolean {
  try {
    if (!proof || proof.version !== 1 || !valid(expected, now) || !valid(proof.challenge, now)
      || authenticatedSender !== expected.peer || JSON.stringify(challengeValues(proof.challenge)) !== JSON.stringify(challengeValues(expected))
      || !verifyRecord(proof.record, now) || proof.record.account === expected.requesterAccount
      || !hex(proof.signature, 128) || !hex(proof.device, 64)) return false;
    const device = proof.record.devices.find(d => d.id === proof.device);
    return !!device && ed25519.verify(hexToBytes(proof.signature), body(expected, proof.record, proof.device),
      hexToBytes(device.signing), { zip215: false });
  } catch { return false; }
}
/** One foreground/account session. Responses must enter only from authenticated Axion,
 * never from discovery, a peer socket, or a relay's claim about a Django username.
 */
export function createChatBindingExchange(d: {
  owner: NormalChatBinding; current(): boolean; now(): number; random(): Promise<string>;
  authorized(roomId: string, peer: number): boolean;
  /** Atomic immutable pin: same account is idempotent; replacement is rejected, not silently trusted. */
  pin(peer: number, account: string, current: () => boolean): Promise<boolean>;
}) {
  const owner = { ...d.owner }, pending = new Map<string, ChatBindingChallenge>();
  if (!user(owner.user) || !validAccountId(owner.account)) throw Error('Invalid chat binding owner');
  let stopped = false, creating = false;
  const current = () => !stopped && d.current();
  function sweep() { for (const [nonce, c] of pending) if (c.expiresAt <= d.now()) pending.delete(nonce); }
  return {
    async challenge(roomId: string, peer: number): Promise<ChatBindingChallenge | null> {
      sweep();
      if (!current() || creating || pending.size >= 32 || !d.authorized(roomId, peer)) return null;
      creating = true;
      try {
        const nonce = await d.random();
        const c: ChatBindingChallenge = { version: 1, roomId, requester: owner.user, requesterAccount: owner.account,
          // Leave five seconds of headroom inside the verifier/server's 60s cap.
          // Otherwise even a slightly faster sender clock breaks one direction.
          peer, nonce, expiresAt: d.now() + 55_000 };
        if (!current() || !valid(c, d.now()) || !d.authorized(roomId, peer) || pending.has(nonce)) return null;
        pending.set(nonce, c); return { ...c };
      } finally { creating = false; }
    },
    async accept(authenticatedSender: number, proof: ChatBindingProof): Promise<boolean> {
      sweep();
      if (!current()) return false;
      const c = pending.get(proof?.challenge?.nonce);
      if (!c || !d.authorized(c.roomId, c.peer) || !verifyChatBinding(proof, c, authenticatedSender, d.now())) return false;
      // Consume before asynchronous storage, preventing concurrent replay.
      pending.delete(c.nonce);
      const permitted = () => current() && c.expiresAt > d.now() && d.authorized(c.roomId, c.peer);
      return await d.pin(c.peer, proof.record.account, permitted) && permitted();
    },
    stop() { stopped = true; pending.clear(); },
  };
}
