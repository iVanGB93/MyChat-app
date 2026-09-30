import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';

let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let writes: Promise<unknown> = Promise.resolve();
function db() {
  return opening ??= SQLite.openDatabaseAsync('axonic_chat_identity_pins_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS chat_identity_pins(
        owner INTEGER NOT NULL, peer INTEGER NOT NULL, account TEXT NOT NULL,
        PRIMARY KEY(owner,peer), UNIQUE(owner,account));`);
    return database;
  }).catch(error => { opening = undefined; throw error; });
}
const user = (id: number) => Number.isSafeInteger(id) && id > 0;
/** Local immutable migration pins. Only a verified authenticated binding exchange may call pin.
 * Separate owners may know the same peer; logout never transfers one owner's trust to another.
 */
export function createChatIdentityPinStore(owner: number) {
  if (!user(owner)) throw Error('Invalid pin owner');
  return {
    async read(peer: number): Promise<string | null> {
      if (!user(peer) || peer === owner) return null;
      const row = await (await db()).getFirstAsync<{ account: string }>('SELECT account FROM chat_identity_pins WHERE owner=? AND peer=?', owner, peer);
      if (row && !validAccountId(row.account)) throw Error('Invalid saved identity pin');
      return row?.account ?? null;
    },
    pin(peer: number, account: string, current: () => boolean): Promise<boolean> {
      if (!user(peer) || peer === owner || !validAccountId(account) || !current()) return Promise.resolve(false);
      const result = writes.then(async () => {
        let accepted = false;
        const cancelled = new Error('Binding interrupted');
        try {
          await (await db()).withExclusiveTransactionAsync(async tx => {
            if (!current()) return;
            const existing = await tx.getFirstAsync<{ account: string }>('SELECT account FROM chat_identity_pins WHERE owner=? AND peer=?', owner, peer);
            if (existing) { accepted = existing.account === account && current(); return; }
            const alias = await tx.getFirstAsync('SELECT peer FROM chat_identity_pins WHERE owner=? AND account=?', owner, account);
            const count = await tx.getFirstAsync<{ total: number; owned: number }>('SELECT COUNT(*) AS total,COALESCE(SUM(owner=?),0) AS owned FROM chat_identity_pins', owner);
            if (alias || !count || count.total >= 2048 || count.owned >= 256 || !current()) return;
            await tx.runAsync('INSERT INTO chat_identity_pins(owner,peer,account) VALUES(?,?,?)', owner, peer, account);
            if (!current()) throw cancelled;
            accepted = true;
          });
        } catch (error) { if (error !== cancelled) throw error; }
        return accepted && current();
      });
      writes = result.catch(() => {}); return result;
    },
  };
}
