const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const cache=new Map();
function protocol(name){if(cache.has(name))return cache.get(name);const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.startsWith('./')?protocol(n.slice(2).replace(/\.ts$/,'')):require(n));cache.set(name,out);return out;}
const p=protocol('identityProtocol'),c=protocol('custodyProtocol'),seed=n=>new Uint8Array(32).fill(n);
async function fixture(t,options={}){
 const now=Date.now(),device=p.publicDevice(seed(2),seed(3)),recipientDevice=p.publicDevice(seed(5),seed(6));
 const sender=p.issueRecord(seed(1),[device],now),recipient=p.issueRecord(seed(4),[recipientDevice],now);
 const storage=new Map(),displayed=new Map(),shown=[],cancelled=[],toasts=[],channels=[],database=new DatabaseSync(':memory:');t.after(()=>database.close());
 let channel=null;let owner={account:recipient.account,device:recipientDevice.id},blocked=false,fail=false,locked=false,visible=false;
 const app={currentState:'background'};let onDisplay=()=>{};
 const db={execAsync:async sql=>database.exec(sql),runAsync:async(sql,...args)=>database.prepare(sql).run(...args),
 getFirstAsync:async(sql,...args)=>database.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>database.prepare(sql).all(...args),
 withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(db);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const imports={'../../modules/storage/chatStore':{ownChatStore:owner=>({read:async()=>storage.get('@axonic_root_chat_v1:'+owner)??null})},
 '../mobileDeliveryDiagnostics':{deliveryDiagnosticEvent:()=>{}},
 '../../../modules/axonic-nearby':{default:{notificationReadActionInShade:async()=>true,...options.native}},
 './rootMessageToast':{publishRootMessageToast:preview=>{toasts.push(preview);return true;}},
 './localAccount':{localAccount:{status:()=>({state:locked?'locked':'unlocked',account:owner?.account})}},
 './rootNotificationRoute':{rootConversationVisible:()=>visible},
 '../diagnosticJournal':{diagnosticJournal:{record:()=>{}}},
 '@react-native-async-storage/async-storage':{default:{getItem:async k=>storage.get(k)??null}},
 'expo-sqlite':{openDatabaseAsync:async()=>db},'react-native':{AppState:app},
 '@notifee/react-native':{default:{getChannel:async()=>channel,createChannel:async c=>{channels.push(c);options.onChannel?.();},displayNotification:async n=>{if(fail)throw Error('not ready');shown.push(n);displayed.set(n.id,n);onDisplay();},getDisplayedNotifications:async()=>[...displayed.values()].map(notification=>({notification})),cancelNotification:async id=>{cancelled.push(id);displayed.delete(id);}},AndroidImportance:{HIGH:4},AndroidVisibility:{PRIVATE:0},AndroidStyle:{MESSAGING:1}},
 './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async id=>id===sender.account?sender:null})},
 './rootCallWake':{rootWakeContext:async()=>owner,rootWakeBlocked:async()=>blocked}};
 const notifications={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageNotification.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(notifications,n=>imports[n]);imports['./rootMessageNotification']=notifications;
 const preferences={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationPreferences.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(preferences,n=>imports[n]??protocol(n.slice(2)));imports['./rootNotificationPreferences']=preferences;
 const mod={};new Function('exports','require','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageWake.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>imports[n]??protocol(n.slice(2)),options.setTimeout??setTimeout,clearTimeout);
 const envelope=await c.sealCustody({record:sender,signingSeed:seed(2),encryptionSeed:seed(3),recipient,recipientDevice:recipientDevice.id,id:'cd'.repeat(32),text:options.silent?JSON.stringify(['axonic-root-action-v1','peer','id',{kind:'read'}]):'private text',now,random:async n=>new Uint8Array(n).fill(12)});
 const data=c.createCustodyWake(envelope,sender);
 return {database,mod,data,envelope,shown,displayed,cancelled,toasts,channels,setChannel:v=>channel=v,app,storage,recipient,sender,lock:()=>locked=true,visible:()=>visible=true,block:()=>blocked=true,changeOwner:()=>owner=null,fail:v=>fail=v,
 onDisplay:fn=>onDisplay=fn,delivered:()=>storage.set('@axonic_root_chat_v1:'+recipient.account,JSON.stringify({version:1,contacts:[],messages:[{id:envelope.id,peer:sender.account,direction:'incoming'}]}))};
}
test('avatar fetching and group recovery never create generic alerts, including while locked',async t=>{
 for(const tag of ['axonic-avatar-fetch-v1','axonic-avatar-offer-v1','axonic-group-members-v1','axonic-group-leave-v1','axonic-group-recover-v1','axonic-group-backup-v1','axonic-group-recovery-offer-v1']){
  const f=await fixture(t);f.lock();
  const envelope=await c.sealCustody({record:f.sender,signingSeed:seed(2),encryptionSeed:seed(3),recipient:f.recipient,recipientDevice:f.recipient.devices[0].id,id:'ce'.repeat(32),text:JSON.stringify([tag,'peer','id',{}]),now:Date.now(),random:async n=>new Uint8Array(n).fill(12)});
  const data=c.createCustodyWake(envelope,f.sender);let recovered=0;
  await f.mod.receiveRootMessageWake(data,async()=>{recovered++;});
  assert.equal(recovered,1,'silence must not skip recovery');assert.equal(f.shown.length,0,tag);
  assert.equal(f.database.prepare('SELECT displayed FROM notices WHERE id=?').get(envelope.id).displayed,2);
 }
});

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

test('control admitted before its first wake remains quiet even without a chat row',async t=>{
 const f=await fixture(t);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id);
 await f.mod.receiveRootMessageWake(f.data);
 assert.equal(f.shown.length,0);
});
test('foreground group preview retires its matching generic direct notification',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);assert.equal(f.displayed.size,1);
 f.app.currentState='active';
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Group',text:'Hello',at:Date.now(),group:'ab'.repeat(32)});
 assert.equal(f.toasts.length,1);assert.equal(f.displayed.size,0);
});
test('processed read/control envelopes never create a phantom message notification',async t=>{
 const f=await fixture(t);f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[],messages:[],actions:[{id:f.envelope.id,peer:f.sender.account,direction:'incoming'}]}));
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);
});
test('completed preview metadata is bounded without silencing subsequent real messages',async t=>{
 const f=await fixture(t);for(let i=0;i<130;i++)await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,i.toString(16).padStart(64,'0'),{name:'Friend',text:'Message '+i,at:Date.now()});assert.equal(f.shown.length,130);
 assert.equal(f.shown.at(-1).android.style.messages.length,25);
});

