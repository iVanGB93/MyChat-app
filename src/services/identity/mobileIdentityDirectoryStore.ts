import * as SQLite from 'expo-sqlite';
import { validateDirectoryRows, DIRECTORY_BYTES, type DirectoryRow, type DirectoryStore } from './identityDirectory';
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let tail: Promise<unknown> = Promise.resolve();
/** Public directory only; separate from credentials, inboxes, and admission pins. */
export function createMobileIdentityDirectoryStore(now = Date.now): DirectoryStore {
  const db = () => opening ??= SQLite.openDatabaseAsync('axonic_identity_directory_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS directory (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);');
    return database;
  }).catch(error => { opening = undefined; throw error; });
  return { transaction<T>(change: (rows: DirectoryRow[]) => T): Promise<T> {
    const result = tail.then(async () => {
      let value!: T;
      await (await db()).withExclusiveTransactionAsync(async tx => {
        const saved = await tx.getFirstAsync<{ data: string }>('SELECT data FROM directory WHERE id=1');
        if (saved && saved.data.length > DIRECTORY_BYTES) throw Error('Directory capacity exceeded');
        const rows: DirectoryRow[] = saved ? JSON.parse(saved.data) : []; validateDirectoryRows(rows, now());
        value = change(rows); validateDirectoryRows(rows, now());
        const data = JSON.stringify(rows);
        if (saved?.data !== data) await tx.runAsync('INSERT INTO directory(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', data);
      });
      return value;
    });
    tail = result.then(() => {}, () => {}); return result;
  } };
}
