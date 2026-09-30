import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { createIdentityAdmission, type IdentityRecordStore, type IdentityRequest } from './identityAdmission.ts';
import { validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';

export interface PeerIntroduction { account: string; expiresAt: number }
export interface IntroductionHooks {
  list(): PeerIntroduction[];
  received(peers: PeerIntroduction[]): void;
}
const LIMIT = 8;
const digest = (raw: string) => bytesToHex(sha256(utf8ToBytes(raw)));
interface Reply { version: 1; request: string; issuer: string; instance: string; device: string;
  issuedAt: number; expiresAt: number; peers: PeerIntroduction[]; signature: string }
const body = (r: Reply) => utf8ToBytes(JSON.stringify(['axonic-introductions-v1', r.version, r.request,
  r.issuer, r.instance, r.device, r.issuedAt, r.expiresAt, r.peers.map(p => [p.account, p.expiresAt])]));
function peersValid(peers: unknown, now: number, expires: number): peers is PeerIntroduction[] {
  return Array.isArray(peers) && peers.length <= LIMIT && new Set(peers.map(p => p?.account)).size === peers.length
    && peers.every(p => p && validAccountId(p.account) && Number.isSafeInteger(p.expiresAt)
      && p.expiresAt > now && p.expiresAt <= expires);
}
/** Reports only current direct connections. No contact list, addresses, messages or relayed gossip. */
export function createIntroductionService(d: {
  record: IdentityRecord; signingSeed: Uint8Array; instance: Uint8Array; store: IdentityRecordStore;
  now(): number; current(): boolean; peer(): IdentityPeer | null; list(): PeerIntroduction[];
}) {
  const admission = createIdentityAdmission({ ...d, account: d.record.account });
  const device = d.record.devices.find(p => p.signing === bytesToHex(ed25519.getPublicKey(d.signingSeed)))?.id;
  if (!device) throw Error('Unauthorized introduction signer');
  let nextAt = 0;
  return async (raw: string): Promise<string | null> => {
    const peer = d.peer();
    if (!peer || peer.expiresAt <= d.now() || !d.current() || d.now() < nextAt || raw.length > 16000) return null;
    nextAt = d.now() + 10_000;
    try {
      const request: IdentityRequest = JSON.parse(raw);
      if (request.operation !== 'lookup' || request.payload !== 'introductions-v1'
        || request.record.account !== peer.account || request.device !== peer.device) return null;
      const accepted = await admission.accept(raw);
      if (!accepted || !d.current() || d.peer() !== peer || peer.expiresAt <= d.now() || !verifyRecord(d.record, d.now())) return null;
      const issuedAt = d.now(), expiresAt = Math.min(issuedAt + 60_000, peer.expiresAt, d.record.expiresAt);
      const seen = new Set<string>();
      const peers = d.list().slice(0, 10).filter(p => {
        if (!validAccountId(p.account) || p.account === peer.account || p.account === d.record.account
          || seen.has(p.account) || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= issuedAt) return false;
        seen.add(p.account); return true;
      }).slice(0, LIMIT).map(p => ({ account: p.account, expiresAt: Math.min(p.expiresAt, expiresAt) }));
      const result: Reply = { version: 1, request: digest(raw), issuer: d.record.account,
        instance: admission.audience().instance, device, issuedAt, expiresAt, peers, signature: '' };
      result.signature = bytesToHex(ed25519.sign(body(result), d.signingSeed));
      return JSON.stringify(result);
    } catch { return null; }
  };
}
/** An introducer signs its observation, not the introduced account's ownership. */
export function verifyIntroductions(raw: string, request: string, peer: IdentityPeer, record: IdentityRecord, now: number): PeerIntroduction[] | null {
  try {
    if (raw.length > 4096 || peer.expiresAt <= now || !verifyRecord(record, now) || record.account !== peer.account) return null;
    const r: Reply = JSON.parse(raw), q: IdentityRequest = JSON.parse(request);
    if (r.version !== 1 || r.request !== digest(request) || r.issuer !== peer.account || r.device !== peer.device
      || r.instance !== peer.instance || q.target !== peer.account || q.instance !== peer.instance
      || q.operation !== 'lookup' || q.payload !== 'introductions-v1'
      || !Number.isSafeInteger(r.issuedAt) || r.issuedAt < 0 || r.issuedAt > now + 30_000
      || !Number.isSafeInteger(r.expiresAt) || r.expiresAt <= now || r.expiresAt <= r.issuedAt
      || r.expiresAt - r.issuedAt > 60_000 || !peersValid(r.peers, now, r.expiresAt)
      || !/^[0-9a-f]{128}$/.test(r.signature)) return null;
    const key = record.devices.find(p => p.id === peer.device)?.signing;
    if (!key || !ed25519.verify(hexToBytes(r.signature), body(r), hexToBytes(key), { zip215: false })) return null;
    return r.peers.filter(p => p.account !== q.record.account && p.account !== peer.account)
      .map(p => ({ account: p.account, expiresAt: Math.min(p.expiresAt, peer.expiresAt, record.expiresAt) }));
  } catch { return null; }
}
/** Memory-only hints. No record pinning or automatic dialing. Disconnect/lock clears sources. */
export function createIntroductionDirectory(now: () => number) {
  const sources = new Map<string, PeerIntroduction[]>();
  function prune() {
    for (const [source, peers] of sources) {
      const current = peers.filter(p => p.expiresAt > now());
      if (!current.length) sources.delete(source); else sources.set(source, current);
    }
  }
  return {
    replace(source: string, peers: PeerIntroduction[]) {
      prune();
      if (!validAccountId(source) || !peersValid(peers, now(), now() + 60_000)
        || (!sources.has(source) && sources.size >= 8)) return;
      sources.set(source, peers.map(p => ({ ...p })));
    },
    remove(source: string) { sources.delete(source); },
    clear() { sources.clear(); },
    snapshot() { prune(); return [...sources].flatMap(([via, peers]) => peers.map(p => ({ ...p, via }))); },
  };
}
