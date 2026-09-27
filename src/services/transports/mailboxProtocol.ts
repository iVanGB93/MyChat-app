/** Explicitly paired, development-only store-and-forward protocol. */
export interface MailboxIdentity { encryption: string; signing: string }
export interface SealedContent { wrappedKey: string; iv: string; ciphertext: string }
export interface MailboxEnvelope extends SealedContent {
  kind: 'envelope'; version: 1; id: string; roomId: string;
  sender: number; recipient: number; createdAt: number; expiresAt: number; signature: string;
}
export interface MailboxReceipt {
  kind: 'receipt'; version: 1; id: string; sender: number; recipient: number;
  expiresAt: number; envelopeDigest: string; signature: string;
}
export type MailboxPacket = MailboxEnvelope | MailboxReceipt;
export interface MailboxCrypto {
  seal(key: string, header: string, plaintext: string): Promise<SealedContent>;
  open(owner: number, header: string, content: SealedContent): Promise<string>;
  sign(owner: number, value: string): Promise<string>;
  verify(key: string, value: string, signature: string): Promise<boolean>;
  digest(value: string): Promise<string>;
}
export interface MailboxStore {
  get(owner: number, kind: MailboxPacket['kind'], id: string, now: number): Promise<MailboxPacket | null>;
  /** Atomic, immutable, capacity-limited insert. Equal retransmission is success. */
  put(owner: number, packet: MailboxPacket, now: number): Promise<boolean>;
  list(owner: number, now: number): Promise<MailboxPacket[]>;
}
export const MAILBOX_TTL = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const base64 = (s: unknown, length: number) => typeof s === 'string' && s.length > 0
  && s.length <= length && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
export function envelopeHeader(e: MailboxEnvelope): string {
  return JSON.stringify(['axonic-mailbox-envelope-v1', e.id, e.roomId, e.sender, e.recipient, e.createdAt, e.expiresAt]);
}
export function signedBody(p: MailboxPacket): string {
  return p.kind === 'envelope'
    ? JSON.stringify([envelopeHeader(p), p.wrappedKey, p.iv, p.ciphertext])
    : JSON.stringify(['axonic-mailbox-receipt-v1', p.id, p.sender, p.recipient, p.expiresAt, p.envelopeDigest]);
}
export function parseMailboxPacket(raw: string, now: number): MailboxPacket | null {
  if (raw.length > 10_000) return null;
  let p: any; try { p = JSON.parse(raw); } catch { return null; }
  if (!p || p.version !== 1 || typeof p.id !== 'string' || !UUID.test(p.id) || !Number.isSafeInteger(p.sender) || p.sender < 1
    || !Number.isSafeInteger(p.recipient) || p.recipient < 1 || p.sender === p.recipient
    || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now || p.expiresAt > now + MAILBOX_TTL
    || !base64(p.signature, 128)) return null;
  if (p.kind === 'envelope' && typeof p.roomId === 'string' && UUID.test(p.roomId) && Number.isSafeInteger(p.createdAt)
    && p.createdAt <= now + 60_000 && p.createdAt >= now - MAILBOX_TTL
    && p.expiresAt > p.createdAt && p.expiresAt - p.createdAt <= MAILBOX_TTL
    && base64(p.wrappedKey, 344) && p.wrappedKey.length === 344
    && base64(p.iv, 16) && p.iv.length === 16 && base64(p.ciphertext, 5484)) {
    return { kind: 'envelope', version: 1, id: p.id, roomId: p.roomId, sender: p.sender, recipient: p.recipient,
      createdAt: p.createdAt, expiresAt: p.expiresAt, wrappedKey: p.wrappedKey, iv: p.iv, ciphertext: p.ciphertext, signature: p.signature };
  }
  if (p.kind === 'receipt' && typeof p.envelopeDigest === 'string' && /^[a-f0-9]{64}$/.test(p.envelopeDigest)) {
    return { kind: 'receipt', version: 1, id: p.id, sender: p.sender, recipient: p.recipient,
      expiresAt: p.expiresAt, envelopeDigest: p.envelopeDigest, signature: p.signature };
  }
  return null;
}

