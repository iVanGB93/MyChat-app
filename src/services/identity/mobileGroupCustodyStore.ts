import * as SQLite from 'expo-sqlite';
import {validAccountId} from './identityProtocol';
import {validateGroupCustodyRows,type GroupCustodyStore,type GroupCustodyRow} from './groupCustodyService';
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
export function createMobileGroupCustodyStore(owner:string):GroupCustodyStore&{inspect():Promise<GroupCustodyRow[]>}{
 if(!validAccountId(owner))throw Error('Invalid group custody owner');
 const db=()=>opening??=SQLite.openDatabaseAsync('axonic_group_custody_v1.db',{useNewConnection:true}).then(async db=>{await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS group_custody(owner TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL)');return db;}).catch(e=>{opening=undefined;throw e;});
 return {async inspect(){const saved=await(await db()).getFirstAsync<{data:string}>('SELECT data FROM group_custody WHERE owner=?',owner);if(saved&&saved.data.length>4*1024*1024)throw Error('Group custody capacity');const rows=saved?JSON.parse(saved.data):[];validateGroupCustodyRows(rows);return rows;},transaction<T>(change:(rows:GroupCustodyRow[])=>T){const result=tail.then(async()=>{let value!:T;await(await db()).withExclusiveTransactionAsync(async tx=>{
  const saved=await tx.getFirstAsync<{data:string}>('SELECT data FROM group_custody WHERE owner=?',owner);if(saved&&saved.data.length>4*1024*1024)throw Error('Group custody capacity');
  const rows:GroupCustodyRow[]=saved?JSON.parse(saved.data):[];validateGroupCustodyRows(rows);value=change(rows);validateGroupCustodyRows(rows);const data=JSON.stringify(rows);
  if(data!==saved?.data)await tx.runAsync('INSERT INTO group_custody(owner,data) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data',owner,data);
 });return value;});tail=result.catch(()=>{});return result;}};
}
