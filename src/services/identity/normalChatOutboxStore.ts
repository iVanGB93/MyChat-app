import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';
export interface NormalChatOutgoingBinding {
  owner: string; messageId: string; transportId: string; peer: string; peerUser: number; digest: string;
}
export interface NormalChatOutboxStore {
  find(owner: string, transportId: string): Promise<NormalChatOutgoingBinding | null>;
  bind(row: NormalChatOutgoingBinding, current: () => boolean): Promise<boolean>;
}
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let tail: Promise<unknown> = Promise.resolve();
const hex = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function valid(r: NormalChatOutgoingBinding) {
  return !!r && validAccountId(r.owner) && validAccountId(r.peer) && r.owner !== r.peer
    && typeof r.messageId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.messageId)
    && hex(r.transportId) && hex(r.digest) && Number.isSafeInteger(r.peerUser) && r.peerUser > 0;
}
function decode(row: { data: string } | null): NormalChatOutgoingBinding | null {
  if (!row) return null;
  if (row.data.length > 1000) throw Error('Invalid normal outbox binding');
  const r = JSON.parse(row.data); if (!valid(r)) throw Error('Invalid normal outbox binding'); return r;
}
function db() {
  return opening ??= SQLite.openDatabaseAsync('axonic_normal_outbox_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS normal_outbox(owner TEXT NOT NULL, message_id TEXT NOT NULL,
        transport_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,message_id), UNIQUE(owner,transport_id));`);
    return database;
  }).catch(error => { opening = undefined; throw error; });
}
/** Immutable mapping to the original normal message, not another plaintext message queue. */
export function createNormalChatOutboxStore(): NormalChatOutboxStore {
  return {
    async find(owner, transportId) {
      const row = decode(await (await db()).getFirstAsync('SELECT data FROM normal_outbox WHERE owner=? AND transport_id=?', owner, transportId));
      if (row && (row.owner !== owner || row.transportId !== transportId)) throw Error('Invalid normal outbox ownership');
      return row;
    },
    bind(input, current) {
      const row = { ...input }; if (!valid(row) || !current()) return Promise.resolve(false);
      const data = JSON.stringify(row);
      const result = tail.then(async () => {
        let accepted = false;
        await (await db()).withExclusiveTransactionAsync(async tx => {
          if (!current()) return;
          const old = decode(await tx.getFirstAsync('SELECT data FROM normal_outbox WHERE owner=? AND (message_id=? OR transport_id=?)', row.owner, row.messageId, row.transportId));
          if (old) { accepted = Object.keys(row).every(key => old[key as keyof typeof row] === row[key as keyof typeof row]); return; }
          const count = await tx.getFirstAsync<{ total: number; owned: number }>('SELECT COUNT(*) AS total,COALESCE(SUM(owner=?),0) AS owned FROM normal_outbox', row.owner);
          if (!count || count.total >= 2048 || count.owned >= 256 || !current()) return;
          await tx.runAsync('INSERT INTO normal_outbox(owner,message_id,transport_id,data) VALUES(?,?,?,?)', row.owner, row.messageId, row.transportId, data);
          accepted = true;
        });
        return accepted && current();
      });
      tail = result.catch(() => {}); return result;
    },
  };
}