test('messages from one conversation replace its notice; other senders and groups remain separate',async t=>{
 const f=await fixture(t),owner=f.recipient.account,sender=f.sender.account;
 await f.mod.finishRootMessageWake(owner,sender,'11'.repeat(32),{name:'Friend',text:'First',at:1});
 await f.mod.finishRootMessageWake(owner,sender,'22'.repeat(32),{name:'Friend',text:'Second',at:2});
 assert.equal(f.displayed.size,1);assert.equal([...f.displayed.values()][0].body,'Second');
 assert.deepEqual([...f.displayed.values()][0].android.style.messages.map(m=>m.text),['First','Second']);
 await f.mod.finishRootMessageWake(owner,'axonic:1:'+'f'.repeat(64),'33'.repeat(32),{name:'Other',text:'Separate',at:3});
 await f.mod.finishRootMessageWake(owner,sender,'44'.repeat(32),{name:'Group',text:'Group message',at:4,group:'a'.repeat(64)});
 assert.equal(f.displayed.size,3);
 await f.mod.finishRootMessageWake(owner,'axonic:1:'+'f'.repeat(64),'55'.repeat(32),{name:'Group',text:'Another group member',at:5,group:'a'.repeat(64)});
 assert.equal(f.displayed.size,3);
});

test('expanded group notice retains each member while collapsed body shows the newest message',async t=>{
 const f=await fixture(t),group='ab'.repeat(32),other='axonic:1:'+'f'.repeat(64);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'11'.repeat(32),{group,name:'Family',senderName:'Alice',text:'First',at:10});
 await f.mod.finishRootMessageWake(f.recipient.account,other,'22'.repeat(32),{group,name:'Family',senderName:'Bob',text:'Latest',at:30});
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'33'.repeat(32),{group,name:'Family',senderName:'Alice',text:'Delayed',at:20});
 const n=[...f.displayed.values()][0];assert.equal(n.body,'Latest');assert.equal(n.data.sender,other);assert.equal(n.data.messageId,'22'.repeat(32));assert.equal(n.android.onlyAlertOnce,true);
 assert.deepEqual(n.android.style.messages.map(m=>[m.person.name,m.text]),[['Alice','First'],['Alice','Delayed'],['Bob','Latest']]);
 await f.mod.finishRootMessageWake(f.recipient.account,other,'22'.repeat(32),{group,name:'Family',senderName:'Bob',text:'Latest',at:30});
 assert.equal([...f.displayed.values()][0].android.style.messages.length,3);
});

test('dismissed notification starts a new expanded list instead of restoring old messages',async t=>{
 const f=await fixture(t);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'11'.repeat(32),{name:'Friend',text:'Old',at:1});
 f.displayed.clear();
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'22'.repeat(32),{name:'Friend',text:'New',at:2});
 assert.deepEqual([...f.displayed.values()][0].android.style.messages.map(m=>m.text),['New']);
});

