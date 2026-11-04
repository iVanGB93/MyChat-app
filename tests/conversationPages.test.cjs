const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');
const {createConversationPageStore}=load('conversationPageStore');
const {buildConversationProjection,messagePosition,conversationCachePrefix}=load('conversationProjection');
const owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64),other='axonic:1:'+'c'.repeat(64),id=n=>n.toString(16).padStart(64,'0');
const message=(n,room=peer)=>({id:id(n),peer:room,direction:'incoming',text:'message '+n,at:1000+n,status:'delivered'});
test('presentation comparison ignores only transport bookkeeping, including unloaded action targets',()=>{
 const {conversationPresentationChanged:changed}=load('conversationProjection');
 const before={version:1,contacts:[],messages:[],actions:[{id:id(900),peer,direction:'outgoing',target:{id:id(1),author:peer},kind:'read',revision:1,text:'',at:1,status:'pending'}]};
 const ack=structuredClone(before);ack.actions[0].status='delivered';assert.equal(changed(owner,before,ack),false);
 for(const change of [s=>s.actions.push({...s.actions[0],id:id(901),kind:'delete'}),s=>s.actions[0].text='edited',s=>s.contacts.push({account:peer,accepted:true}),s=>s.messages.push(message(1)),s=>s.hiddenChats=[peer],s=>s.groups=[{id:id(5),accepted:true}]]){
  const next=structuredClone(ack);change(next);assert.equal(changed(owner,ack,next),true);
 }
 const incoming={...ack,messages:[message(1)]},read=structuredClone(incoming);read.actions=[];assert.equal(changed(owner,incoming,read),true);
});
function history(n=125){return {version:1,contacts:[{account:peer,alias:'Peer',accepted:true,blocked:false},{account:other,alias:'Other',accepted:true,blocked:false}],messages:Array.from({length:n},(_,n)=>message(n+1))};}
function fixture(state=history()){
 const data=new Map(),reads=[],writes=[];let raw=JSON.stringify(state),sourceReads=0,fail;
 const deps={get:async key=>{reads.push(key);if(fail?.('get',key))throw Error('disk read');return data.get(key)??null;},set:async(key,value)=>{if(fail?.('set',key))throw Error('disk write');writes.push(key);data.set(key,value);},remove:async keys=>{for(const key of keys)data.delete(key);},readSource:async()=>{sourceReads++;if(fail?.('source',''))throw Error('history unavailable');return raw;}};
 const open=()=>createConversationPageStore(owner,deps);let store=open();
 return {data,reads,writes,deps,get store(){return store;},restart(){store=open();},fail(fn){fail=fn;},sourceReads:()=>sourceReads,resetCounts(){reads.length=0;writes.length=0;sourceReads=0;},async save(state){const next=JSON.stringify(state);await store.write(next,async()=>{if(fail?.('commit',''))throw Error('commit failed');raw=next;});},setSource(v){raw=v;}};
}
test('cold chat list reads persisted summaries only, without ledger or page reads',async()=>{
 const state=history();state.messages.push(...Array.from({length:100},(_,i)=>message(i+200,other)));
 const f=fixture(state);const first=await f.store.index();assert.equal(f.sourceReads(),1);assert.equal(first.state.messages.length,0);assert.equal(first.summaries[peer].count,125);assert.equal(first.summaries[peer].unread,125);
 f.restart();f.resetCounts();const index=await f.store.index();assert.equal(f.sourceReads(),0);assert.equal(f.reads.length,1);assert(!f.reads.some(k=>k.includes(':page:')));assert.equal(index.summaries[peer].last.text,'message 125');
});
test('a chat starts at 50, grows in pages and does not read other conversations',async()=>{
 const state=history();state.messages.push(...Array.from({length:100},(_,i)=>message(i+200,other)));const f=fixture(state);await f.store.index();f.resetCounts();
 const a=await f.store.readWindow(peer);assert.equal(a.messages.length,50);assert.equal(a.messages[0].id,id(76));assert(a.hasMore);assert.equal(f.sourceReads(),0);assert(f.reads.every(k=>!k.includes(other+':')));
 const b=await f.store.readWindow(peer,100,a.oldest);assert.equal(b.messages.length,100);assert.equal(b.messages[0].id,id(26));assert.equal(new Set(b.messages.map(m=>m.id)).size,100);
 const c=await f.store.readWindow(peer,150,b.oldest);assert.equal(c.messages.length,125);assert.equal(c.hasMore,false);
});
test('new arrivals preserve the loaded oldest key; ties remain deterministic',async()=>{
 const state=history(),f=fixture(state);const first=await f.store.readWindow(peer,100);
 state.messages.push(message(126),{...message(127),at:1126});await f.save(state);
 const next=await f.store.readWindow(peer,100,first.oldest);assert.equal(next.messages.length,102);assert.deepEqual(next.oldest,first.oldest);assert.equal(new Set(next.messages.map(m=>m.id)).size,102);assert.deepEqual(next.messages.slice(-2).map(m=>m.id),[id(126),id(127)]);
});
test('old quote targets are fetched separately without adding old bubbles to the page',async()=>{
 const state=history();state.messages[124].reply={id:id(1),author:peer};const f=fixture(state);await f.store.index();f.resetCounts();
 const page=await f.store.readWindow(peer);assert.equal(page.messages.length,50);assert.equal(page.references.length,1);assert.equal(page.references[0].id,id(1));assert.equal(f.sourceReads(),0);assert.equal(f.reads.filter(k=>k.includes(':page:')).length,3);
});
test('edits, deletes, reads and hidden chats update summary and quote without changing source',async()=>{
 const state=history();state.messages[124].reply={id:id(1),author:peer};const f=fixture(state);await f.store.index();
 state.actions=[{id:id(900),peer,direction:'incoming',target:{id:id(125),author:peer},kind:'edit',text:'Edited',revision:1,at:2000,status:'delivered'},{id:id(901),peer,direction:'outgoing',target:{id:id(125),author:peer},kind:'read',text:'',revision:1,at:2001,status:'delivered'},{id:id(902),peer,direction:'incoming',target:{id:id(1),author:peer},kind:'delete',text:'',revision:1,at:2002,status:'delivered'}];
 state.hiddenChats=[other];const before=JSON.stringify(state);await f.save(state);const index=await f.store.index();assert.equal(index.summaries[peer].last.text,'Edited');assert.equal(index.summaries[peer].unread,123);assert.deepEqual(index.state.hiddenChats,[other]);assert.equal((await f.store.readWindow(peer)).references[0].deleted,true);assert.equal(JSON.stringify(state),before);
});
test('group delivery copies coalesce before counting or paging and preserve worst receipt',()=>{
 const group={id:id(800),revision:1,messageId:id(801)},state=history(0);state.groups=[{id:group.id,name:'Group',members:[owner,peer,other],admin:owner,accepted:true,blocked:false,revision:1}];
 state.messages=[{...message(1),direction:'outgoing',group},{...message(2,other),direction:'outgoing',group,status:'pending'}];const result=buildConversationProjection(owner,JSON.stringify(state),1),key='group:'+group.id;
 assert.equal(result.index.summaries[key].count,1);assert.equal(result.index.summaries[key].last.status,'pending');assert.equal(JSON.parse(result.values.get(result.index.rooms[key].pages[0].key)).length,1);
});
test('dirty marker survives failure after authoritative commit, then restart repairs from actual source',async()=>{
 const f=fixture();await f.store.index();f.fail((op,key)=>op==='set'&&key.includes(':page:'));await f.save(history(126));
 assert.equal(JSON.parse(f.data.get(conversationCachePrefix(owner)+'index')).dirty,true);f.fail();f.restart();const result=await f.store.index();assert.equal(result.summaries[peer].count,126);assert(!result.dirty);assert.equal((await f.store.readWindow(peer)).messages.at(-1).id,id(126));
});
test('failed authoritative write cannot fabricate a new summary',async()=>{
 const f=fixture();await f.store.index();f.fail(op=>op==='commit');await assert.rejects(f.save(history(130)),/commit failed/);f.fail();f.restart();assert.equal((await f.store.index()).summaries[peer].count,125);
});
test('dirty-marker failure refuses the authoritative write',async()=>{
 const f=fixture();await f.store.index();f.fail((op,key)=>op==='set'&&key.endsWith(':index'));await assert.rejects(f.save(history(130)),/disk write/);f.fail();assert.equal((await f.store.index()).summaries[peer].count,125);
});
test('unavailable primary history is not converted into empty history during index recovery',async()=>{
 const f=fixture();f.fail(op=>op==='source');await assert.rejects(f.store.index(),/history unavailable/);f.fail();assert.equal((await f.store.index()).summaries[peer].count,125);
});
test('corrupt page is rebuilt; corrupt authoritative source propagates without erasing it',async()=>{
 const f=fixture();const index=await f.store.index(),key=index.rooms[peer].pages.at(-1).key;f.data.set(key,'[]');f.restart();assert.equal((await f.store.readWindow(peer)).messages.length,50);
 f.data.set(key,'broken');f.setSource('broken canonical');await assert.rejects(f.store.readWindow(peer));
});
test('unchanged conversation pages are not rewritten for another conversation',async()=>{
 const state=history(),f=fixture(state);await f.store.index();f.resetCounts();state.messages.push(message(300,other));await f.save(state);assert(!f.writes.some(k=>k.includes(peer+':page:')));assert(f.writes.some(k=>k.includes(other+':page:')));
});
test('page cleanup and account removal remain account-scoped',async()=>{
 const f=fixture(),foreign=conversationCachePrefix(other)+'index';f.data.set(foreign,'keep');await f.store.index();await f.save(history(1));assert.equal(f.data.get(foreign),'keep');assert(!f.data.has(conversationCachePrefix(owner)+peer+':page:2'));
 const {deviceRemovalKeys}=load('deviceRemoval');assert.deepEqual(deviceRemovalKeys([foreign,conversationCachePrefix(owner)+'index'],owner),[conversationCachePrefix(owner)+'index']);
});


