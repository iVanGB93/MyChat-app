const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const cache=new Map();
function protocol(name){if(cache.has(name))return cache.get(name);const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.startsWith('./')?protocol(n.slice(2).replace(/\.ts$/,'')):require(n));cache.set(name,out);return out;}
const p=protocol('identityProtocol'),c=protocol('callControlProtocol'),w=protocol('callWakeProtocol');
const seed=n=>new Uint8Array(32).fill(n);
function fixture(){
 const now=Date.now(),device=p.publicDevice(seed(2),seed(3)),recipientDevice=p.publicDevice(seed(5),seed(6));
 const sender=p.issueRecord(seed(1),[device],now),recipient=p.issueRecord(seed(4),[recipientDevice],now);
 const storage=new Map([['@axonic_local_account_v1',JSON.stringify({record:recipient})]]),shown=[],cancelled=[];
 const database=new DatabaseSync(':memory:');
 const db={execAsync:async sql=>database.exec(sql),runAsync:async(sql,...args)=>database.prepare(sql).run(...args),
  getFirstAsync:async(sql,...args)=>database.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>database.prepare(sql).all(...args),
  withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(db);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const native={displayNotification:async n=>shown.push(n),cancelNotification:async id=>cancelled.push(id)};
 const imports={
  '@react-native-async-storage/async-storage':{default:{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>storage.set(k,v)}},
  'expo-sqlite':{openDatabaseAsync:async()=>db},'react-native':{AppState:{currentState:'background'}},
  '@notifee/react-native':{default:native,AndroidCategory:{CALL:'call'},AndroidImportance:{HIGH:4},AndroidVisibility:{PRIVATE:0}},
  './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async id=>id===sender.account?sender:null})},
  '../callNotificationChannel':{ensureCallChannel:async()=>{}},
 };
 const preferences={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationPreferences.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(preferences,n=>imports[n]??protocol(n.slice(2)));imports['./rootNotificationPreferences']=preferences;
 const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootCallWake.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>imports[n]??protocol(n.slice(2)));
 const fields={record:sender,callId:'ab'.repeat(32),caller:sender.account,callee:recipient.account,callerDevice:device.id,media:'voice',kind:'invite',invitation:null,sequence:0,issuedAt:now,expiresAt:now+60000};
 const invite=c.signCallControl(fields,seed(2),now),data=w.createCallWake(invite,recipientDevice.id,now);
 return {mod,storage,shown,cancelled,recipient,recipientDevice,data,invite,sender,
  foreground:()=>{imports['react-native'].AppState.currentState='active';},
  cancel:()=>w.createCallWake(c.signCallControl({...fields,kind:'cancel',invitation:c.callControlDigest(JSON.parse(invite)),sequence:1},seed(2),now),recipientDevice.id,now),
  block:()=>storage.set('@axonic_root_chat_v1:'+recipient.account,JSON.stringify({version:1,contacts:[{account:sender.account,blocked:true}]})),
  init:()=>mod.registerRootCallWakeOwner(recipient.account,recipientDevice.id)};
}
test('disabled call push still persists signed invites for later recovery',async()=>{
 const f=fixture();await f.init();f.storage.set('@axonic_root_notifications_v1:'+f.recipient.account,JSON.stringify({version:1,messages:true,calls:false,sound:true}));
 await f.mod.receiveRootCallWake(f.data);assert.equal(f.shown.length,0);assert.equal((await f.mod.pendingRootCallWakes(f.recipient.account)).length,1);
});
test('verified direct incoming calls notify in background once and clear on foreground or answer',async()=>{
 const f=fixture();await f.init();const view={id:'ab'.repeat(32),peerUser:f.sender.account,peerName:'Peer',media:'voice',outgoing:false,status:'ringing'};
 await f.mod.syncRootCallNotification(f.recipient.account,view);await f.mod.syncRootCallNotification(f.recipient.account,view);
 assert.equal(f.shown.length,1);assert.equal(f.shown[0].android.pressAction.launchActivity,'default');
 f.foreground();await f.mod.syncRootCallNotification(f.recipient.account,view);assert.ok(f.cancelled.includes('root-call:'+view.id));
});
test('direct call notifications obey blocking, preferences, and local identity',async()=>{
 for(const mode of ['blocked','disabled','wrong-owner','outgoing','ended']){
  const f=fixture();await f.init();const view={id:'ab'.repeat(32),peerUser:f.sender.account,media:'voice',outgoing:mode==='outgoing',status:mode==='ended'?'ended':'ringing'};
  if(mode==='blocked')f.block();
  if(mode==='disabled')f.storage.set('@axonic_root_notifications_v1:'+f.recipient.account,JSON.stringify({version:1,messages:true,calls:false,sound:true}));
  await f.mod.syncRootCallNotification(mode==='wrong-owner'?f.sender.account:f.recipient.account,view);assert.equal(f.shown.length,0,mode);
 }
});
test('consuming a wake during background ringing retains the answer notification',async()=>{
 const f=fixture();await f.init();await f.mod.receiveRootCallWake(f.data);
 await f.mod.finishRootCallWake(f.recipient.account,'ab'.repeat(32),true);
 assert.equal((await f.mod.pendingRootCallWakes(f.recipient.account)).length,0);assert.equal(f.cancelled.length,0);
});
test('root wake verifies signatures, persists once and retains a consumed replay tombstone',async()=>{
 const f=fixture();await f.init();await f.mod.receiveRootCallWake(f.data);await f.mod.receiveRootCallWake(f.data);
 assert.equal(f.shown.length,1);assert.equal((await f.mod.pendingRootCallWakes(f.recipient.account)).length,1);
 await f.mod.finishRootCallWake(f.recipient.account,'ab'.repeat(32));await f.mod.receiveRootCallWake(f.data);
 assert.equal(f.shown.length,1);assert.equal((await f.mod.pendingRootCallWakes(f.recipient.account)).length,0);
});
test('cancel before invite cannot be replayed into a ringing notification',async()=>{
 const f=fixture();await f.init();await f.mod.receiveRootCallWake(f.cancel());await f.mod.receiveRootCallWake(f.data);
 assert.equal(f.shown.length,0);assert.equal(JSON.parse((await f.mod.pendingRootCallWakes(f.recipient.account))[0].raw).kind,'cancel');
});
test('blocked callers, wrong target devices, tampering and a changed local account fail closed',async()=>{
 const f=fixture();await f.init();await f.mod.receiveRootCallWake({...f.data,targetDevice:'00'.repeat(32)});
 await f.mod.receiveRootCallWake({...f.data,event:f.data.event.replace('voice','video')});assert.equal(f.shown.length,0);
 f.block();await f.mod.receiveRootCallWake(f.data);assert.equal(f.shown.length,0);
 const other=fixture();await other.init();other.storage.set('@axonic_local_account_v1',JSON.stringify({record:{account:'axonic:1:'+'f'.repeat(64)}}));
 await other.mod.receiveRootCallWake(other.data);assert.equal(other.shown.length,0);
});