test('an existing single-message notice from the old client is retained during upgrade',async t=>{
 const f=await fixture(t),id='root-conversation:'+f.recipient.account+':direct:'+f.sender.account;
 f.displayed.set(id,{id,title:'Friend',body:'Before update',data:{sender:f.sender.account,messageId:'11'.repeat(32),messageAt:'1'}});
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'22'.repeat(32),{name:'Friend',text:'After update',at:2});
 assert.deepEqual(f.displayed.get(id).android.style.messages.map(m=>m.text),['Before update','After update']);
});

test('delayed generic hints, older previews and old read updates preserve the newest preview',async t=>{
 const f=await fixture(t),owner=f.recipient.account,sender=f.sender.account;
 await f.mod.finishRootMessageWake(owner,sender,'11'.repeat(32),{name:'Friend',text:'Latest',at:20});
 await f.mod.receiveRootMessageWake(f.data);
 await f.mod.finishRootMessageWake(owner,sender,'22'.repeat(32),{name:'Friend',text:'Older',at:10});
 await f.mod.finishRootMessageWake(owner,sender,'22'.repeat(32),{name:'Friend',text:'Older',at:10,read:true});
 assert.equal(f.displayed.size,1);assert.equal([...f.displayed.values()][0].body,'Latest');
});

test('a decrypted group message replaces its own generic sender hint',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Group',text:'Hello group',at:Date.now(),group:'a'.repeat(64)});
 assert.equal(f.displayed.size,1);assert.equal([...f.displayed.values()][0].body,'Hello group');
});



test('muted group suppresses unclassified hints and group previews but direct previews still notify',async t=>{
 const f=await fixture(t),group='ab'.repeat(32);f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[],messages:[],groups:[{id:group,muted:true,members:[f.sender.account]}]}));
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{group,name:'Muted family',text:'quiet',at:Date.now()});assert.equal(f.shown.length,0);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'ef'.repeat(32),{name:'Friend',text:'direct',at:Date.now()});assert.equal(f.shown.length,1);assert.equal(f.shown[0].body,'direct');
});

test('opening the conversation during an OS preview display retires the racing notification',async t=>{
 const f=await fixture(t);f.onDisplay(()=>{f.app.currentState='active';f.visible();});
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Friend',text:'Hello',at:Date.now()});
 assert.equal(f.shown.length,1);assert.equal(f.displayed.size,0);assert.equal(f.cancelled.length,1);
});

test('128 retained previews cannot suppress a later valid signed wake or forget earlier deduplication',async t=>{
 const f=await fixture(t);
 for(let i=0;i<128;i++)await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,i.toString(16).padStart(64,'0'),{name:'Peer',text:'fixture',at:Date.now()});
 f.displayed.clear();f.shown.length=0;
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,1);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'00'.repeat(32),{name:'Peer',text:'old fixture',at:Date.now()});
 assert.equal(f.shown.length,1,'old preview remains deduplicated');
});

test('stalled recovery cannot postpone an authenticated background notice indefinitely',async t=>{
 const f=await fixture(t);let release,timedOut=false;const stalled=new Promise(resolve=>release=resolve);
 const task=f.mod.receiveRootMessageWake(f.data,()=>stalled);
 await new Promise(resolve=>{const stop=setTimeout(()=>{timedOut=true;release();resolve();},7000);f.onDisplay(()=>{clearTimeout(stop);release();resolve();});});
 await task;assert.equal(timedOut,false);assert.equal(f.shown.length,1);
});

test('screen-off native deadline publishes a hint when frame timers never run',async t=>{
 let calls=0,jsTimers=0,release;
 const f=await fixture(t,{setTimeout:()=>{jsTimers++;return 0;},native:{axonMessageWait:async ms=>{
  assert(ms>=1&&ms<=1000);calls++;await new Promise(resolve=>setTimeout(resolve,ms));
 }}});
 const recovery=new Promise(resolve=>release=resolve);
 f.onDisplay(()=>release());
 await f.mod.receiveRootMessageWake(f.data,()=>recovery);
 assert.equal(f.shown.length,1);assert.equal(jsTimers,0);assert(calls>=2);
 // The losing native deadline must not schedule its entire 25-second budget.
 const count=calls;await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(calls,count);
});

