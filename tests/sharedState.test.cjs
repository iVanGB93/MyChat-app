const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(request=>request.startsWith('.')?load(path.resolve(path.dirname(file),request.replace(/\.ts$/,'')+'.ts')):require(request),exports);return exports;}
const {retainEqual,createObservedState}=load('src/services/identity/sharedState.ts');
const {createChatReadModel,indexConversationMessages,createConversationSelector}=load('src/modules/ui/chatReadModel.ts');
const {createPreferenceState}=load('src/services/identity/preferenceState.ts');
const {callMediaState,beginCallMediaState,clearCallMediaState}=load('src/services/identity/callMediaState.ts');
const owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64);
const fixture=(count=1000)=>({version:1,contacts:[{account:peer,alias:'Before',accepted:true,blocked:false}],messages:Array.from({length:count},(_,i)=>({id:i.toString(16).padStart(64,'0'),peer,text:'Fixture',at:i,direction:'incoming',status:'delivered'}))});
test('equal branches retain identity without mutating input or comparing through JSON strings',()=>{
 const old={list:[{a:1},{a:2}],missing:undefined};const next={list:[{a:1},{a:3}],missing:undefined};const result=retainEqual(old,next);
 assert.equal(result.list[0],old.list[0]);assert.notEqual(result.list[1],old.list[1]);assert.equal(old.list[1].a,2);assert.equal(next.list[1].a,3);
 assert.equal(retainEqual(old,structuredClone(old)),old);assert.notEqual(retainEqual({x:undefined},{}),old);
});
test('native objects are not traversed or converted to plain objects',()=>{const a=new Date(0),b=new Date(1);assert.equal(retainEqual(a,b),b);});
test('multiple observers attach one source and equal updates notify nobody',()=>{
 let value={count:1},starts=0,stops=0,changed,notifications=0;
 const state=createObservedState(()=>value,fn=>{starts++;changed=fn;return()=>stops++;});
 const a=state.subscribe(()=>notifications++),b=state.subscribe(()=>notifications++);
 assert.equal(starts,1);value={count:1};changed();assert.equal(notifications,0);
 value={count:2};changed();assert.equal(notifications,2);a();assert.equal(stops,0);b();assert.equal(stops,1);
 value={count:3};const c=state.subscribe(()=>{});assert.equal(state.getState().value.count,3);assert.equal(starts,2);c();
});
test('contact-only change retains all 1000 message objects AND the array',()=>{
 const model=createChatReadModel(),raw=fixture(),before=model.derive(owner,raw);
 const next=structuredClone(raw);next.contacts[0].alias='After';const after=model.derive(owner,next);
 assert.equal(after.messages,before.messages);assert.equal(after.messages.filter((m,i)=>m===before.messages[i]).length,1000);
 assert.equal(after.contacts[0].alias,'After');assert.equal(raw.contacts[0].alias,'Before');
});
test('new message and delivery changes preserve unrelated rows',()=>{
 const model=createChatReadModel(),raw=fixture(3),before=model.derive(owner,raw),next=structuredClone(raw);
 next.messages[1].storedAt=500;next.messages.push({...next.messages[2],id:'f'.repeat(64),at:500});const after=model.derive(owner,next);
 assert.equal(after.messages.find(m=>m.id===raw.messages[0].id),before.messages[0]);assert.notEqual(after.messages.find(m=>m.id===raw.messages[1].id),before.messages[1]);
});
test('edits and read actions invalidate message presentation without changing wire payload',()=>{
 const model=createChatReadModel(),raw=fixture(2),before=model.derive(owner,raw);
 const next={...raw,actions:[{id:'f'.repeat(64),peer,direction:'incoming',kind:'edit',target:{id:raw.messages[0].id,author:peer},revision:1,text:'Edited',at:4,status:'delivered'}]};
 const after=model.derive(owner,next);assert.equal(after.messages[0].text,'Edited');assert.equal(raw.messages[0].text,'Fixture');assert.equal(after.messages[1],before.messages[1]);
});
test('owner change and explicit lock clearing discard reusable private objects',()=>{
 const model=createChatReadModel(),raw=fixture(1),before=model.derive(owner,raw);model.clear();assert.notEqual(model.derive(owner,raw).messages[0],before.messages[0]);
 const other=model.derive(peer,{version:1,contacts:[],messages:[]});assert.equal(other.messages.length,0);
});
test('unrelated messages and protocol queues leave an open conversation unchanged',()=>{
 const model=createChatReadModel(),raw=fixture(3),before=model.derive(owner,raw),rooms=indexConversationMessages(before,{}),select=createConversationSelector(peer),first=select(before,rooms);
 const next=structuredClone(raw);next.messages.push({...next.messages[0],peer:owner,id:'f'.repeat(64)});next.profileRequests=[];
 const after=model.derive(owner,next),index=indexConversationMessages(after,rooms);
 assert.equal(index[peer],rooms[peer]);assert.equal(select(after,index),first);assert.equal(first.messages.length,3);
});
test('preferences coalesce concurrent reads and a late read cannot undo a saved choice',async()=>{
 let resolve,reads=0;const prefs=createPreferenceState(()=>{reads++;return new Promise(r=>resolve=r);},async()=>{});
 const a=prefs.read('owner'),b=prefs.read('owner');assert.equal(a,b);assert.equal(reads,1);
 await prefs.write('owner',{sound:false});resolve({sound:true});assert.deepEqual(await a,{sound:false});assert.equal(prefs.getState().values.owner.sound,false);
});
test('failed preference writes preserve the last committed value',async()=>{
 const prefs=createPreferenceState(async()=>({sound:true}),async()=>{throw Error('disk');});await prefs.read('owner');
 await assert.rejects(prefs.write('owner',{sound:false}),/disk/);assert.equal(prefs.getState().values.owner.sound,true);
});
test('old call cleanup and events cannot overwrite a newer media owner',()=>{
 const value={connection:'p2p',recovering:false,muted:false,cameraOff:false,sharing:false,remoteSharing:false,sharingBusy:false,quality:'good'};
 const a=beginCallMediaState('a');a.update(value);const b=beginCallMediaState('b');b.update({...value,muted:true});a.update(value);a.stop();assert.equal(callMediaState.getState().value.id,'b');assert.equal(callMediaState.getState().value.muted,true);
 clearCallMediaState();b.update(value);assert.equal(callMediaState.getState().value,null);
});