interface Dependencies {
  owner: number;
  current(): boolean;
  now(): number;
  identity(user: number): MailboxIdentity | null;
  crypto: MailboxCrypto;
  store: MailboxStore;
  persist(envelope: MailboxEnvelope, plaintext: string): Promise<boolean>;
  send(peer: number, packet: MailboxPacket): Promise<boolean>;
}
export function createMailboxNode(d: Dependencies) {
  let tail = Promise.resolve();
  let queued = 0;
  let flushing = false;
  const current = () => d.current();
  async function verified(p: MailboxPacket) {
    const sender = d.identity(p.sender), recipient = d.identity(p.recipient);
    return !!sender && !!recipient && await d.crypto.verify(
      p.kind === 'envelope' ? sender.signing : recipient.signing, signedBody(p), p.signature) && current();
  }
  async function receive(peer: number, raw: string): Promise<boolean> {
    if (!current() || !d.identity(peer)) return false;
    const p = parseMailboxPacket(raw, d.now());
    if (!p || !await verified(p)) return false;
    if (p.kind === 'receipt') {
      const e = await d.store.get(d.owner, 'envelope', p.id, d.now());
      if (!current() || e?.kind !== 'envelope' || p.sender !== e.sender || p.recipient !== e.recipient
        || p.expiresAt !== e.expiresAt || p.envelopeDigest !== await d.crypto.digest(signedBody(e)) || !current()) return false;
      return d.store.put(d.owner, p, d.now());
    }
    if (p.sender === d.owner) return false;
    if (p.recipient !== d.owner) {
      // Only an originator may deposit; relays cannot flood other relays.
      return peer === p.sender && current() && d.store.put(d.owner, p, d.now());
    }
    const existing = await d.store.get(d.owner, 'envelope', p.id, d.now());
    if (!current() || (existing && signedBody(existing) !== signedBody(p))) return false;
    const plaintext = await d.crypto.open(d.owner, envelopeHeader(p), p);
    if (!current() || !plaintext || plaintext.length > 4096) return false;
    // Store encrypted recovery data first; never acknowledge before chat persistence.
    if (!await d.store.put(d.owner, p, d.now()) || !current() || !await d.persist(p, plaintext) || !current()) return false;
    const previous = await d.store.get(d.owner, 'receipt', p.id, d.now());
    if (previous) return current();
    const receipt: MailboxReceipt = { kind: 'receipt', version: 1, id: p.id, sender: p.sender, recipient: p.recipient,
      expiresAt: p.expiresAt, envelopeDigest: await d.crypto.digest(signedBody(p)), signature: '' };
    if (!current()) return false;
    receipt.signature = await d.crypto.sign(d.owner, signedBody(receipt));
    return current() && d.store.put(d.owner, receipt, d.now());
  }
  return {
    /** Bounded serialization prevents simultaneous duplicate delivery or quota bypass. */
    receive(peer: number, raw: string): Promise<boolean> {
      if (queued >= 16 || raw.length > 10_000) return Promise.resolve(false);
      queued++;
      const result = tail.then(() => receive(peer, raw)).catch(() => false);
      tail = result.then(() => { queued--; });
      return result;
    },
    async create(id: string, roomId: string, recipient: number, plaintext: string, createdAt = d.now()): Promise<MailboxEnvelope | null> {
      const identity = d.identity(recipient);
      if (!current() || !identity || recipient === d.owner || !UUID.test(id) || !UUID.test(roomId)
        || !plaintext || plaintext.length > 4096) return null;
      const old = await d.store.get(d.owner, 'envelope', id, d.now());
      // Caller must reuse the original envelope through deposit after a restart.
      if (old || !current()) return null;
      const now = d.now();
      if (!Number.isSafeInteger(createdAt) || createdAt > now + 60_000 || createdAt + MAILBOX_TTL <= now) return null;
      let p: MailboxEnvelope = { kind: 'envelope', version: 1, id, roomId, sender: d.owner, recipient,
        createdAt, expiresAt: createdAt + MAILBOX_TTL, wrappedKey: '', iv: '', ciphertext: '', signature: '' };
      p = { ...p, ...await d.crypto.seal(identity.encryption, envelopeHeader(p), plaintext) };
      if (!current()) return null;
      p.signature = await d.crypto.sign(d.owner, signedBody(p));
      if (!current() || !parseMailboxPacket(JSON.stringify(p), d.now()) || !await d.store.put(d.owner, p, d.now())) return null;
      return current() ? p : null;
    },
    async deposit(id: string, custodian: number): Promise<boolean> {
      if (!current() || !d.identity(custodian) || custodian === d.owner) return false;
      const p = await d.store.get(d.owner, 'envelope', id, d.now());
      return current() && p?.kind === 'envelope' && p.sender === d.owner && d.send(custodian, p);
    },
    /** Reply to the current envelope without waiting behind historical retry queues. */
    async reply(id: string, peer: number): Promise<boolean> {
      if (!current() || !d.identity(peer) || peer === d.owner) return false;
      const receipt = await d.store.get(d.owner, 'receipt', id, d.now());
      return current() && receipt?.kind === 'receipt' && receipt.recipient === d.owner && d.send(peer, receipt);
    },
    /** Receipt first; duplicate ciphertext is harmless and retained until expiry. */
    async flush(peer: number): Promise<number> {
      if (flushing || !current() || !d.identity(peer) || peer === d.owner) return 0;
      flushing = true;
      try {
        const packets = await d.store.list(d.owner, d.now());
        let sent = 0, attempted = 0;
        for (const p of packets.sort((a, b) => Number(b.kind === 'receipt') - Number(a.kind === 'receipt'))) {
          if (!current()) break;
          // Old account-paired packets can remain on disk after the trusted set
          // changes. Do not let an untrusted old row block today's paired queue.
          if (!d.identity(p.sender) || !d.identity(p.recipient)) continue;
          const hasReceipt = packets.some(r => r.kind === 'receipt' && r.id === p.id);
          // Recipient can return receipts via any paired custodian. Custodian forwards only to origin.
          const eligible = p.kind === 'receipt' ? (d.owner === p.recipient || peer === p.sender)
            : peer === p.recipient && !hasReceipt;
          if (eligible) {
            attempted++;
            if (await d.send(peer, p)) sent++;
            else break; // An offline peer must not cause one connection attempt per stored row.
          }
          if (attempted >= 20) break;
        }
        return sent;
      } finally { flushing = false; }
    },
    async status(id: string): Promise<'missing' | 'pending' | 'delivered'> {
      if (!current()) return 'missing';
      const p = await d.store.get(d.owner, 'envelope', id, d.now());
      if (!current() || !p || p.sender !== d.owner) return 'missing';
      const receipt = await d.store.get(d.owner, 'receipt', id, d.now());
      return !current() ? 'missing' : receipt ? 'delivered' : 'pending';
    },
  };
}
