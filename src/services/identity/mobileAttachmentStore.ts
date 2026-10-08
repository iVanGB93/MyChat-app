import * as SQLite from 'expo-sqlite';
import type {AttachmentStore,AttachmentCustodyRow} from './attachmentCustody';
import type {AttachmentChunk} from './attachmentProtocol';
import {validAccountId} from './identityProtocol';
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
function db(){return opening??=SQLite.openDatabaseAsync('axonic_attachment_custody_v1.db',{useNewConnection:true}).then(async database=>{
 await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS assets(owner TEXT NOT NULL,digest TEXT NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,digest)); CREATE TABLE IF NOT EXISTS asset_chunks(owner TEXT NOT NULL,digest TEXT NOT NULL,part INTEGER NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,digest,part));');return database;
}).catch(error=>{opening=undefined;throw error;});}
/** Separate ciphertext custody database; never the owner's downloaded files or chat history. */
export function createMobileAttachmentStore(owner:string):AttachmentStore {
 if(!validAccountId(owner))throw Error('Invalid attachment owner');
 return {transaction<T>(work:Parameters<AttachmentStore['transaction']>[0]):Promise<T>{
  const result=tail.then(async()=>{const database=await db();let output:T;
   await database.withExclusiveTransactionAsync(async tx=>{
    const eraseChunks=async(digest:string)=>{await tx.runAsync('DELETE FROM asset_chunks WHERE owner=? AND digest=?',owner,digest);};
    output=await work({
     rows:async()=>{const rows=await tx.getAllAsync<{raw:string}>('SELECT raw FROM assets WHERE owner=?',owner);return rows.map(r=>JSON.parse(r.raw) as AttachmentCustodyRow);},
     save:async row=>{await tx.runAsync('INSERT INTO assets(owner,digest,raw) VALUES(?,?,?) ON CONFLICT(owner,digest) DO UPDATE SET raw=excluded.raw',owner,row.digest,JSON.stringify(row));},
     chunk:async(digest,index)=>{const row=await tx.getFirstAsync<{raw:string}>('SELECT raw FROM asset_chunks WHERE owner=? AND digest=? AND part=?',owner,digest,index);return row?JSON.parse(row.raw) as AttachmentChunk:null;},
     saveChunk:async(digest,chunk)=>{await tx.runAsync('INSERT INTO asset_chunks(owner,digest,part,raw) VALUES(?,?,?,?)',owner,digest,chunk.index,JSON.stringify(chunk));},
     eraseChunks,erase:async digest=>{await eraseChunks(digest);await tx.runAsync('DELETE FROM assets WHERE owner=? AND digest=?',owner,digest);},
    }) as T;
   });return output!;
  });tail=result.catch(()=>{});return result;
 }};
}
