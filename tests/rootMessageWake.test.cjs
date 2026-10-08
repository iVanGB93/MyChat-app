const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const cache=new Map();
function protocol(name){if(cache.has(name))return cache.get(name);const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.startsWith('./')?protocol(n.slice(2).replace(/\.ts$/,'')):require(n));cache.set(name,out);return out;}
const p=protocol('identityProtocol'),c=protocol('custodyProtocol'),seed=n=>new Uint8Array(32).fill(n);
async function fixture(t){
 const now=Date.now(),device=p.publicDevice(seed(2),seed(3)),recipientDevice=p.publicDevice(seed(5),seed(6));
 const sender=p.issueRecord(seed(1),[device],now),recipient=p.issueRecord(seed(4),[recipientDevice],now);
 const storage=new Map(),shown=[],cancelled=[],toasts=[],channels=[],database=new DatabaseSync(':memory:');t.after(()=>database.close());
 let channel=null;let owner={account:recipient.account,device:recipientDevice.id},blocked=false,fail=false,locked=false,visible=false;
 const app={currentState:'background'};
 const db={execAsync:async sql=>database.exec(sql),runAsync:async(sql,...args)=>database.prepare(sql).run(...args),
 getFirstAsync:async(sql,...args)=>database.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>database.prepare(sql).all(...args),
 withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(db);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const imports={
 './rootMessageToast':{publishRootMessageToast:preview=>{toasts.push(preview);return true;}},
 './localAccount':{localAccount:{status:()=>({state:locked?'locked':'unlocked',account:owner?.account})}},
 './rootNotificationRoute':{rootConversationVisible:()=>visible},
 '@react-native-async-storage/async-storage':{default:{getItem:async k=>storage.get(k)??null}},
 'expo-sqlite':{openDatabaseAsync:async()=>db},'react-native':{AppState:app},
 '@notifee/react-native':{default:{getChannel:async()=>channel,createChannel:async c=>{channels.push(c);},displayNotification:async n=>{if(fail)throw Error('not ready');shown.push(n);},cancelNotification:async id=>cancelled.push(id)},AndroidImportance:{HIGH:4},AndroidVisibility:{PRIVATE:0},AndroidStyle:{MESSAGING:1}},
 './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async id=>id===sender.account?sender:null})},
 './rootCallWake':{rootWakeContext:async()=>owner,rootWakeBlocked:async()=>blocked}};
 const preferences={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationPreferences.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(preferences,n=>imports[n]??protocol(n.slice(2)));imports['./rootNotificationPreferences']=preferences;
 const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageWake.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>imports[n]??protocol(n.slice(2)));
 const envelope=await c.sealCustody({record:sender,signingSeed:seed(2),encryptionSeed:seed(3),recipient,recipientDevice:recipientDevice.id,id:'cd'.repeat(32),text:'private text',now,random:async n=>new Uint8Array(n).fill(12)});
 const data=c.createCustodyWake(envelope,sender);
 return {mod,data,envelope,shown,cancelled,toasts,channels,setChannel:v=>channel=v,app,storage,recipient,sender,lock:()=>locked=true,visible:()=>visible=true,block:()=>blocked=true,changeOwner:()=>owner=null,fail:v=>fail=v,
 delivered:()=>storage.set('@axonic_root_chat_v1:'+recipient.account,JSON.stringify({version:1,contacts:[],messages:[{id:envelope.id,peer:sender.account,direction:'incoming'}]}))};
}
test('locked recipient sees one generic signed notice; durable delivery clears it and prevents replay',async t=>{
 const f=await fixture(t);await Promise.all([f.mod.receiveRootMessageWake(f.data),f.mod.receiveRootMessageWake(f.data)]);
 assert.equal(f.shown.length,1);assert(!JSON.stringify(f.shown).includes('private text'));
 f.delivered();await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id);
 assert.equal(f.cancelled[0],f.shown[0].id);await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,1);
});
test('blocked, changed owner, forged and already-delivered messages do not notify',async t=>{
 for(const prepare of [f=>f.block(),f=>f.changeOwner(),f=>f.delivered(),f=>f.data.event=f.data.event.replace('cdcd','abab')]){
 const f=await fixture(t);prepare(f);await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);}
});
test('a failed OS display can retry, while foreground delivery remains quiet',async t=>{
 const f=await fixture(t);f.fail(true);await assert.rejects(()=>f.mod.receiveRootMessageWake(f.data));f.fail(false);
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,1);
 const active=await fixture(t);active.app.currentState='active';await active.mod.receiveRootMessageWake(active.data);assert.equal(active.shown.length,0);
});

