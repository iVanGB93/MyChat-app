import * as SQLite from 'expo-sqlite';
import { parseMailboxPacket, signedBody, type MailboxPacket, type MailboxStore } from './mailboxProtocol';

let database: Promise<SQLite.SQLiteDatabase> | undefined;
function db() {
  if (!database) database = SQLite.openDatabaseAsync('axonic_mailbox_dev_v1.db').then(async database => {
    await database.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS packets (
        owner INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, expires INTEGER NOT NULL,
        wire TEXT NOT NULL, PRIMARY KEY(owner, kind, id));
      CREATE TABLE IF NOT EXISTS pins (
        owner INTEGER NOT NULL, peer INTEGER NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(owner, peer));
      CREATE TABLE IF NOT EXISTS outgoing (
        owner INTEGER NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL,
        custody INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS configuration (
        owner INTEGER PRIMARY KEY NOT NULL, wire TEXT NOT NULL);`);
    return database;
  }).catch(error => { database = undefined; throw error; });
  return database;
}
type Row = { wire: string };
/** Public routing configuration only; private keys remain in AndroidKeyStore. */
export async function readMailboxConfiguration(owner: number): Promise<unknown> {
  const row = await (await db()).getFirstAsync<Row>('SELECT wire FROM configuration WHERE owner=?', owner);
  return row ? JSON.parse(row.wire) : null;
}
export async function writeMailboxConfiguration(owner: number, value: unknown, current: () => boolean) {
  if (!Number.isSafeInteger(owner) || owner < 1) throw new Error('Invalid mailbox owner');
  const wire = value === null ? null : JSON.stringify(value);
  if (wire === undefined) throw new Error('Invalid mailbox configuration');
  if (wire && wire.length > 8192) throw new Error('Mailbox configuration too large');
  await (await db()).withExclusiveTransactionAsync(async tx => {
    if (!current()) throw new Error('Mailbox configuration changed');
    if (wire === null) await tx.runAsync('DELETE FROM configuration WHERE owner=?', owner);
    else await tx.runAsync('INSERT OR REPLACE INTO configuration(owner,wire) VALUES(?,?)', owner, wire);
  });
}
export const mailboxStore: MailboxStore = {
  async get(owner, kind, id, now) {
    const database = await db();
    await database.runAsync('DELETE FROM packets WHERE expires <= ?', now);
    const row = await database.getFirstAsync<Row>('SELECT wire FROM packets WHERE owner=? AND kind=? AND id=?', owner, kind, id);
    return row ? parseMailboxPacket(row.wire, now) : null;
  },
  async put(owner, packet, now) {
    const wire = JSON.stringify(packet);
    if (!parseMailboxPacket(wire, now)) return false;
    const database = await db();
    let accepted = false;
    await database.withExclusiveTransactionAsync(async tx => {
      await tx.runAsync('DELETE FROM packets WHERE expires <= ?', now);
      const old = await tx.getFirstAsync<Row>('SELECT wire FROM packets WHERE owner=? AND kind=? AND id=?', owner, packet.kind, packet.id);
      if (old) {
        const existing = parseMailboxPacket(old.wire, now);
        accepted = !!existing && signedBody(existing) === signedBody(packet);
        return;
      }
      // Separate receipt capacity prevents a full envelope queue blocking confirmations.
      const count = await tx.getFirstAsync<{ total: number; own: number }>(
        'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN owner=? AND kind=? THEN 1 ELSE 0 END),0) AS own FROM packets', owner, packet.kind);
      if (!count || count.total >= 800 || count.own >= 100) return;
      await tx.runAsync('INSERT INTO packets(owner,kind,id,expires,wire) VALUES(?,?,?,?,?)', owner, packet.kind, packet.id, packet.expiresAt, wire);
      accepted = true;
    });
    return accepted;
  },
  async list(owner, now): Promise<MailboxPacket[]> {
    const database = await db();
    await database.runAsync('DELETE FROM packets WHERE expires <= ?', now);
    const rows = await database.getAllAsync<Row>('SELECT wire FROM packets WHERE owner=? ORDER BY expires LIMIT 200', owner);
    return rows.map(row => parseMailboxPacket(row.wire, now)).filter((p): p is MailboxPacket => !!p);
  },
};

export async function getMailboxOutgoing(owner: number, id: string, now: number) {
  const database = await db();
  await database.runAsync('DELETE FROM outgoing WHERE expires<=?', now);
  return database.getFirstAsync<{ digest: string; custody: number }>('SELECT digest,custody FROM outgoing WHERE owner=? AND id=?', owner, id);
}
export async function bindMailboxOutgoing(owner: number, id: string, digest: string, expires: number) {
  const database = await db();
  await database.withExclusiveTransactionAsync(async tx => {
    await tx.runAsync('DELETE FROM outgoing WHERE expires<=?', Date.now());
    const old = await tx.getFirstAsync<{ digest: string }>('SELECT digest FROM outgoing WHERE owner=? AND id=?', owner, id);
    if (old && old.digest !== digest) throw new Error('Mailbox outgoing identity collision');
    if (!old) {
      const count = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outgoing');
      if (!count || count.n >= 400) throw new Error('Mailbox outgoing capacity reached');
      await tx.runAsync('INSERT INTO outgoing(owner,id,digest,expires) VALUES(?,?,?,?)', owner, id, digest, expires);
    }
  });
}
export async function markMailboxCustody(owner: number, id: string) {
  await (await db()).runAsync('UPDATE outgoing SET custody=1 WHERE owner=? AND id=?', owner, id);
}

/** Explicit pins or introductions attested by an explicitly pinned neuron; never replace keys. */
export async function pinMailboxIdentities(owner: number, identities: ReadonlyArray<{ user: number; encryption: string; signing: string }>, current: () => boolean = () => true): Promise<void> {
  if (identities.length < 1 || identities.length > 8) throw new Error('Pair at most eight test identities');
  const database = await db();
  await database.withExclusiveTransactionAsync(async tx => {
    for (const identity of identities) {
      if (!current()) throw new Error('Mailbox pairing changed');
      const wire = JSON.stringify([identity.encryption, identity.signing]);
      const old = await tx.getFirstAsync<{ identity: string }>('SELECT identity FROM pins WHERE owner=? AND peer=?', owner, identity.user);
      if (old && old.identity !== wire) throw new Error('Mailbox identity changed; explicit key recovery is required');
      if (!old) {
        const count = await tx.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM pins');
        if (!count || count.total >= 32) throw new Error('Mailbox pin capacity reached');
        await tx.runAsync('INSERT INTO pins(owner,peer,identity) VALUES(?,?,?)', owner, identity.user, wire);
      }
    }
  });
}
