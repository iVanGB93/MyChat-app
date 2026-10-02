import { recordDigest, validAccountId } from './identityProtocol.ts';
import { DIRECTORY_DOMAIN, DIRECTORY_LEASE, validDirectoryPacket, type DirectoryPacket } from './identityDirectory.ts';
/** request must be bounded and bind its response to the authenticated target axon.
 * Confirmations are session observations, not portable signatures or independent votes.
 */
export function createIdentityDirectoryReplication(d: {
  own(): DirectoryPacket | null; peers(): string[]; now(): number;
  request(peer: string, raw: string): Promise<string | null>;
}) {
  let generation = 0, running = false, stopped = false, digest: string | null = null;
  const copies = new Map<string, number>(), retry = new Map<string, number>();
  function state() {
    const packet = d.own();
    const next = !stopped && validDirectoryPacket(packet, d.now()) ? recordDigest(packet.record) : null;
    if (next !== digest) { generation++; digest = next; copies.clear(); retry.clear(); }
    const peers = [...new Set(d.peers())].filter(p => validAccountId(p) && p !== packet?.record.account).slice(0, 10);
    for (const [peer, until] of copies) if (until <= d.now() || !peers.includes(peer)) copies.delete(peer);
    for (const peer of retry.keys()) if (!peers.includes(peer)) retry.delete(peer);
    return { packet: next ? packet : null, peers };
  }
  return {
    snapshot() { state(); return { target: 3, confirmed: copies.size, replicas: [...copies].map(([peer, until]) => ({ peer, until })), publishing: running }; },
    async tick() {
      if (running || stopped) return;
      const { packet, peers } = state(); if (!packet) return;
      const ownGeneration = generation, expected = digest;
      running = true;
      try {
        for (const peer of peers) {
          state(); if (stopped || ownGeneration !== generation) return;
          if (copies.size >= 3) break;
          if (copies.has(peer) || (retry.get(peer) ?? 0) > d.now()) continue;
          retry.set(peer, d.now() + 30_000);
          let raw: string | null = null;
          try { raw = await d.request(peer, JSON.stringify({ domain: DIRECTORY_DOMAIN, operation: 'put', packet })); } catch { /* Try another reachable peer. */ }
          const current = state(); if (stopped || ownGeneration !== generation) return;
          if (!raw || raw.length > 1024 || !current.peers.includes(peer)) continue;
          try {
            const reply = JSON.parse(raw);
            if (reply.domain === DIRECTORY_DOMAIN && reply.status === 'stored' && reply.account === packet.record.account
              && reply.digest === expected && Number.isSafeInteger(reply.until) && reply.until > d.now() + 30_000
              && reply.until <= Math.min(d.now() + DIRECTORY_LEASE + 30_000, packet.record.expiresAt)) {
              copies.set(peer, Math.min(reply.until - 30_000, d.now() + DIRECTORY_LEASE)); retry.delete(peer);
            }
          } catch { /* Malformed responses never count. */ }
        }
      } finally { running = false; }
    },
    invalidate() { generation++; digest = null; copies.clear(); retry.clear(); },
    stop() { stopped = true; generation++; digest = null; copies.clear(); retry.clear(); },
  };
}