test('native ASCII hashing preserves accented text, emoji and quote content exactly',async()=>{
 const state=history(55);state.messages[54].text='Familia: mañana 🧠 中文';state.messages[54].reply={id:id(1),author:peer};state.messages[0].text='Foto 👨‍👩‍👧';
 const {projectionHash}=load('conversationProjection');let calls=0;
 const hash=raw=>{calls++;assert(!/[^\x00-\x7f]/.test(raw));return projectionHash(raw);};
 const f=fixture(state),store=createConversationPageStore(owner,{...f.deps,hash});
 const page=await store.readWindow(peer);assert.equal(page.messages.at(-1).text,state.messages[54].text);assert.equal(page.references[0].text,state.messages[0].text);assert(calls>0);
});

test('older index schema rebuilds from preserved source before using native hash',async()=>{
 const f=fixture();await f.store.index();const key=conversationCachePrefix(owner)+'index',old=JSON.parse(f.data.get(key));old.version=1;f.data.set(key,JSON.stringify(old));f.restart();f.resetCounts();
 assert.equal((await f.store.index()).version,2);assert.equal(f.sourceReads(),1);assert.equal((await f.store.readWindow(peer)).messages.length,50);
});


test('older history remains reachable past five thousand messages',async()=>{
 const f=fixture(history(5051)),page=await f.store.readWindow(peer,5100);assert.equal(page.messages.length,5051);assert.equal(page.hasMore,false);assert.equal(page.messages[0].id,id(1));
});


