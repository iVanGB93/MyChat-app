import { canArchiveCallJournal } from './durableCallControl';
import * as SQLite from 'expo-sqlite';
import { validAccountId } from './identityProtocol';
import type { CallJournalStore } from './durableCallControl';
import type { CallControl } from './callControlProtocol';
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(work:()=>Promise<T>):Promise<T> {
  const result=tail.then(work);tail=result.catch(()=>{});return result;
}
function db() {
  return opening ??= SQLite.openDatabaseAsync('axonic_call_control_v1.db', { useNewConnection: true }).then(async database => {
    await database.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS call_journal(owner TEXT NOT NULL, call_id TEXT NOT NULL,
      data TEXT NOT NULL, PRIMARY KEY(owner,call_id));
      CREATE TABLE IF NOT EXISTS call_history(owner TEXT NOT NULL, call_id TEXT NOT NULL,
      data TEXT NOT NULL, archived_at INTEGER NOT NULL, PRIMARY KEY(owner,call_id));`);
    return database;
  }).catch(error => { opening = undefined; throw error; });
}
function key(owner: string, callId: string) {
  if (!validAccountId(owner) || !/^[0-9a-f]{64}$/.test(callId)) throw Error('Invalid call journal key');
}
export interface OwnCallSummary {id:string;peer:string;outgoing:boolean;media:'voice'|'video';at:number}
/** Display-only own history; it cannot authorize signaling or recreate a call. */
export async function listOwnCallHistory(owner:string):Promise<OwnCallSummary[]>{
 if(!validAccountId(owner))throw Error('Invalid call owner');
 return serial(async()=>{
  const database=await db(),active=await database.getAllAsync<{call_id:string;data:string}>('SELECT call_id,data FROM call_journal WHERE owner=? LIMIT 64',owner);
  const archived=await database.getAllAsync<{call_id:string;data:string}>('SELECT call_id,data FROM call_history WHERE owner=? ORDER BY archived_at DESC LIMIT 100',owner);
  const calls=new Map<string,OwnCallSummary>();
  for(const row of [...active,...archived]){
   if(row.data.length>800000)throw Error('Oversized call history');const journal=JSON.parse(row.data);
   if(journal.owner!==owner||journal.callId!==row.call_id||!Array.isArray(journal.entries)||!journal.entries.length)throw Error('Invalid own call history');
   const event=JSON.parse(journal.entries[0].raw) as CallControl;
   if(event.callId!==row.call_id||!validAccountId(event.caller)||!validAccountId(event.callee)||event.caller===event.callee
    ||!['voice','video'].includes(event.media)||!Number.isSafeInteger(event.issuedAt)||![event.caller,event.callee].includes(owner))throw Error('Invalid own call history');
   calls.set(event.callId,{id:event.callId,peer:event.caller===owner?event.callee:event.caller,outgoing:event.caller===owner,media:event.media,at:event.issuedAt});
  }return [...calls.values()].sort((a,b)=>b.at-a.at).slice(0,100);
 });
}
/** Bounded own-call inventory for restart recovery, never a public network directory. */
export async function listMobileCallJournals(owner: string, pendingAt?: number): Promise<CallControl[]> {
  return serial(async()=>{
  if (!validAccountId(owner)) throw Error('Invalid call owner');
  const rows=await (await db()).getAllAsync<{call_id:string;data:string}>('SELECT call_id,data FROM call_journal WHERE owner=? ORDER BY call_id LIMIT 64',owner);
  return rows.flatMap(row=>{
    if(row.data.length>800000)throw Error('Oversized call journal');
    const journal=JSON.parse(row.data);
    if(journal.owner!==owner||journal.callId!==row.call_id||!Array.isArray(journal.entries)||!journal.entries.length)throw Error('Invalid call inventory');
    // Inventory is only a scheduling hint. Full durable admission still verifies every event.
    // Expired own events cannot be sent; avoid repeatedly restoring their historical signatures.
    if(pendingAt!==undefined&&!journal.entries.some((entry:{raw:string})=>{
      const e=JSON.parse(entry.raw);return e.record?.account===owner&&Number.isSafeInteger(e.expiresAt)&&e.expiresAt>pendingAt;
    }))return [];
    return [JSON.parse(journal.entries[0].raw) as CallControl];
  });
  });
}
/** At most 64 live journals. Verified retired calls remain in local own-call history. */
export function createMobileCallJournalStore(): CallJournalStore {
  return {
    async read(owner, callId) {
      return serial(async()=>{
      key(owner, callId);
      return (await (await db()).getFirstAsync<{ data: string }>('SELECT data FROM call_journal WHERE owner=? AND call_id=?', owner, callId))?.data ?? null;
      });
    },
    async compareAndSet(owner, callId, before, after) {
      return serial(async()=>{
      key(owner, callId);
      if (after.length > 800000) throw Error('Oversized call journal');
      let saved = false;
      await (await db()).withExclusiveTransactionAsync(async tx => {
        const row = await tx.getFirstAsync<{ data: string }>('SELECT data FROM call_journal WHERE owner=? AND call_id=?', owner, callId);
        if ((row?.data ?? null) !== before) return;
        if (!row) {
          if(await tx.getFirstAsync('SELECT call_id FROM call_history WHERE owner=? AND call_id=?',owner,callId))return;
          let count = await tx.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM call_journal');
          if(count&&count.total>=64){
            const now=Date.now();
            for(const old of await tx.getAllAsync<{owner:string;call_id:string;data:string}>('SELECT owner,call_id,data FROM call_journal LIMIT 64')){
              if(!canArchiveCallJournal(old.data,now))continue;
              await tx.runAsync('INSERT INTO call_history(owner,call_id,data,archived_at) VALUES(?,?,?,?)',old.owner,old.call_id,old.data,now);
              await tx.runAsync('DELETE FROM call_journal WHERE owner=? AND call_id=? AND data=?',old.owner,old.call_id,old.data);
            }
            count=await tx.getFirstAsync<{total:number}>('SELECT COUNT(*) AS total FROM call_journal');
          }
          if (!count || count.total >= 64) return;
          await tx.runAsync('INSERT INTO call_journal(owner,call_id,data) VALUES(?,?,?)', owner, callId, after);
        } else await tx.runAsync('UPDATE call_journal SET data=? WHERE owner=? AND call_id=?', after, owner, callId);
        saved = true;
      });
      return saved;
      });
    },
  };
}
