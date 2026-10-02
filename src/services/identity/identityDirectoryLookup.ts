import { DIRECTORY_DOMAIN, DIRECTORY_LEASE, validDirectoryPacket, type DirectoryPacket } from './identityDirectory.ts';
import { compareRecord, HISTORY_BYTES, HISTORY_RECORDS, recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
export type DirectoryLookupResult = {
  status: 'found' | 'conflict' | 'missing-history' | 'stale' | 'not-found' | 'unavailable' | 'cancelled' | 'busy' | 'invalid';
  queried: number; answered: number; rejected: number; sources: string[]; packet?: DirectoryPacket;
};
export const unavailableDirectoryLookup = (): DirectoryLookupResult => ({ status: 'unavailable', queried: 0, answered: 0, rejected: 0, sources: [] });
/** Read-only lookup. Valid signatures prove authorship, never global freshness or quorum independence.
 * Transport must bind replies to authenticated peers and bound each request's lifetime.
 */
export function createIdentityDirectoryLookup(d: {
  pins: Pick<IdentityRecordStore, 'read'>; current(): boolean; peers(): string[]; now(): number;
  request(peer: string, raw: string): Promise<string | null>;
}) {
  let generation = 0, busy = false, stopped = false;
  return {
    async lookup(account: string): Promise<DirectoryLookupResult> {
      const result = (status: DirectoryLookupResult['status'], extra: Partial<DirectoryLookupResult> = {}): DirectoryLookupResult =>
        ({ status, queried: 0, answered: 0, rejected: 0, sources: [], ...extra });
      if (!validAccountId(account)) return result('invalid');
      if (stopped || !d.current()) return result('cancelled');
      if (busy) return result('busy');
      busy = true; const epoch = generation;
      const current = () => !stopped && epoch === generation && d.current();
      try {
        const peers = [...new Set(d.peers())].filter(validAccountId).slice(0, 10);
        if (!peers.length) return result('unavailable');
        const replies = await Promise.all(peers.map(async peer => {
          try { return { peer, raw: await d.request(peer, JSON.stringify({ domain: DIRECTORY_DOMAIN, operation: 'get', account })) }; }
          catch { return { peer, raw: null }; }
        }));
        if (!current()) return result('cancelled');
        // Re-read after the network round trip: admission may have learned a newer record meanwhile.
        const anchor = await d.pins.read(account);
        if (!current()) return result('cancelled');
        if (anchor && (!verifyRecord(anchor, d.now(), true) || anchor.account !== account)) return result('unavailable');
        let answered = 0, rejected = 0;
        const candidates: { peer: string; packet: DirectoryPacket }[] = [];
        const reachable = new Set(d.peers());
        for (const { peer, raw } of replies) {
          try {
            if (!reachable.has(peer) || !raw || raw.length > 13_000) { rejected++; continue; }
            const reply = JSON.parse(raw);
            if (reply.domain !== DIRECTORY_DOMAIN) { rejected++; continue; }
            if (reply.status === 'not-found') { answered++; continue; }
            if (reply.status !== 'found' || !validDirectoryPacket(reply.packet, d.now()) || reply.packet.record.account !== account
              || !Number.isSafeInteger(reply.until) || reply.until <= d.now() + 30_000
              || reply.until > Math.min(d.now() + DIRECTORY_LEASE + 30_000, reply.packet.record.expiresAt)) { rejected++; continue; }
            answered++; candidates.push({ peer, packet: reply.packet });
          } catch { rejected++; }
        }
        const stats = { queried: peers.length, answered, rejected };
        if (!candidates.length) return result(answered ? 'not-found' : 'unavailable', stats);
        const revisions = new Map<number, IdentityRecord>();
        const add = (record: IdentityRecord) => {
          const previous = revisions.get(record.revision);
          if (previous && recordDigest(previous) !== recordDigest(record)) return false;
          revisions.set(record.revision, record); return true;
        };
        if (anchor) add(anchor);
        for (const { packet } of candidates) for (const record of [...packet.history, packet.record]) {
          if (!add(record)) return result('conflict', stats);
        }
        const highest = candidates.reduce((a, b) => a.packet.record.revision > b.packet.record.revision ? a : b).packet.record;
        if (anchor && highest.revision < anchor.revision) return result('stale', stats);
        // Merge only a bounded, contiguous suffix of individually root-signed history.
        const history: IdentityRecord[] = [];
        for (let revision = highest.revision - 1; revision >= 0 && history.length < HISTORY_RECORDS; revision--) {
          const previous = revisions.get(revision); if (!previous) break;
          const next = history[0] ?? highest;
          if (next.previous !== recordDigest(previous) || next.issuedAt < previous.issuedAt) return result('conflict', stats);
          history.unshift(previous);
          if (new TextEncoder().encode(JSON.stringify(history)).length > HISTORY_BYTES) { history.shift(); break; }
        }
        for (const previous of [anchor, ...candidates.map(c => c.packet.record)]) {
          if (!previous) continue;
          const decision = compareRecord(highest, previous, d.now(), history);
          if (decision === 'conflict') return result('conflict', stats);
          if (decision !== 'accept') return result('missing-history', stats);
        }
        if (!current()) return result('cancelled');
        return result('found', { ...stats, packet: { record: highest, history },
          sources: candidates.filter(c => recordDigest(c.packet.record) === recordDigest(highest)).map(c => c.peer) });
      } catch { return result(current() ? 'unavailable' : 'cancelled'); }
      finally { busy = false; }
    },
    invalidate() { generation++; },
    stop() { stopped = true; generation++; },
  };
}
