import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';
import { validateCustodyRows, type CustodyRow, type CustodyStore } from './custodyService';
// Keep the native handle alive across store factories and identity lock/unlock cycles.
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let tail: Promise<unknown> = Promise.resolve();
/** Separate temporary relay database; never stores plaintext or private keys. */
export function createMobileCustodyStore(owner: string): CustodyStore {
  if (!validAccountId(owner)) throw Error('Invalid custody owner');
  const db = () => opening ??= SQLite.openDatabaseAsync('axonic_custody_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS custody (owner TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);');
    return database;
  }).catch(error => { opening = undefined; throw error; });
  return { transaction<T>(change: (rows: CustodyRow[]) => T): Promise<T> {
    const result = tail.then(async () => {
      let value!: T;
      await (await db()).withExclusiveTransactionAsync(async tx => {
        const saved = await tx.getFirstAsync<{ data: string }>('SELECT data FROM custody WHERE owner=?', owner);
        if (saved && saved.data.length > 512_000) throw Error('Custody store too large');
        const rows: CustodyRow[] = saved ? JSON.parse(saved.data) : []; validateCustodyRows(rows);
        value = change(rows); validateCustodyRows(rows);
        const data = JSON.stringify(rows);
        if (saved?.data !== data) await tx.runAsync('INSERT INTO custody(owner,data) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data', owner, data);
      });
      return value;
    });
    tail = result.catch(() => {}); return result;
  } };
}