test('muted signed message hints remain silent without treating the contact as blocked',async t=>{
 const f=await fixture(t);f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[{account:f.sender.account,muted:true,blocked:false}],messages:[]}));
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);
});

test('background previews use an audible channel while sound opt-out remains silent',async t=>{
 for(const sound of [true,false]){
  const f=await fixture(t);f.storage.set('@axonic_root_notifications_v1:'+f.recipient.account,JSON.stringify({version:1,messages:true,calls:true,sound}));
  await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Peer',text:'test',at:Date.now()});
  assert.equal(f.channels[0].sound,sound?'default':undefined);assert.equal(f.channels[0].vibration,sound);
  assert.equal(f.shown[0].android.channelId,f.channels[0].id);
 }
});

test('corrected channel preserves the old OS block and custom sound',async t=>{
 const blocked=await fixture(t);blocked.setChannel({id:'root-messages-v1',importance:0,blocked:true});
 await blocked.mod.receiveRootMessageWake(blocked.data);assert.equal(blocked.channels.length,0);
 assert.equal(blocked.shown[0].android.channelId,'root-messages-v1');
 const custom=await fixture(t);custom.setChannel({importance:3,soundURI:'content://settings/custom'});
 await custom.mod.receiveRootMessageWake(custom.data);assert.equal(custom.channels[0].sound,'content://settings/custom');assert.equal(custom.channels[0].importance,3);
});

test('message push preference suppresses notices but still runs verified delivery recovery',async t=>{
 const f=await fixture(t);f.storage.set('@axonic_root_notifications_v1:'+f.recipient.account,JSON.stringify({version:1,messages:false,calls:true,sound:true}));
 let recovered=0;await f.mod.receiveRootMessageWake(f.data,async()=>{recovered++;});
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Peer',text:'private',at:Date.now()});
 assert.equal(recovered,1);assert.equal(f.shown.length,0);
});

test('durably decrypted message replaces generic hint with a preview and delayed hints cannot erase it',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);f.delivered();
 const preview={name:'My private nickname',text:'private text',at:Date.now()};
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,preview);
 assert.equal(f.shown.length,2);assert.equal(f.shown[1].title,preview.name);assert.equal(f.shown[1].body,preview.text);assert.equal(f.shown[1].android.style.messages[0].text,preview.text);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,preview);
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,2);assert.equal(f.cancelled.length,0);
});
test('foreground conversations elsewhere notify; current conversation, read, muted, locked and changed owner do not expose content',async t=>{
 const preview={name:'Friend',text:'Private',at:Date.now()};
 const active=await fixture(t);active.app.currentState='active';await active.mod.finishRootMessageWake(active.recipient.account,active.sender.account,active.envelope.id,preview);assert.equal(active.shown.length,0);assert.equal(active.toasts.length,1);
 for(const prepare of [f=>f.visible(),f=>f.lock(),f=>f.changeOwner(),f=>f.block(),f=>f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,messages:[],contacts:[{account:f.sender.account,muted:true}]}))]){
  const f=await fixture(t);f.app.currentState='active';prepare(f);await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,preview);assert.equal(f.shown.length,0);
 }
 const read=await fixture(t);await read.mod.finishRootMessageWake(read.recipient.account,read.sender.account,read.envelope.id,{...preview,read:true});assert.equal(read.shown.length,0);
});
test('only verified signed wakes may request inbox recovery',async t=>{
 const f=await fixture(t);let recovered=0;const recover=async(account,sender,id)=>{assert.equal(account,f.recipient.account);assert.equal(sender,f.sender.account);assert.equal(id,f.envelope.id);recovered++;};
 await f.mod.receiveRootMessageWake({...f.data,event:f.data.event.replace('cdcd','abab')},recover);assert.equal(recovered,0);
 await f.mod.receiveRootMessageWake(f.data,recover);assert.equal(recovered,1);
});

test('processed read/control envelopes never create a phantom message notification',async t=>{
 const f=await fixture(t);f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[],messages:[],actions:[{id:f.envelope.id,peer:f.sender.account,direction:'incoming'}]}));
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);
});
test('completed preview metadata is bounded without silencing subsequent real messages',async t=>{
 const f=await fixture(t);for(let i=0;i<130;i++)await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,i.toString(16).padStart(64,'0'),{name:'Friend',text:'Message '+i,at:Date.now()});assert.equal(f.shown.length,130);
});

