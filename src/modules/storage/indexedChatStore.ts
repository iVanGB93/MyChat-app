import * as SQLite from 'expo-sqlite';
import {createIndexedOwnHistory} from '../../services/identity/indexedOwnHistory';
import {parseRootChatStorage} from '../../services/identity/rootChatLedger';
import {validAccountId} from '../../services/identity/identityProtocol';
const databaseName='axonic_own_history_v2.db';
let opening:Promise<SQLite.SQLiteDatabase>|undefined,notificationReader:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
const stores=new Map<string,ReturnType<typeof createIndexedOwnHistory>>();
const serial=<T>(work:()=>Promise<T>)=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
async function db(){return opening??=SQLite.openDatabaseAsync(databaseName,{useNewConnection:true}).then(async d=>{try{await d.execAsync('PRAGMA busy_timeout=2500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');return d;}catch(error){await d.closeAsync().catch(()=>{});throw error;}}).catch(e=>{opening=undefined;throw e;});}
// A notification launch reads committed metadata while the normal connection may be
// busy with a write transaction or queued history work. The canonical reader
// still handles migration and any transient failure on this separate connection.
async function notificationGroupExists(owner:string,group:string){
 try{
  const connection=await (notificationReader??=SQLite.openDatabaseAsync(databaseName,{useNewConnection:true}).then(async reader=>{
   try{await reader.execAsync('PRAGMA query_only=ON; PRAGMA busy_timeout=200;');return reader;}
   catch(error){await reader.closeAsync().catch(()=>{});throw error;}
  }).catch(error=>{notificationReader=undefined;throw error;}));
  const row=await connection.getFirstAsync<{found:number}>(
   "SELECT EXISTS(SELECT 1 FROM json_each(metadata, '$.state.groups') WHERE json_extract(value, '$.id')=?) AS found FROM own_history_accounts WHERE owner=?",group,owner);
  return row?row.found===1:undefined;
 }catch{return undefined;}
}
/** Canonical mobile history for Dev and production; migration is atomic and preserves its source. */
export const indexedChatEnabled=()=>true;
export function indexedChatStore(owner:string,legacy:()=>Promise<string|null>){
 if(!validAccountId(owner))throw Error('Invalid account');
 const use=async()=>{let store=stores.get(owner);if(!store){store=createIndexedOwnHistory(owner,{sql:await db(),legacy,validate:raw=>parseRootChatStorage(owner,raw)});stores.set(owner,store);}return store;};
 return {
  read:()=>serial(async()=>(await use()).read()),write:(raw:string)=>serial(async()=>(await use()).write(raw)),
  readScope:(...args:Parameters<ReturnType<typeof createIndexedOwnHistory>['readScope']>)=>serial(async()=>(await use()).readScope(...args)),
  writeScope:(...args:Parameters<ReturnType<typeof createIndexedOwnHistory>['writeScope']>)=>serial(async()=>(await use()).writeScope(...args)),
  readMedia:(...args:Parameters<ReturnType<typeof createIndexedOwnHistory>['readMedia']>)=>serial(async()=>(await use()).readMedia(...args)),
  readUnread:(peers:string[])=>serial(async()=>(await use()).readUnread(peers)),
  readAttachments:()=>serial(async()=>(await use()).readAttachments()),
  notificationGroupExists:(group:string)=>notificationGroupExists(owner,group),
  readMessage:(peer:string,id:string,direction?:'incoming'|'outgoing')=>serial(async()=>(await use()).readMessage(peer,id,direction)),
  readGroup:(group:string,id?:string)=>serial(async()=>(await use()).readGroup(group,id)),
  readId:(id:string)=>serial(async()=>(await use()).readId(id)),
  readNetwork:()=>serial(async()=>(await use()).readNetwork()),
  recordKnown:(...args:Parameters<ReturnType<typeof createIndexedOwnHistory>['recordKnown']>)=>serial(async()=>(await use()).recordKnown(...args)),
  readRooms:(rooms:string[])=>serial(async()=>(await use()).readRooms(rooms)),
  diagnostics:()=>serial(async()=>(await use()).diagnostics()),
 };
}