test('selected canonical writes refresh one room and preserve other room pages',async()=>{
 const state=history(125);state.messages.push(message(500,other));const f=fixture(state);await f.store.index();f.resetCounts();
 const next=structuredClone(state);next.messages.find(m=>m.id===id(125)).text='changed';
 const partial={...next,messages:next.messages.filter(m=>m.peer===peer)};
 await f.store.patch([peer],async()=>JSON.stringify(partial),async()=>f.setSource(JSON.stringify(next)));
 assert.equal(f.sourceReads(),0);assert(!f.writes.some(k=>k.includes(other+':page:')));const index=await f.store.index();assert.equal(index.summaries[peer].last.text,'changed');assert.equal(index.summaries[other].count,1);assert.equal((await f.store.readWindow(other)).messages[0].id,id(500));
});
test('failed selected projection leaves a dirty recovery marker but never fails a committed change',async()=>{
 const f=fixture();await f.store.index();await f.store.patch([peer],async()=>{throw Error('projection read');},async()=>f.setSource(JSON.stringify(history(126))));
 assert.equal(JSON.parse(f.data.get(conversationCachePrefix(owner)+'index')).dirty,true);assert.equal((await f.store.index()).summaries[peer].count,126);
});

test('jumping to an old quote expands only its conversation through the original',async()=>{
 const state=history(180);state.messages[179].reply={id:id(25),author:peer};state.messages.push(...Array.from({length:100},(_,n)=>message(300+n,other)));
 const f=fixture(state);await f.store.index();const first=await f.store.readWindow(peer);const original=first.references.find(m=>m.id===id(25));assert(original);assert(!first.messages.some(m=>m.id===original.id));
 f.resetCounts();const next=await f.store.readWindow(peer,50,messagePosition(original,owner));assert.equal(next.messages[0].id,id(25));assert.equal(next.messages.at(-1).id,id(180));assert.equal(next.hasMore,true);assert.equal(f.sourceReads(),0);assert(f.reads.every(k=>!k.includes(other+':')));
});

test('background commits leave a durable dirty projection and rebuild only on UI demand after restart',async()=>{
 const state=history(),f=fixture(state);await f.store.index();f.resetCounts();f.deps.deferProjection=()=>true;
 const next=history(126);await f.save(next);
 assert.equal(f.sourceReads(),0);assert.equal(f.writes.length,1,'only dirty marker, no display pages during delivery');
 assert.equal(JSON.parse(f.data.get(conversationCachePrefix(owner)+'index')).dirty,true);
 f.restart();f.resetCounts();const index=await f.store.index();
 assert.equal(f.sourceReads(),1);assert.equal(index.summaries[peer].count,126);assert.equal((await f.store.readWindow(peer)).messages.at(-1).id,id(126));
});

