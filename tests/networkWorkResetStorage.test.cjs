const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
const {load}=require('./helpers/attachment.cjs'),policy=load('networkWorkReset'),ledgerApi=load('rootChatLedger');
const account='axonic:1:'+'a'.repeat(64),other='axonic:1:'+'b'.repeat(64);
test('cold reset erases only selected owner queues, archives calls, preserves chats/files/identities, and is idempotent',async t=>{
 const stores=new Map(),keys=new Map(policy.networkResetKeys(account).map(k=>[k,'queued'])),cancelled=[];
 let raw=JSON.stringify({version:1,messages:[{id:'1'.repeat(64),peer:other,direction:'outgoing',text:'preserve',at:1,status:'pending'}],contacts:[]});
 for(const [file,table] of policy.networkResetTables){let db=stores.get(file);if(!db){db=new DatabaseSync(':memory:');stores.set(file,db);t.after(()=>db.close());}db.exec(`CREATE TABLE ${table}(owner TEXT,raw TEXT)`);for(const who of [account,other])db.prepare(`INSERT INTO ${table} VALUES (?,?)`).run(who,'preserve other');}
 const calls=new DatabaseSync(':memory:');stores.set('axonic_call_control_v1.db',calls);t.after(()=>calls.close());calls.exec('CREATE TABLE call_journal(owner TEXT,call_id TEXT,data TEXT);');for(const who of [account,other])calls.prepare('INSERT INTO call_journal VALUES (?,?,?)').run(who,'call','history');
 const deps={
  './networkWorkReset':policy,'./rootChatLedger':ledgerApi,'../../modules/storage/chatStore':{ownChatStore:()=>({read:async()=>raw,write:async v=>raw=v})},
  '@react-native-async-storage/async-storage':{default:{multiRemove:async ks=>ks.forEach(k=>keys.delete(k)),setItem:async(k,v)=>keys.set(k,v)}},
  '@notifee/react-native':{default:{getDisplayedNotifications:async()=>[account,other].map(a=>({notification:{id:a,data:{account:a}}})),cancelNotification:async id=>cancelled.push(id)}},
  'expo-sqlite':{openDatabaseAsync:async file=>{const db=stores.get(file);assert(db,'only allowlisted databases');const tx={getFirstAsync:async(sql,...args)=>db.prepare(sql).get(...args),runAsync:async(sql,...args)=>db.prepare(sql).run(...args),execAsync:async sql=>db.exec(sql)};return {withExclusiveTransactionAsync:async fn=>{db.exec('BEGIN');try{await fn(tx);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},closeAsync:async()=>{}};}},
 };
 const api={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/networkWorkResetStorage.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(api,n=>{assert(n in deps,'unexpected dependency '+n);return deps[n];});
 await api.purgeNetworkWork({version:1,account,at:100});await api.purgeNetworkWork({version:1,account,at:100});
 for(const [file,table] of policy.networkResetTables){const db=stores.get(file);assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE owner=?`).get(account).n,0);assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE owner=?`).get(other).n,1);}
 assert.equal(JSON.parse(raw).messages[0].text,'preserve');assert.equal(JSON.parse(raw).messages[0].networkCancelledAt,100);assert.equal(calls.prepare('SELECT COUNT(*) n FROM call_journal WHERE owner=?').get(other).n,1);assert.equal(calls.prepare('SELECT COUNT(*) n FROM call_history WHERE owner=?').get(account).n,1);assert(cancelled.every(id=>id===account));assert(policy.networkResetKeys(account).every(k=>!keys.has(k)));
});
