import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';
import type { CustodyEnvelope } from './custodyProtocol';
// Keep the native handle alive across store factories and identity lock/unlock cycles.
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
export interface OwnCustodyRow { owner: string; id: string; envelope: CustodyEnvelope; relay: string | null }
export interface OwnCustodyStore {
  get(owner: string, id: string): Promise<OwnCustodyRow | null>;
  save(owner: string, envelope: CustodyEnvelope, current: () => boolean): Promise<OwnCustodyRow | null>;
  held(owner: string, id: string, relay: string, current: () => boolean): Promise<void>;
  clear(owner: string): Promise<void>;
}
let writes: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>) => { const result = writes.then(fn); writes = result.catch(() => {}); return result; };
/** Own outgoing encrypted envelopes, retained to verify receipts and reuse exact ciphertext after restart. */
export function createOwnCustodyStore(): OwnCustodyStore {
  const db = () => opening ??= SQLite.openDatabaseAsync('axonic_own_custody_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS own_custody(owner TEXT NOT NULL,id TEXT NOT NULL,envelope TEXT NOT NULL,relay TEXT,PRIMARY KEY(owner,id));'); return database;
  }).catch(error => { opening = undefined; throw error; });
  const decode = (row: { owner: string; id: string; envelope: string; relay: string | null } | null): OwnCustodyRow | null => {
    if (!row) return null;
    if (row.envelope.length > 7000) throw Error('Invalid saved envelope');
    const envelope = JSON.parse(row.envelope) as CustodyEnvelope;
    if (envelope.sender !== row.owner || envelope.id !== row.id || envelope.kind !== 'envelope') throw Error('Invalid saved envelope');
    return { ...row, envelope };
  };
  return {
    async get(owner, id) { return decode(await (await db()).getFirstAsync('SELECT * FROM own_custody WHERE owner=? AND id=?', owner, id)); },
    save(owner, envelope, current) {
      const raw = JSON.stringify(envelope);
      if (!validAccountId(owner) || envelope.sender !== owner || raw.length > 7000) return Promise.resolve(null);
      return serial(async () => {
        let result: OwnCustodyRow | null = null;
        await (await db()).withExclusiveTransactionAsync(async tx => {
          if (!current()) return;
          const existing = decode(await tx.getFirstAsync('SELECT * FROM own_custody WHERE owner=? AND id=?', owner, envelope.id));
          if (existing) { result = existing; return; }
          const count = await tx.getFirstAsync<{ total: number; owned: number }>('SELECT COUNT(*) AS total,COALESCE(SUM(owner=?),0) AS owned FROM own_custody', owner);
          if (!count || count.total >= 1000 || count.owned >= 200 || !current()) return;
          await tx.runAsync('INSERT INTO own_custody(owner,id,envelope,relay) VALUES(?,?,?,NULL)', owner, envelope.id, raw);
          result = { owner, id: envelope.id, envelope: JSON.parse(raw), relay: null };
        });
        return current() ? result : null;
      });
    },
    held(owner, id, relay, current) { return serial(async () => { const database = await db(); if (current()) await database.runAsync('UPDATE own_custody SET relay=? WHERE owner=? AND id=?', relay, owner, id); }); },
    clear(owner) { return serial(async () => { await (await db()).runAsync('DELETE FROM own_custody WHERE owner=?', owner); }); },
  };
}
