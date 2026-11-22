import * as SQLite from 'expo-sqlite';
import {createIndexedOwnHistory} from '../../services/identity/indexedOwnHistory';
import {parseRootChatStorage} from '../../services/identity/rootChatLedger';
import {validAccountId} from '../../services/identity/identityProtocol';
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
const stores=new Map<string,ReturnType<typeof createIndexedOwnHistory>>();
const serial=<T>(work:()=>Promise<T>)=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
async function db(){return opening??=SQLite.openDatabaseAsync('axonic_own_history_v2.db',{useNewConnection:true}).then(async d=>{try{await d.execAsync('PRAGMA busy_timeout=2500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');return d;}catch(error){await d.closeAsync().catch(()=>{});throw error;}}).catch(e=>{opening=undefined;throw e;});}
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
  readMessage:(peer:string,id:string,direction?:'incoming'|'outgoing')=>serial(async()=>(await use()).readMessage(peer,id,direction)),
  readGroup:(group:string,id?:string)=>serial(async()=>(await use()).readGroup(group,id)),
  readId:(id:string)=>serial(async()=>(await use()).readId(id)),
  readNetwork:()=>serial(async()=>(await use()).readNetwork()),
  recordKnown:(...args:Parameters<ReturnType<typeof createIndexedOwnHistory>['recordKnown']>)=>serial(async()=>(await use()).recordKnown(...args)),
  readRooms:(rooms:string[])=>serial(async()=>(await use()).readRooms(rooms)),
  diagnostics:()=>serial(async()=>(await use()).diagnostics()),
 };
}
