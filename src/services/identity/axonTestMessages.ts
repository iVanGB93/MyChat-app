/** Development transport probe, not a production chat protocol. Persistence is supplied by the receiver.
 * Static device DH has no forward secrecy. Both socket nonces bind each packet.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { verifyRecord } from './identityProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';

/** Return true only after durable insertion or verification of an identical saved message. */
export type TestMessageHandler = (message: { from: string; id: string; text: string }) => boolean | Promise<boolean>;
type Packet = { version: 2; kind: 'text' | 'ack'; id: string; nonce: string; ciphertext: string };
const hex = (s: unknown, bytes: number): s is string => typeof s === 'string' && s.length === bytes * 2 && /^[0-9a-f]+$/.test(s);
export function createAxonTestMessages(d: {
  local: { account: string; device: string; instance: string }; encryptionSeed: Uint8Array;
  peer(): IdentityPeer | null; store: IdentityRecordStore; now(): number; current(): boolean;
  random(n: number): Promise<Uint8Array>; send(raw: string): void; received: TestMessageHandler;
}, purpose: 'test' | 'normal' = 'test') {
  let stopped = false, sending = false, receiving = false;
  const seen = new Set<string>();
  let pending: { id: string; digest: string; done(ok: boolean): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const alive = () => !stopped && d.current();
  const finish = (ok: boolean) => { const p = pending; pending = null; if (p) { clearTimeout(p.timer); p.done(ok); } };
  async function context(outgoing: boolean, kind: Packet['kind'], id: string) {
    const peer = d.peer();
    if (!alive() || !peer || peer.expiresAt <= d.now()) throw Error('Test peer unavailable');
    const record = await d.store.read(peer.account);
    const remoteDevice = record?.devices.find(v => v.id === peer.device);
    if (!alive() || d.peer() !== peer || peer.expiresAt <= d.now() || !record || record.account !== peer.account || !verifyRecord(record, d.now())
      || !remoteDevice) throw Error('Test peer key unavailable');
    const local = [d.local.account, d.local.device, d.local.instance];
    const remote = [peer.account, peer.device, peer.instance];
    const aad = utf8ToBytes(JSON.stringify([purpose === 'normal' ? 'axonic-chat-message-v1' : 'axonic-test-message-v2', kind, id,
      ...(outgoing ? [local, remote] : [remote, local])]));
    const shared = x25519.getSharedSecret(d.encryptionSeed, hexToBytes(remoteDevice.encryption));
    try { return { aad, key: hkdf(sha256, shared, sha256(aad), utf8ToBytes(purpose === 'normal' ? 'axonic-chat-message-key-v1' : 'axonic-test-message-key-v2'), 32), peer }; }
    finally { shared.fill(0); }
  }
  async function seal(kind: Packet['kind'], id: string, text: string): Promise<Packet> {
    const nonce = await d.random(24);
    if (nonce.length !== 24) throw Error('Invalid nonce');
    const c = await context(true, kind, id), plaintext = utf8ToBytes(text);
    try { return { version: 2, kind, id, nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(xchacha20poly1305(c.key, nonce, c.aad).encrypt(plaintext)) }; }
    finally { c.key.fill(0); plaintext.fill(0); }
  }
  return {
    async send(text: string, messageId?: string): Promise<boolean> {
      if (!alive() || sending || pending || typeof text !== 'string' || !text.length || text.length > 2048
        || utf8ToBytes(text).length > 2048) return false;
      sending = true;
      try {
        const random = messageId === undefined ? await d.random(32) : null;
        if ((random && random.length !== 32) || (messageId !== undefined && !hex(messageId, 32))) return false;
        const id = messageId ?? bytesToHex(random!), packet = await seal('text', id, text);
        if (!alive()) return false;
        return await new Promise<boolean>(resolve => {
          pending = { id, digest: bytesToHex(sha256(utf8ToBytes(JSON.stringify(packet)))), done: resolve,
            timer: setTimeout(() => finish(false), 5000) };
          try { d.send(JSON.stringify(packet)); } catch { finish(false); }
        });
      } catch { return false; }
      finally { sending = false; }
    },
    async receive(raw: string): Promise<boolean> {
      if (!alive() || receiving || typeof raw !== 'string' || raw.length > 5000) return false;
      receiving = true;
      let key: Uint8Array | undefined, plaintext: Uint8Array | undefined;
      try {
        const p: Packet = JSON.parse(raw);
        if (p.version !== 2 || !['text', 'ack'].includes(p.kind) || !hex(p.id, 32) || !hex(p.nonce, 24)
          || typeof p.ciphertext !== 'string' || p.ciphertext.length < 34 || p.ciphertext.length > 4128
          || !/^(?:[0-9a-f]{2})+$/.test(p.ciphertext) || (p.kind === 'text' && (seen.has(p.nonce) || seen.size >= 64))) return false;
        const c = await context(false, p.kind, p.id); key = c.key;
        plaintext = xchacha20poly1305(key, hexToBytes(p.nonce), c.aad).decrypt(hexToBytes(p.ciphertext));
        const text = new TextDecoder().decode(plaintext);
        if (bytesToHex(utf8ToBytes(text)) !== bytesToHex(plaintext) || !alive()) return false;
        if (p.kind === 'ack') {
          if (!pending || pending.id !== p.id || text !== pending.digest) return false;
          finish(true); return true;
        }
        if (!text.length || plaintext.length > 2048) return false;
        seen.add(p.nonce);
        if (!await d.received({ from: c.peer.account, id: p.id, text }) || !alive()) return false;
        const ack = await seal('ack', p.id, bytesToHex(sha256(utf8ToBytes(raw))));
        if (!alive()) return false;
        d.send(JSON.stringify(ack)); return true;
      } catch { return false; }
      finally { key?.fill(0); plaintext?.fill(0); receiving = false; }
    },
    stop() { stopped = true; seen.clear(); finish(false); },
  };
}

/** Separate cryptographic domain; a renamed experimental frame cannot become normal chat. */
export const createAxonNormalMessages = (d: Parameters<typeof createAxonTestMessages>[0]) => createAxonTestMessages(d, 'normal');