test('fast native recovery keeps the decrypted preview without a generic replacement',async t=>{
 const f=await fixture(t,{native:{axonMessageWait:ms=>new Promise(resolve=>setTimeout(resolve,ms))}});
 await f.mod.receiveRootMessageWake(f.data,()=>f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Peer',text:'recovered',at:Date.now()}));
 assert.equal(f.shown.length,1);assert.equal(f.shown[0].body,'recovered');
});

test('recovery after the old 1.5 second deadline still publishes only the preview',async t=>{
 const f=await fixture(t);
 await f.mod.receiveRootMessageWake(f.data,async()=>{
  await new Promise(resolve=>setTimeout(resolve,1800));
  await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Peer',text:'recovered after cold start',at:Date.now()});
 });
 assert.equal(f.shown.length,1);assert.equal(f.shown[0].body,'recovered after cold start');
});

test('a wake deadline survives foreground to background without frame timers',async t=>{
 let f,release,jsTimers=0;
 f=await fixture(t,{setTimeout:()=>{jsTimers++;return 0;},native:{axonMessageWait:async ms=>{
  f.app.currentState='background';await new Promise(resolve=>setTimeout(resolve,ms));
 }}});
 f.app.currentState='active';
 const recovery=new Promise(resolve=>release=resolve);
 f.onDisplay(()=>release());
 await f.mod.receiveRootMessageWake(f.data,()=>recovery);
 assert.equal(jsTimers,0);assert.equal(f.shown.length,1);
});

test('decrypted preview updates the same hint without sounding twice; a later message can alert',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Peer',text:'recovered',at:Date.now()});
 assert.equal(f.shown.at(-1).android.onlyAlertOnce,true);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'ef'.repeat(32),{name:'Peer',text:'next',at:Date.now()+1});
 assert.equal(f.shown.at(-1).android.onlyAlertOnce,false);
});

test('a repeated wake retires its stale generic alert after inbox delivery',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);assert.equal(f.displayed.size,1);
 f.delivered();await f.mod.receiveRootMessageWake(f.data);assert.equal(f.displayed.size,0);assert.equal(f.shown.length,1);
});

test('a deleted incoming message cannot produce a fresh generic alert from a relay retry',async t=>{
 const f=await fixture(t);f.storage.set('@axonic_root_chat_v1:'+f.recipient.account,JSON.stringify({version:1,contacts:[],messages:[],removedMessages:[{peer:f.sender.account,id:f.envelope.id,direction:'incoming'}]}));
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);
});

test('a repeated old hint does not clear a newer conversation alert',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);f.delivered();
 const n=[...f.displayed.values()][0];f.displayed.set(n.id,{...n,data:{...n.data,messageId:'ef'.repeat(32)}});
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.displayed.size,1);
});

test('a repeated hint does not erase its decrypted preview',async t=>{
 const f=await fixture(t);await f.mod.receiveRootMessageWake(f.data);f.delivered();
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,f.envelope.id,{name:'Peer',text:'Unread message',at:Date.now()});
 await f.mod.receiveRootMessageWake(f.data);assert.equal([...f.displayed.values()][0].body,'Unread message');
});

test('equal-time group notification previews use the shared message ID rather than recipient delivery ID',async t=>{
 const f=await fixture(t),at=Date.now(),group='a'.repeat(64);
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'ff'.repeat(32),{name:'Group',text:'first',at,group,orderId:'11'.repeat(32)});
 await f.mod.finishRootMessageWake(f.recipient.account,f.sender.account,'00'.repeat(32),{name:'Group',text:'second',at,group,orderId:'22'.repeat(32)});
 assert.deepEqual(f.shown.at(-1).android.style.messages.map(m=>m.text),['first','second']);assert.equal(f.shown.at(-1).body,'second');
});

test('only ciphertext bound to the verified wake reaches inline recovery',async t=>{
 const f=await fixture(t),data=c.createCustodyWake(f.envelope,f.sender,true);let received;
 await f.mod.receiveRootMessageWake(data,async(...args)=>{received=args[5];f.delivered();});assert.deepEqual(received,f.envelope);
 const bad=await fixture(t);let rejected='unset';
 await bad.mod.receiveRootMessageWake({...bad.data,envelope:JSON.stringify({...bad.envelope,id:'00'.repeat(32)})},async(...args)=>{rejected=args[5];bad.delivered();});assert.equal(rejected,undefined);
});

test('delivery during channel setup suppresses a late generic notification',async t=>{
 let delivered=()=>{};const f=await fixture(t,{onChannel:()=>delivered()});delivered=f.delivered;
 await f.mod.receiveRootMessageWake(f.data);assert.equal(f.shown.length,0);
});

test('signed silent read wake recovers but never alerts while account remains locked',async t=>{
 const f=await fixture(t,{silent:true});f.lock();let recovered=0;
 await f.mod.receiveRootMessageWake(f.data,async()=>{recovered++;});
 await f.mod.receiveRootMessageWake(f.data,async()=>{recovered++;});
 assert.equal(recovered,2);assert.equal(f.shown.length,0);
 const e=JSON.parse(f.data.event);assert.equal(e.wakeMode,'silent');delete e.wakeMode;
 await f.mod.receiveRootMessageWake({...f.data,event:JSON.stringify(e)},async()=>{recovered++;});
 assert.equal(recovered,2,'stripping silent intent invalidates wake signature');assert.equal(f.shown.length,0);
});
