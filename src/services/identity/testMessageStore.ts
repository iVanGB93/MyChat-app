import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';
// Keep the native handle alive across store factories and identity lock/unlock cycles.
let opening: Promise<SQLite.SQLiteDatabase> | undefined;

export type { TestRow } from './custodyCourierTypes';
import type { TestRow } from './custodyCourierTypes';
export type TestMessageStore = ReturnType<typeof createTestMessageStore>;
let writes: Promise<unknown> = Promise.resolve();
function write<T>(fn: () => Promise<T>): Promise<T> {
  const result = writes.then(fn); writes = result.catch(() => {}); return result;
}
function valid(row: TestRow) {
  return validAccountId(row.owner) && validAccountId(row.peer) && row.owner !== row.peer
    && /^[0-9a-f]{64}$/.test(row.id) && typeof row.text === 'string' && row.text.length > 0
    && new TextEncoder().encode(row.text).length <= 2048
    && ['in', 'out'].includes(row.direction) && row.state === (row.direction === 'in' ? 'delivered' : 'pending')
    && Number.isSafeInteger(row.created) && row.created >= 0;
}
/** Development probes only. Own text is plaintext in the app-private sandbox, NOT a production vault.
 * Never evict dedupe records automatically: doing so could redeliver an old retry.
 */
export function createTestMessageStore() {
  const db = () => opening ??= SQLite.openDatabaseAsync('axonic_test_messages_v2.db', { useNewConnection: true }).then(async database => {
    await database.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS test_messages (
        owner TEXT NOT NULL, peer TEXT NOT NULL, direction TEXT NOT NULL, id TEXT NOT NULL,
        text TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(owner, peer, direction, id));`);
    return database;
  }).catch(error => { opening = undefined; throw error; });
  return {
    put(row: TestRow, current: () => boolean): Promise<boolean> {
      const copy = { ...row };
      if (!valid(copy)) return Promise.resolve(false);
      return write(async () => {
        let accepted = false;
        await (await db()).withExclusiveTransactionAsync(async tx => {
          if (!current()) return;
          const old = await tx.getFirstAsync<TestRow>('SELECT * FROM test_messages WHERE owner=? AND peer=? AND direction=? AND id=?', copy.owner, copy.peer, copy.direction, copy.id);
          if (old) { accepted = current() && old.text === copy.text; return; }
          // Global and per-account bounds include receipts; never silently discard pending work.
          const count = await tx.getFirstAsync<{ total: number; owned: number }>('SELECT COUNT(*) AS total, COALESCE(SUM(owner=?),0) AS owned FROM test_messages', copy.owner);
          if (!current() || !count || count.total >= 1000 || count.owned >= 200) return;
          await tx.runAsync('INSERT INTO test_messages(owner,peer,direction,id,text,state,created) VALUES(?,?,?,?,?,?,?)',
            copy.owner, copy.peer, copy.direction, copy.id, copy.text, copy.state, copy.created);
          accepted = true;
        });
        return accepted && current();
      });
    },
    async list(owner: string): Promise<TestRow[]> {
      if (!validAccountId(owner)) return [];
      return (await db()).getAllAsync<TestRow>('SELECT * FROM test_messages WHERE owner=? ORDER BY created,id', owner);
    },
    update(row: TestRow, delivered: boolean, next: number, current: () => boolean) {
      return write(async () => {
        if (!current()) return;
        const database = await db(); if (!current()) return;
        await database.runAsync("UPDATE test_messages SET state=?, attempts=MIN(attempts+1,30), next=? WHERE owner=? AND peer=? AND direction='out' AND id=? AND state='pending'",
          delivered ? 'delivered' : 'pending', next, row.owner, row.peer, row.id);
      });
    },
    clear(owner: string) {
      if (!validAccountId(owner)) return Promise.resolve();
      return write(async () => { await (await db()).runAsync('DELETE FROM test_messages WHERE owner=?', owner); });
    },
  };
}
