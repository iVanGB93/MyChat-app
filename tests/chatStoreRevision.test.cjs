const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('receipt acknowledgments commit and wake network consumers without rebuilding visible history',async()=>{
 const out={},events=[],commits=[];let patches=0,fail=false;
 const projection=require('./helpers/attachment.cjs').load('conversationProjection');
 const indexed={writeScope:async(_scope,_before,raw)=>{if(fail)throw Error('disk');commits.push(raw);},readRooms:async()=>{throw Error('must not read the room');}};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/storage/chatStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
  if(name==='react-native')return {AppState:{currentState:'active'}};
  if(name==='./indexedChatStore')return {indexedChatEnabled:()=>true,indexedChatStore:()=>indexed};
  if(name.endsWith('/conversationProjection'))return projection;
  if(name.endsWith('/conversationPageStore'))return {createConversationPageStore:()=>({patch:async()=>{patches++;throw Error('unexpected projection');}})};
  if(name==='./storageReadSafety')return require('./helpers/storageSafety.cjs');
  return {checkNativeChatWrite:async()=>{}};
 },out);
 out.subscribeOwnChatWrites((owner,visible)=>events.push({owner,visible,revision:out.ownChatRevision(owner)}));
 const state={version:1,contacts:[],messages:[],actions:[{id:'a',peer:'p',direction:'outgoing',target:{id:'m',author:'p'},kind:'read',revision:1,text:'',at:1,status:'pending'}]};
 const before={raw:JSON.stringify(state),version:1,counts:{}};state.actions[0].status='delivered';
 const raw=JSON.stringify(state),store=out.ownChatStore('owner');await store.indexed.writeScope({peer:'p',ids:['a']},before,raw);
 assert.deepEqual(commits,[raw]);assert.equal(patches,0);assert.deepEqual(events,[{owner:'owner',visible:false,revision:1}]);
 fail=true;await assert.rejects(store.indexed.writeScope({peer:'p',ids:['a']},before,raw),/disk/);
 assert.equal(events.length,1);assert.equal(out.ownChatRevision('owner'),1);
});
test('chat permission change token advances only after a successful write and stays owner scoped',async()=>{
 let release,fail=false;const gate=new Promise(r=>release=r),out={};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/storage/chatStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='react-native'?{AppState:{currentState:'active'}}:name==='./indexedChatStore'?{indexedChatEnabled:()=>false}:name==='../../services/identity/conversationPageStore'?require('./helpers/attachment.cjs').load('conversationPageStore'):name==='./storageReadSafety'?require('./helpers/storageSafety.cjs'):name.includes('async-storage')?{default:{getItem:async()=>null,setItem:async()=>{await gate;if(fail)throw Error('disk');}}}:{checkNativeChatWrite:async()=>{}},out);
 const events=[];const off=out.subscribeOwnChatWrites(owner=>events.push([owner,out.ownChatRevision(owner)]));
 out.subscribeOwnChatWrites(()=>{throw Error('broken consumer');});
 const a=out.ownChatStore('one'),b=out.ownChatStore('two'),pending=a.write('{}');
 assert.equal(events.length,0);
 assert.equal(out.ownChatRevision('one'),0);release();await pending;
 assert.equal(out.ownChatRevision('one'),1);assert.equal(out.ownChatRevision('two'),0);
 await b.write('{}');assert.equal(out.ownChatRevision('two'),1);
 fail=true;await assert.rejects(a.write('{}'));assert.equal(out.ownChatRevision('one'),1);
 assert.deepEqual(events,[['one',1],['two',1]]);off();fail=false;await a.write('{}');assert.equal(events.length,2);
});

test('scoped writes publish the same rooms they invalidate, including action-only edits and group receipts',async()=>{
 const out={},events=[],patched=[];
 const projection=require('./helpers/attachment.cjs').load('conversationProjection');
 const indexed={write:async()=>{},writeScope:async()=>{},readRooms:async()=>''};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/storage/chatStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
  if(name==='./indexedChatStore')return {indexedChatEnabled:()=>true,indexedChatStore:()=>indexed};
  if(name.endsWith('/conversationProjection'))return projection;
  if(name.endsWith('/conversationPageStore'))return {createConversationPageStore:()=>({
   patch:async(rooms,_read,commit)=>{patched.push(rooms);await commit();},
   write:async(_raw,commit)=>commit(),
  })};
  if(name==='./storageReadSafety')return require('./helpers/storageSafety.cjs');
  return {checkNativeChatWrite:async()=>{}};
 },out);
 const store=out.ownChatStore('owner');
 out.subscribeOwnChatWrites((owner,visible,rooms)=>events.push([owner,visible,rooms,out.ownChatRevision(owner)]));
 const base={version:1,contacts:[],messages:[]};
 const save=(scope,before,after)=>store.indexed.writeScope(scope,{raw:JSON.stringify(before),version:1,counts:{}},JSON.stringify(after));
 const privateMessage={id:'private',peer:'p',direction:'outgoing',text:'hello',at:1,status:'pending'};
 await save({peer:'p',ids:['private']},base,{...base,messages:[privateMessage]});
 const action={id:'action',peer:'p',direction:'outgoing',target:{id:'private',author:'owner'},kind:'edit',revision:1,text:'new text',at:2,status:'pending'};
 await save({peer:'p',ids:['action','private']},base,{...base,actions:[action]});
 const group={id:'family',revision:1,messageId:'logical'};
 const groupMessage={...privateMessage,id:'copy',group};
 await save({peer:'p',ids:['copy']},{...base,messages:[groupMessage]},{...base,messages:[{...groupMessage,status:'delivered'}]});
 const groupRead={...action,group,target:{id:'logical',author:'p'},kind:'read',text:''};
 await save({groupRead:'family'},base,{...base,groupActions:[groupRead]});
 await save({metadata:true},base,{...base,contacts:[{account:'p',alias:'New name',accepted:true,blocked:false}]});
 await store.write(JSON.stringify(base));
 assert.deepEqual(patched,[['p'],['p'],['group:family'],['group:family'],[]]);
 assert.deepEqual(events,[...patched,undefined].map((rooms,index)=>['owner',true,rooms,index+1]));
});