test('background sparse commit skips room-history fetch and remains recoverable',async()=>{
 const f=fixture();await f.store.index();f.resetCounts();f.deps.deferProjection=()=>true;let partialReads=0,committed=0;
 await f.store.patch([peer],async()=>{partialReads++;throw Error('UI history must not be read');},async()=>{committed++;f.setSource(JSON.stringify(history(126)));});
 assert.equal(committed,1);assert.equal(partialReads,0);assert.equal(f.writes.length,1);
 f.restart();assert.equal((await f.store.index()).summaries[peer].count,126);
});

test('background projection deferral never hides an authoritative commit failure',async()=>{
 const f=fixture();await f.store.index();f.deps.deferProjection=()=>true;f.fail(op=>op==='commit');
 await assert.rejects(f.save(history(126)),/commit failed/);f.fail();f.restart();assert.equal((await f.store.index()).summaries[peer].count,125);
});

test('notification open after multiple background commits repairs only dirty conversations after restart',async()=>{
 const state=history(125);state.messages.push(message(500,other));const f=fixture(state);await f.store.index();f.resetCounts();
 const requested=[];f.deps.deferProjection=()=>true;
 f.deps.readRooms=async rooms=>{requested.push([...rooms]);return JSON.stringify({...state,messages:state.messages.filter(m=>rooms.includes(m.group?'group:'+m.group.id:m.peer))});};
 state.messages.push(message(126));await f.store.patch([peer],async()=>{throw Error('no background projection');},async()=>f.setSource(JSON.stringify(state)));
 state.messages.push(message(127));await f.store.patch([peer],async()=>{throw Error('no background projection');},async()=>f.setSource(JSON.stringify(state)));
 assert.deepEqual(JSON.parse(f.data.get(conversationCachePrefix(owner)+'index')).dirtyRooms,[peer]);
 f.restart();f.resetCounts();const page=await f.store.readWindow(peer);
 assert.equal(page.messages.at(-1).id,id(127));assert.equal(page.messages.length,50);assert.equal(f.sourceReads(),0);assert.deepEqual(requested,[[peer]]);
 assert(!f.writes.some(k=>k.includes(other+':page:')));assert.equal((await f.store.index()).summaries[other].count,1);
});

test('dirty room union includes groups and metadata, and failed recovery preserves the marker',async()=>{
 const state=history(2),f=fixture(state),group=id(800),room='group:'+group;await f.store.index();f.deps.deferProjection=()=>true;
 for(const rooms of [[peer],[room],[]])await f.store.patch(rooms,async()=>'',async()=>{});
 const key=conversationCachePrefix(owner)+'index';assert.deepEqual(JSON.parse(f.data.get(key)).dirtyRooms,[peer,room]);
 f.deps.readRooms=async()=>{throw Error('read unavailable');};f.restart();await assert.rejects(f.store.index(),/read unavailable/);assert.equal(JSON.parse(f.data.get(key)).dirty,true);
 state.contacts[0].alias='Updated';f.deps.readRooms=async rooms=>{assert.deepEqual(rooms,[peer,room]);return JSON.stringify(state);};
 assert.equal((await f.store.index()).state.contacts[0].alias,'Updated');assert.equal(JSON.parse(f.data.get(key)).dirtyRooms,undefined);
});

test('whole-history writes invalidate scoped recovery instead of leaving unrelated changes stale',async()=>{
 const f=fixture();await f.store.index();f.deps.deferProjection=()=>true;f.deps.readRooms=async()=>{throw Error('must fully recover');};
 await f.store.patch([peer],async()=>'',async()=>{});const next=history(126);next.messages.push(message(600,other));await f.save(next);
 const key=conversationCachePrefix(owner)+'index';assert.equal(JSON.parse(f.data.get(key)).dirtyRooms,undefined);f.restart();f.resetCounts();
 assert.equal((await f.store.index()).summaries[other].count,1);assert.equal(f.sourceReads(),1);
});

test('failed scoped commit repairs from actual data and cannot fabricate an incoming message',async()=>{
 const state=history(2),f=fixture(state);await f.store.index();f.deps.readRooms=async()=>JSON.stringify(state);
 await assert.rejects(f.store.patch([peer],async()=>'',async()=>{throw Error('commit failed');}),/commit failed/);
 f.restart();assert.equal((await f.store.readWindow(peer)).messages.length,2);
});
