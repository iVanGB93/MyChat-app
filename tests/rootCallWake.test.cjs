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
  '../../../modules/axonic-nearby':{default:{notificationCallStyle:async()=>true}},
  '../../modules/storage/chatStore':{ownChatStore:owner=>({read:async()=>storage.get('@axonic_root_chat_v1:'+owner)??null})},
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
 return {mod,native,storage,shown,cancelled,recipient,recipientDevice,data,invite,sender,
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
test('notification confirmation requires successful allowed presentation, never denied permission or a blocked channel',async()=>{
 for(const mode of ['denied','blocked-channel','failed','shown']){
  const f=fixture();await f.init();const native=f.mod;
  // Fixture exposes the same Notifee object used by the production notification adapter.
  f.native.getNotificationSettings=async()=>({authorizationStatus:mode==='denied'?0:1});
  f.native.getChannel=async()=>({blocked:mode==='blocked-channel'});
  if(mode==='failed')f.native.displayNotification=async()=>{throw Error('OS notification failed');};
  const work=native.syncRootCallNotification(f.recipient.account,{id:'ab'.repeat(32),peerUser:f.sender.account,media:'voice',outgoing:false,status:'ringing'});
  if(mode==='failed')await assert.rejects(work);else assert.equal(await work,mode==='shown',mode);
 }
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

test('pending device removal suppresses wake context and incoming call notifications',async()=>{
 const f=fixture();await f.mod.registerRootCallWakeOwner(f.recipient.account,f.recipientDevice.id);
 f.storage.set('@axonic_device_removal_v1',JSON.stringify({version:1,account:f.recipient.account}));
 assert.equal(await f.mod.rootWakeContext(),null);await f.mod.receiveRootCallWake(f.data);assert.equal(f.shown.length,0);
});

test('both incoming call paths show only the verified caller’s local nickname',async()=>{
 for(const path of ['wake','direct']){
  const f=fixture();await f.init();
  f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[
   {account:f.sender.account,alias:'  My friend  ',blocked:false},
   {account:f.recipient.account,alias:'Wrong contact',blocked:false},
  ]}));
  if(path==='wake')await f.mod.receiveRootCallWake(f.data);
  else await f.mod.syncRootCallNotification(f.recipient.account,{id:'ab'.repeat(32),peerUser:f.sender.account,peerName:'Untrusted name',media:'video',outgoing:false,status:'ringing'});
  assert.equal(f.shown.length,1,path);assert.equal(f.shown[0].title,'My friend',path);
  assert.match(f.shown[0].body,path==='wake'?/Incoming voice call/:/Incoming video call/);
 }
});

test('new callers and contacts without a nickname get a generic call label',async()=>{
 for(const path of ['wake','direct'])for(const alias of [undefined,'','   ']){
  const f=fixture();await f.init();
  if(alias!==undefined)f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[{account:f.sender.account,alias,blocked:false}]}));
  // Another account's saved name must never leak into this account's notification.
  f.storage.set('@axonic_root_chat_v1:'+f.sender.account,JSON.stringify({version:1,contacts:[{account:f.sender.account,alias:'Other account nickname',blocked:false}]}));
  if(path==='wake')await f.mod.receiveRootCallWake(f.data);
  else await f.mod.syncRootCallNotification(f.recipient.account,{id:'ab'.repeat(32),peerUser:f.sender.account,peerName:'Untrusted name',media:'voice',outgoing:false,status:'ringing'});
  assert.equal(f.shown.length,1,path);assert.equal(f.shown[0].title,'Unknown caller',path);
  assert.ok(!f.shown[0].body.includes(f.sender.account));
 }
});

test('incoming call notification supplies answer, decline, full-screen routing and call category',async()=>{const f=fixture();await f.init();await f.mod.receiveRootCallWake(f.data);const n=f.shown[0];assert.equal(n.android.category,'call');assert.equal(n.android.fullScreenAction.launchActivity,'default');assert.deepEqual(n.android.actions.map(a=>a.pressAction.id),['root-call-decline','root-call-answer']);assert.equal(n.android.ongoing,true);assert(!n.body.includes('Open Axonic'));});
test('expired incoming call cannot recreate a ringing notification',async()=>{
 const f=fixture();await f.init();await f.mod.syncRootCallNotification(f.recipient.account,{id:'ab'.repeat(32),peerUser:f.sender.account,media:'voice',outgoing:false,status:'ringing',expiresAt:Date.now()-1});assert.equal(f.shown.length,0);
});
test('direct incoming notification preserves remaining invitation deadline',async()=>{
 const f=fixture();await f.init();await f.mod.syncRootCallNotification(f.recipient.account,{id:'ab'.repeat(32),peerUser:f.sender.account,media:'voice',outgoing:false,status:'ringing',expiresAt:Date.now()+5000});assert.equal(f.shown.length,1);assert.ok(f.shown[0].android.timeoutAfter<=5000);
});
