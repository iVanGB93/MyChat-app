import * as SQLite from 'expo-sqlite';
import { compareRecord, recordDigest, validAccountId, verifyRecord, type IdentityRecord } from './identityProtocol';
import type { IdentityRecordStore } from './identityAdmission';
// Keep the native handle alive across store factories and identity lock/unlock cycles.
let opening: Promise<SQLite.SQLiteDatabase> | undefined;

interface Row { account: string; record: string; digest: string }
// Expo opens a separate connection for each exclusive transaction. Concurrent
// first pins can fail with SQLITE_BUSY instead of returning a lost CAS. Serialize
// this database's writes across store instances; the SQL transaction remains atomic.
let pendingWrite: Promise<void> = Promise.resolve();
function serializeWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(work);
  pendingWrite = result.then(() => {}, () => {});
  return result;
}
/** A separate public-record database. No private keys, legacy accounts or chat rows. */
export function createMobileIdentityRecordStore(now: () => number, capacity = 256): IdentityRecordStore {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw Error('Invalid identity record capacity');
  const db = () => opening ??= SQLite.openDatabaseAsync('axonic_identity_records_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS identity_records (account TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL, digest TEXT NOT NULL);');
    return database;
  }).catch(error => { opening = undefined; throw error; });
  function parse(row: Row | null): IdentityRecord | null {
    if (!row) return null;
    if (row.record.length > 12_000) throw Error('Invalid stored identity');
    const record = JSON.parse(row.record);
    if (!verifyRecord(record, now(), true) || record.account !== row.account || recordDigest(record) !== row.digest) throw Error('Invalid stored identity');
    return record;
  }
  return {
    async read(account) {
      if (!validAccountId(account)) throw Error('Invalid account identifier');
      // Bounded primary-key read (one public record, <=12 KiB). Keep the same
      // signature/digest checks while avoiding per-chunk async bridge overhead.
      return parse((await db()).getFirstSync<Row>('SELECT account, record, digest FROM identity_records WHERE account = ?', account));
    },
    async compareAndSet(account, expectedDigest, next, history = []) {
      const snapshot = JSON.parse(JSON.stringify(next)) as IdentityRecord;
      const ancestry = JSON.parse(JSON.stringify(history)) as IdentityRecord[];
      if (snapshot.account !== account || !verifyRecord(snapshot, now())) return false;
      return serializeWrite(async () => {
        let accepted = false;
        await (await db()).withExclusiveTransactionAsync(async tx => {
          const row = await tx.getFirstAsync<Row>('SELECT account, record, digest FROM identity_records WHERE account = ?', account);
          const previous = parse(row);
          if ((row?.digest ?? null) !== expectedDigest || compareRecord(snapshot, previous, now(), ancestry) !== 'accept') return;
          const digest = recordDigest(snapshot);
          if (row?.digest === digest) { accepted = true; return; }
          if (!row) {
            const count = await tx.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM identity_records');
            if (!count || count.total >= capacity) return;
          }
          await tx.runAsync('INSERT INTO identity_records(account, record, digest) VALUES (?, ?, ?) ON CONFLICT(account) DO UPDATE SET record = excluded.record, digest = excluded.digest',
            account, JSON.stringify(snapshot), digest);
          accepted = true;
        });
        return accepted;
      });
    },
  };
}
