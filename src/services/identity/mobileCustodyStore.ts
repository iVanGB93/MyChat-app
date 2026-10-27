import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';
import { DEFAULT_CUSTODY_LIMITS, validateCustodyRows } from './custodyService';
import type {CustodyRow,CustodyStore} from './relayStorage';
// Keep the native handle alive across store factories and identity lock/unlock cycles.
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let tail: Promise<unknown> = Promise.resolve();
const revisions = new Map<string,number>();
/** Separate temporary relay database; never stores plaintext or private keys. */
export function createMobileCustodyStore(owner: string): CustodyStore & {inspect():Promise<CustodyRow[]>} {
  if (!validAccountId(owner)) throw Error('Invalid custody owner');
  const db = () => opening ??= SQLite.openDatabaseAsync('axonic_custody_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS custody (owner TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);');
    return database;
  }).catch(error => { opening = undefined; throw error; });
  return {revision:()=>revisions.get(owner)??0,async inspect(){const saved=await(await db()).getFirstAsync<{data:string}>('SELECT data FROM custody WHERE owner=?',owner);if(saved&&saved.data.length>DEFAULT_CUSTODY_LIMITS.bytes)throw Error('Custody store too large');const rows=saved?JSON.parse(saved.data):[];validateCustodyRows(rows);return rows;},transaction<T>(change: (rows: CustodyRow[]) => T): Promise<T> {
    const result = tail.then(async () => {
      let value!: T;
      let changed=false;
      await (await db()).withExclusiveTransactionAsync(async tx => {
        const saved = await tx.getFirstAsync<{ data: string }>('SELECT data FROM custody WHERE owner=?', owner);
        if (saved && saved.data.length > DEFAULT_CUSTODY_LIMITS.bytes) throw Error('Custody store too large');
        const rows: CustodyRow[] = saved ? JSON.parse(saved.data) : []; validateCustodyRows(rows);
        value = change(rows); validateCustodyRows(rows);
        const data = JSON.stringify(rows);
        changed=saved?.data!==data;
        if (saved?.data !== data) await tx.runAsync('INSERT INTO custody(owner,data) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data', owner, data);
      });
      if(changed)revisions.set(owner,(revisions.get(owner)??0)+1);
      return value;
    });
    tail = result.catch(() => {}); return result;
  } };
}
