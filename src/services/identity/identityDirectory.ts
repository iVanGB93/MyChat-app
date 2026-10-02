import { compareRecord, recordDigest, validAccountId, validRecordHistory, verifyRecord, type IdentityRecord } from './identityProtocol.ts';
export const DIRECTORY_DOMAIN = 'axonic-identity-directory-v1';
export const DIRECTORY_LIMIT = 256, DIRECTORY_BYTES = 3_200_000, DIRECTORY_LEASE = 60 * 60 * 1000;
export interface DirectoryPacket { record: IdentityRecord; history: IdentityRecord[] }
export interface DirectoryRow extends DirectoryPacket { availableUntil: number }
/** Serialize transactions across instances; commit atomically or reject. Never evict revision anchors. */
export interface DirectoryStore { transaction<T>(change: (rows: DirectoryRow[]) => T): Promise<T> }
const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k));
const publicFieldsOnly = (r: IdentityRecord) => exactKeys(r, ['version', 'account', 'root', 'revision', 'previous', 'issuedAt', 'expiresAt', 'devices', 'signature'])
  && r.devices.every(device => exactKeys(device, ['id', 'signing', 'encryption']));
export function validDirectoryPacket(value: unknown, now: number, expired = false): value is DirectoryPacket {
  try {
    const p = value as DirectoryPacket;
    return !!p && exactKeys(p, ['record', 'history']) && JSON.stringify(p).length <= 12_000 && verifyRecord(p.record, now, expired)
      && validRecordHistory(p.history, p.record, now) && publicFieldsOnly(p.record) && p.history.every(publicFieldsOnly);
  } catch { return false; }
}
export function validateDirectoryRows(rows: unknown, now: number): asserts rows is DirectoryRow[] {
  if (!Array.isArray(rows) || rows.length > DIRECTORY_LIMIT || JSON.stringify(rows).length > DIRECTORY_BYTES) throw Error('Directory capacity exceeded');
  const accounts = new Set<string>();
  for (const row of rows) {
    if (!validDirectoryPacket({ record: row?.record, history: row?.history }, now, true)
      || !Number.isSafeInteger(row.availableUntil) || row.availableUntil < 0 || row.availableUntil > row.record.expiresAt
      || accounts.has(row.record.account)) throw Error('Invalid directory storage');
    accounts.add(row.record.account);
  }
}
/** Authenticated peer comes from the axon, never from the request body.
 * A stored reply confirms a committed copy, not permission to update an identity.
 * Expiration hides records from lookup; retained revisions prevent rollback on this replica.
 */
export function createIdentityDirectory(d: { store: DirectoryStore; now(): number; current(): boolean }) {
  let pending = 0;
  const response = (status: string, extra: object = {}) => JSON.stringify({ domain: DIRECTORY_DOMAIN, status, ...extra });
  return {
    async receive(peer: string, raw: string): Promise<string> {
      if (!d.current() || !validAccountId(peer) || typeof raw !== 'string' || raw.length > 13_000 || pending >= 8) return response('rejected');
      pending++;
      try {
        const request = JSON.parse(raw);
        if (request?.domain !== DIRECTORY_DOMAIN) return response('rejected');
        if (request.operation === 'put') {
          const packet = request.packet;
          if (!validDirectoryPacket(packet, d.now()) || packet.record.account !== peer) return response('rejected');
          const result = await d.store.transaction(rows => {
            validateDirectoryRows(rows, d.now());
            if (!d.current() || !validDirectoryPacket(packet, d.now())) return response('rejected');
            const index = rows.findIndex(r => r.record.account === peer), previous = index < 0 ? null : rows[index];
            const decision = compareRecord(packet.record, previous?.record ?? null, d.now(), packet.history);
            if (decision !== 'accept') return response(decision);
            if (index < 0 && rows.length >= DIRECTORY_LIMIT) return response('full');
            // An identical re-publication cannot strip useful ancestry already retained.
            const history = previous && recordDigest(previous.record) === recordDigest(packet.record)
              && previous.history.length > packet.history.length ? previous.history : packet.history;
            const next: DirectoryRow = JSON.parse(JSON.stringify({ record: packet.record, history,
              availableUntil: Math.min(d.now() + DIRECTORY_LEASE, packet.record.expiresAt) }));
            if (index < 0) rows.push(next); else rows[index] = next;
            validateDirectoryRows(rows, d.now());
            return response('stored', { account: peer, digest: recordDigest(next.record), until: next.availableUntil });
          });
          // The transaction's promise resolves only after the durable commit.
          if (!d.current() || !verifyRecord(packet.record, d.now())) return response('rejected');
          const parsed = JSON.parse(result);
          return parsed.status === 'stored' && parsed.until <= d.now() ? response('rejected') : result;
        }
        if (request.operation === 'get' && validAccountId(request.account)) {
          const result = await d.store.transaction(rows => {
            validateDirectoryRows(rows, d.now());
            if (!d.current()) return response('rejected');
            const row = rows.find(r => r.record.account === request.account);
            return row && row.availableUntil > d.now() && verifyRecord(row.record, d.now())
              ? response('found', { packet: { record: row.record, history: row.history }, until: row.availableUntil }) : response('not-found');
          });
          if (!d.current()) return response('rejected');
          const parsed = JSON.parse(result);
          return parsed.status === 'found' && parsed.until <= d.now() ? response('not-found') : result;
        }
        return response('rejected');
      } catch { return response('rejected'); }
      finally { pending--; }
    },
  };
}
