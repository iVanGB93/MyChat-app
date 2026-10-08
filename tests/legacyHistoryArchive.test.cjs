const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, imports) {
 const out = {};
 new Function('exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:1,target:9}}).outputText)(out, name => {
  if (!(name in imports)) throw Error('Unexpected import '+name);
  return imports[name];
 });
 return out;
}
const account='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64);
const planner=load('src/services/identity/legacyHistoryArchive.ts', {'./identityProtocol':{validAccountId:v=>/^axonic:1:[a-f0-9]{64}$/.test(v)}});
const room={id:'room',room_type:'direct',members:[1,2],members_detail:[]};
const message={id:'old-id',room_id:'room',sender_id:1,is_mine:false,status:'pending',type:'image',content:null,file_uri:'file:///existing.jpg',reactions:{},is_deleted:false};
function fixture(overrides={}) {return {owner:1,account,current:()=>true,rooms:async()=>[room],messages:async()=>[message],pin:async()=>peer,...overrides};}
test('archive retains pending state, media and IDs without mutating source or creating an outbox',async()=>{
 const saved=await planner.prepareLegacyHistoryArchive(fixture());
 assert.equal(saved.rooms[0].peer,peer);
 assert.deepEqual(saved.rooms[0].messages[0],{...message,is_mine:true});
 assert.equal(message.is_mine,false);
 assert.equal(saved.rooms[0].messages[0].status,'pending');
});
test('unbound and group history remains archived without inventing a cryptographic peer',async()=>{
 const unbound=await planner.prepareLegacyHistoryArchive(fixture({pin:async()=>null}));
 assert.equal(unbound.rooms[0].peer,null);
 const group=await planner.prepareLegacyHistoryArchive(fixture({rooms:async()=>[{...room,room_type:'group'}],pin:async()=>{throw Error('must not look up group as a peer');}}));
 assert.equal(group.rooms[0].peer,null);
});
test('cross-account rooms, foreign senders, invalid pins and lock interruptions fail closed',async()=>{
 await assert.rejects(planner.prepareLegacyHistoryArchive(fixture({rooms:async()=>[{...room,members:[2,3]}]})));
 await assert.rejects(planner.prepareLegacyHistoryArchive(fixture({messages:async()=>[{...message,sender_id:3}]})));
 await assert.rejects(planner.prepareLegacyHistoryArchive(fixture({messages:async()=>[{...message,room_id:'elsewhere'}]})));
 await assert.rejects(planner.prepareLegacyHistoryArchive(fixture({pin:async()=>account})));
 let unlocked=true;
 await assert.rejects(planner.prepareLegacyHistoryArchive(fixture({current:()=>unlocked,pin:async()=>{unlocked=false;return peer;}})));
});
function adapter() {
 const storage=new Map(), status={state:'unlocked',account};let reads=0,fail=false,locked=false;
 const mod=load('src/services/identity/localAccountMigration.ts',{
  '@react-native-async-storage/async-storage':{default:{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>{if(fail)throw Error('disk');storage.set(k,v);}}},
  'expo-secure-store':{getItemAsync:async()=> 'protected'},
  './localAccount':{localAccount:{status:()=>status,beginImport:async()=> 'words',lock:()=>{locked=true;}}},
  '../localMessageStore':{getCachedRooms:async()=>{reads++;return [room];},getMessages:async()=>[message]},
  './chatIdentityPinStore':{createChatIdentityPinStore:()=>({read:async()=>peer})},
  './legacyHistoryArchive':planner,
  './localRootChat':{localRootChat:()=>{throw Error('not used by archive');}},
 });
 storage.set('@axonic_local_migration_source_v1',JSON.stringify({version:1,owner:1,account}));
 return {mod,storage,status,reads:()=>reads,fail:()=>{fail=true;},locked:()=>locked};
}
test('archive commit is idempotent across retry and restart; original data is retained',async()=>{
 const f=adapter();f.storage.set('original','untouched');
 const [a,b]=await Promise.all([f.mod.archiveExistingLocalHistory(),f.mod.archiveExistingLocalHistory()]);
 assert.deepEqual(a,b);assert.equal(f.reads(),1);
 assert.deepEqual(await f.mod.archiveExistingLocalHistory(),a);assert.equal(f.reads(),1);
 assert.equal(f.storage.get('original'),'untouched');
});
test('different local identity cannot inherit archive; corrupt archive is not overwritten',async()=>{
 const f=adapter();f.status.account=peer;
 assert.equal(await f.mod.archiveExistingLocalHistory(),null);assert.equal(f.reads(),0);
 f.status.account=account;const key='@axonic_legacy_history_v1:'+account;
 f.storage.set(key,'corrupt');await assert.rejects(f.mod.archiveExistingLocalHistory());assert.equal(f.storage.get(key),'corrupt');
});
test('write failure leaves no completed marker and permits safe retry',async()=>{
 const f=adapter();f.fail();await assert.rejects(f.mod.archiveExistingLocalHistory());
 assert.equal(f.storage.has('@axonic_legacy_history_v1:'+account),false);
});
