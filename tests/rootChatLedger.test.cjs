const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out=require('./helpers/attachment.cjs').load('rootChatLedger');
const a='axonic:1:'+'a'.repeat(64),b='axonic:1:'+'b'.repeat(64),id='1'.repeat(64);

test('revision cache reuses persisted bytes but not mutable snapshots or external updates',async()=>{
 let raw=null,revision=0,reads=0,active=true;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>active,revision:()=>revision,read:async()=>{reads++;return raw;},write:async value=>{raw=value;revision++;}});
 await ledger.configure(b,{accepted:true});assert.equal(reads,1);
 const first=await ledger.snapshot();first.contacts[0].blocked=true;
 assert.equal((await ledger.snapshot()).contacts[0].blocked,false);assert.equal(reads,1);
 const state=JSON.parse(raw);state.contacts[0].blocked=true;raw=JSON.stringify(state);revision++;
 assert.equal((await ledger.snapshot()).contacts[0].blocked,true);assert.equal(reads,2);
 active=false;await assert.rejects(ledger.snapshot(),/Unlock/);
 ledger.invalidateReadCache();active=true;await ledger.snapshot();assert.equal(reads,3);
});

test('an overlapping external write cannot label old committed bytes with the newer revision',async()=>{
 let raw=null,revision=0,reads=0,handoffs=0;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,revision:()=>revision,stateCommitted:()=>handoffs++,read:async()=>{reads++;return raw;},write:async value=>{raw=value;revision++;const s=JSON.parse(raw);s.contacts[0].blocked=true;raw=JSON.stringify(s);revision++;}});
 await ledger.configure(b,{accepted:true});assert.equal((await ledger.snapshot()).contacts[0].blocked,true);assert.equal(reads,2);assert.equal(handoffs,0);
});

test('uncertain writes invalidate cached history even when their revision did not advance',async()=>{
 let raw=null,revision=0,reads=0,fail=false,handoffs=0;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,revision:()=>revision,stateCommitted:()=>handoffs++,read:async()=>{reads++;return raw;},write:async value=>{raw=value;if(fail)throw Error('uncertain write');revision++;}});
 await ledger.configure(b,{accepted:true});await ledger.snapshot();assert.equal(reads,1);
 fail=true;await assert.rejects(ledger.configure(b,{blocked:true}),/uncertain write/);
 assert.equal(handoffs,1);assert.equal((await ledger.snapshot()).contacts[0].blocked,true);assert.equal(reads,2);
});

test('state handoff occurs only after durable success; observer failure cannot roll it back',async()=>{
 let raw=null,fail=false,active=true,calls=0;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>active,read:async()=>raw,
  write:async value=>{if(fail)throw Error('disk');raw=value;},stateCommitted:state=>{calls++;assert.equal(raw,state);throw Error('observer');}});
 await ledger.configure(b,{accepted:true});assert.equal(calls,1);
 fail=true;await assert.rejects(ledger.configure(b,{blocked:true}),/disk/);assert.equal(calls,1);
 active=false;await assert.rejects(ledger.configure(b,{blocked:true}),/Unlock/);assert.equal(calls,1);
});

test('revision snapshot rejects external writes during storage read and account locking',async()=>{
 for(const locking of [false,true]){
  let revision=0,active=true,resolve;
  const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>active,read:()=>new Promise(r=>resolve=r),write:async()=>{}});
  const pending=ledger.revisionSnapshot(()=>revision);await new Promise(r=>setImmediate(r));
  if(locking)active=false;else revision++;
  resolve(null);if(locking)await assert.rejects(pending,/Unlock/);else assert.equal(await pending,null);
 }
});

test('concurrent snapshots share one storage read but never mutable results or queued writes',async()=>{
 let raw=null,reads=0;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,read:async()=>{reads++;return raw;},write:async v=>{raw=v;}});
 const snapshots=await Promise.all(Array.from({length:20},()=>ledger.snapshot()));
 assert.equal(reads,1);snapshots[0].contacts.push({peer:b});assert.equal(snapshots[1].contacts.length,0);
 const before=ledger.snapshot(),write=ledger.configure(b,{alias:'Friend',accepted:true}),after=ledger.snapshot();
 assert.equal((await before).contacts.length,0);await write;assert.equal((await after).contacts.length,1);
 const previous=reads;await ledger.snapshot();assert.equal(reads,previous+1,'settled snapshots are not cached');
});

test('shared snapshot failures recover and account locking rejects every waiting reader',async()=>{
 let fail=true,active=true,release;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>active,read:async()=>{if(fail)throw Error('disk unavailable');return null;},write:async()=>{}});
 const failures=await Promise.allSettled([ledger.snapshot(),ledger.snapshot()]);assert(failures.every(r=>r.status==='rejected'));
 fail=false;await ledger.snapshot();
 const locked=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>active,read:()=>new Promise(r=>{release=r;}),write:async()=>{}});
 const pending=[locked.snapshot(),locked.snapshot()];await new Promise(r=>setImmediate(r));active=false;release(null);
 assert((await Promise.allSettled(pending)).every(r=>r.status==='rejected'));
});
test('retired local attachments become inert resend notices without rewriting storage on read',async()=>{
 for(const version of [1,2,3]){
  const attachment={manifest:{version,id},name:'old.jpg'},original=JSON.stringify({version:1,contacts:[],messages:[{id,peer:b,direction:'outgoing',text:'old.jpg',at:100,status:'pending',attachment}]});
  let raw=original;
  const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,read:async()=>raw,write:async v=>{raw=v;}});
  for(let i=0;i<2;i++){const state=await ledger.snapshot();assert.match(state.messages[0].text,/earlier version/);assert.equal(state.messages[0].attachment,undefined);assert.deepEqual(state.messages[0].retiredAttachment,attachment);assert.deepEqual(out.pendingRootChat(state,a),[]);}
  assert.equal(raw,original);
  await ledger.configure(b,{alias:'Friend',accepted:true});
  const reloaded=await ledger.snapshot();assert.deepEqual(reloaded.messages[0].retiredAttachment,attachment);assert.deepEqual(out.pendingRootChat(reloaded,a),[]);
 }
});
test('malformed current attachment still fails validation rather than being hidden',async()=>{
 const raw=JSON.stringify({version:1,contacts:[],messages:[{id,peer:b,direction:'outgoing',text:'new.jpg',at:100,status:'pending',attachment:{manifest:{version:4},name:'new.jpg'}}]});
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,read:async()=>raw,write:async()=>{throw Error('unexpected write');}});
 await assert.rejects(ledger.snapshot(),/needs recovery/);
});
test('confirmed routes persist, stay local, and cannot be overwritten by retries',async()=>{
 const {deliveryEvidence}=require('./helpers/attachment.cjs').load('deliveryEvidence'),f=fixture();
 const receipt=deliveryEvidence('receipt',100,b);
 await f.ledger.enqueue(b,id,'route test');await f.ledger.networkStored(b,id,200000);
 assert.equal((await f.ledger.snapshot()).messages[0].messageDelivery,undefined);
 await f.ledger.delivered(b,id,receipt);await f.ledger.delivered(b,id,deliveryEvidence('receipt',200));
 const m=(await f.ledger.snapshot()).messages[0];assert.deepEqual(m.messageDelivery,receipt);
 assert.equal(out.encodeRootMessage(m).includes('receipt'),false);
 const incoming=fixture(b),payload=deliveryEvidence('payload',120,a);
 await incoming.ledger.receive(a,id,out.encodeRootMessage(m),payload);
 await incoming.ledger.receive(a,id,out.encodeRootMessage(m),deliveryEvidence('payload',220));
 assert.deepEqual((await incoming.ledger.snapshot()).messages[0].messageDelivery,payload);
});
test('duplicate delivery receipts do not rewrite history or repeat commit notifications',async()=>{
 let raw=null,writes=0,commits=0;
 const ledger=out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,read:async()=>raw,write:async v=>{raw=v;writes++;},messageCommitted:()=>commits++});
 await ledger.enqueue(b,id,'receipt test');await ledger.delivered(b,id);
 const saved=raw,count=writes,committed=commits;
 for(let i=0;i<12;i++)await ledger.delivered(b,id);
 assert.equal(writes,count);assert.equal(raw,saved);assert.equal(commits,committed);
 assert.equal((await ledger.snapshot()).messages[0].status,'delivered');
});
test('validated-byte reuse isolates snapshots, rejects changed storage and still checks unlock',async()=>{
 let raw=JSON.stringify({version:1,messages:[],contacts:[]}),active=true;
 const ledger=out.createRootChatLedger({owner:a,now:Date.now,current:()=>active,read:async()=>raw,write:async value=>{raw=value;}});
 const first=await ledger.snapshot();first.contacts.push({account:b,alias:'not saved',accepted:true,blocked:false});
 assert.deepEqual((await ledger.snapshot()).contacts,[]);
 raw=JSON.stringify({version:1,messages:[],contacts:[{account:b,alias:42}]});
 await assert.rejects(ledger.snapshot(),/needs recovery/);
 await assert.rejects(ledger.snapshot(),/needs recovery/);
 raw=JSON.stringify({version:1,messages:[],contacts:[]});await ledger.snapshot();
 active=false;await assert.rejects(ledger.snapshot(),/Unlock/);
});
function fixture(owner=a){let raw=null,active=true,fail=false;const ledger=out.createRootChatLedger({owner,now:()=>100000,current:()=>active,read:async()=>raw,write:async v=>{if(fail)throw Error('disk');raw=v;}});return {ledger,lock:()=>active=false,fail:()=>fail=true,corrupt:()=>raw='broken'};}
test('identity-addressed text persists before acknowledgement and deduplicates retries',async()=>{const f=fixture(),wire=out.encodeRootChat(a,id,'hello');assert.equal(await f.ledger.receive(b,id,wire),true);assert.equal(await f.ledger.receive(b,id,wire),true);const s=await f.ledger.snapshot();assert.equal(s.messages.length,1);assert.equal(s.contacts[0].accepted,false);assert.equal(await f.ledger.receive(b,id,out.encodeRootChat(a,id,'changed')),false);});
test('wrong recipient and blocked sender cannot enter the inbox',async()=>{const f=fixture();assert.equal(await f.ledger.receive(b,id,out.encodeRootChat(b,id,'hello')),false);await f.ledger.configure(b,{blocked:true});assert.equal(await f.ledger.receive(b,id,out.encodeRootChat(a,id,'hello')),false);assert.equal((await f.ledger.snapshot()).messages.length,0);});

test('delete chat clears history but preserves nickname and acceptance; old delivery cannot restore it',async()=>{
 const f=fixture();await f.ledger.configure(b,{alias:'Friend',accepted:true});
 const wire=out.encodeRootChat(a,id,'old message');await f.ledger.receive(b,id,wire);
 await f.ledger.deleteChats([b]);let s=await f.ledger.snapshot();
 assert.equal(s.messages.length,0);assert.deepEqual(s.hiddenChats,[b]);
 assert.equal(s.contacts[0].alias,'Friend');assert.equal(s.contacts[0].accepted,true);
 assert.equal(await f.ledger.receive(b,id,wire),true);
 assert.equal((await f.ledger.snapshot()).messages.length,0);
 const next='2'.repeat(64);await f.ledger.receive(b,next,out.encodeRootChat(a,next,'new message'));
 s=await f.ledger.snapshot();assert.deepEqual(s.hiddenChats,[]);assert.equal(s.messages.length,1);
 assert.equal(s.contacts[0].accepted,true);
});

test('deleting one chat keeps other conversations and saved rejection; explicit restart unhides it',async()=>{
 const f=fixture(),c='axonic:1:'+'c'.repeat(64);
 await f.ledger.enqueue(b,id,'one');await f.ledger.enqueue(c,'2'.repeat(64),'two');
 await f.ledger.configure(b,{blocked:true,accepted:false});await f.ledger.deleteChats([b]);
 let s=await f.ledger.snapshot();assert.equal(s.messages.length,1);assert.equal(s.messages[0].peer,c);
 assert.equal(s.contacts.find(x=>x.account===b).blocked,true);
 await f.ledger.configure(b,{accepted:true});s=await f.ledger.snapshot();
 assert.deepEqual(s.hiddenChats,[]);assert.equal(s.contacts.find(x=>x.account===b).blocked,true);
});

test('failed or locked deletion leaves the saved conversation intact',async()=>{
 const f=fixture();await f.ledger.enqueue(b,id,'keep');f.fail();
 await assert.rejects(f.ledger.deleteChats([b]));assert.equal((await f.ledger.snapshot()).messages.length,1);
 f.lock();await assert.rejects(f.ledger.deleteChats([b]),/Unlock/);
});

test('initiating a chat accepts it locally without accepting it for the recipient',async()=>{
 const sender=fixture(a),recipient=fixture(b);
 await sender.ledger.configure(b,{accepted:true});
 assert.equal((await sender.ledger.snapshot()).contacts[0].accepted,true);
 assert.equal((await sender.ledger.snapshot()).messages.length,0);
 await sender.ledger.enqueue(b,id,'hello');
 await recipient.ledger.receive(a,id,out.encodeRootChat(b,id,'hello'));
 assert.equal((await recipient.ledger.snapshot()).contacts[0].accepted,false);
});

test('accept and reject decisions persist across reopening the ledger and later messages',async()=>{
 for(const accept of [true,false]){
  let raw=null;
  const open=()=>out.createRootChatLedger({owner:a,now:()=>100000,current:()=>true,read:async()=>raw,write:async v=>{raw=v;}});
  const first=open();await first.receive(b,id,out.encodeRootChat(a,id,'request'));
  await first.configure(b,{accepted:accept,blocked:!accept});
  const reopened=open(),next='2'.repeat(64);
  assert.equal(await reopened.receive(b,next,out.encodeRootChat(a,next,'later')),accept);
  const contact=(await reopened.snapshot()).contacts[0];
  assert.equal(contact.accepted,accept);assert.equal(contact.blocked,!accept);
 }
});
test('outbox preserves stable IDs and local nicknames without publishing them',async()=>{const f=fixture();await f.ledger.configure(b,{alias:'My friend'});await f.ledger.enqueue(b,id,'hello');await f.ledger.enqueue(b,id,'hello');let s=await f.ledger.snapshot();assert.equal(s.messages.length,1);assert.equal(s.messages[0].status,'pending');assert.equal(s.contacts[0].accepted,true);assert.ok(!out.encodeRootChat(b,id,'hello').includes('My friend'));await f.ledger.delivered(b,id);assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');});
test('locked identity, persistence failure and corrupt storage cannot acknowledge or replace history',async()=>{const f=fixture();f.fail();await assert.rejects(f.ledger.receive(b,id,out.encodeRootChat(a,id,'hello')));f.lock();await assert.rejects(f.ledger.snapshot());const broken=fixture();broken.corrupt();await assert.rejects(broken.ledger.enqueue(b,id,'hello'));});
test('serialized incoming writes preserve simultaneous messages and enforce byte limits',async()=>{const f=fixture();await Promise.all([f.ledger.receive(b,id,out.encodeRootChat(a,id,'one')),f.ledger.receive(b,'2'.repeat(64),out.encodeRootChat(a,'2'.repeat(64),'two'))]);assert.equal((await f.ledger.snapshot()).messages.length,2);await assert.rejects(f.ledger.enqueue(b,'3'.repeat(64),'🙂'.repeat(401)));});
test('relationship migration applies saved blocks once and preserves later local choices',async()=>{
 const f=fixture();await f.ledger.importRelationships('legacy:1',[{account:b,alias:'Friend',blocked:true,accepted:true}]);
 assert.equal((await f.ledger.snapshot()).contacts[0].blocked,true);
 assert.equal(await f.ledger.receive(b,id,out.encodeRootChat(a,id,'blocked')),false);
 await f.ledger.configure(b,{blocked:false,alias:'New name'});
 await f.ledger.importRelationships('legacy:1',[{account:b,alias:'Friend',blocked:true,accepted:true}]);
 const s=await f.ledger.snapshot();assert.equal(s.contacts[0].blocked,false);assert.equal(s.contacts[0].alias,'New name');
});
test('failed relationship commit does not mark migration complete or partially apply contacts',async()=>{
 const f=fixture();f.fail();await assert.rejects(f.ledger.importRelationships('legacy:1',[{account:b,alias:'',blocked:true,accepted:false}]));
 const s=await f.ledger.snapshot();assert.deepEqual(s.contacts,[]);assert.equal(s.imports,undefined);
});
test('replies round-trip with original author and no copied quote or nickname',async()=>{
 const left=fixture(a),right=fixture(b),next='2'.repeat(64);
 await left.ledger.enqueue(b,id,'original');
 await right.ledger.receive(a,id,out.encodeRootChat(b,id,'original'));
 await right.ledger.configure(a,{alias:'Private nickname'});
 await right.ledger.enqueue(a,next,'answer',{id,author:a});
 const message=(await right.ledger.snapshot()).messages[1],wire=out.encodeRootMessage(message);
 assert.ok(!wire.includes('original'));assert.ok(!wire.includes('Private nickname'));
 assert.equal(await left.ledger.receive(b,next,wire),true);
 assert.deepEqual((await left.ledger.snapshot()).messages[1].reply,{id,author:a});
 await right.ledger.delivered(a,next);assert.equal((await right.ledger.snapshot()).messages[1].status,'delivered');
});
test('outgoing replies require the original in the same conversation with the right author',async()=>{
 const f=fixture(),next='2'.repeat(64),c='axonic:1:'+'c'.repeat(64);
 await f.ledger.enqueue(b,id,'original');
 await assert.rejects(f.ledger.enqueue(b,next,'reply',{id,author:b}),/Original/);
 await assert.rejects(f.ledger.enqueue(c,next,'reply',{id,author:a}),/Original/);
 await assert.rejects(f.ledger.enqueue(b,next,'reply',{id,author:c}),/Invalid reply/);
 await assert.rejects(f.ledger.enqueue(b,next,'reply',{id:'3'.repeat(64),author:a}),/Original/);
 assert.equal((await f.ledger.snapshot()).messages.length,1);
});
test('out-of-order replies are retained and duplicate IDs cannot change their quote',async()=>{
 const f=fixture(),next='2'.repeat(64),reference={id,author:b},wire=out.encodeRootChat(a,next,'answer',reference);
 assert.equal(await f.ledger.receive(b,next,wire),true);
 assert.equal(await f.ledger.receive(b,next,wire),true);
 assert.equal(await f.ledger.receive(b,next,out.encodeRootChat(a,next,'answer',{id,author:a})),false);
 assert.equal(await f.ledger.receive(b,next,out.encodeRootChat(a,next,'answer')),false);
 assert.equal(await f.ledger.receive(b,id,out.encodeRootChat(a,id,'original')),true);
 assert.equal((await f.ledger.snapshot()).messages.length,2);
});
test('reply decoding rejects supplied excerpts, extra fields, and foreign authors',async()=>{
 const f=fixture(),next='2'.repeat(64),c='axonic:1:'+'c'.repeat(64);
 for(const body of [{text:'reply',reply:{id,author:b},quote:'forged'}, {text:'reply',reply:{id,author:b,quote:'forged'}},{text:'reply',reply:{id,author:c}},{text:'reply',reply:null}]){
  assert.equal(await f.ledger.receive(b,next,JSON.stringify(['axonic-root-reply-v1',a,next,body])),false);
 }
 assert.equal((await f.ledger.snapshot()).messages.length,0);
});
test('reply persistence failure and lock do not create partial messages',async()=>{
 const f=fixture(),next='2'.repeat(64);await f.ledger.enqueue(b,id,'original');f.fail();
 await assert.rejects(f.ledger.enqueue(b,next,'answer',{id,author:a}),/disk/);
 assert.equal((await f.ledger.snapshot()).messages.length,1);f.lock();
 await assert.rejects(f.ledger.enqueue(b,next,'answer',{id,author:a}),/Unlock/);
});
test('outgoing text respects encoded transport size including escaped characters',async()=>{
 const f=fixture();await assert.rejects(f.ledger.enqueue(b,id,'\\'.repeat(1600)),/too large/);
 await f.ledger.enqueue(b,id,'x'.repeat(1600));
 await assert.rejects(f.ledger.enqueue(b,'2'.repeat(64),'\\'.repeat(900),{id,author:a}),/too large/);
});

test('private mute preference persists without blocking delivery or entering the wire message',async()=>{
 const f=fixture();await f.ledger.configure(b,{muted:true});assert.equal((await f.ledger.snapshot()).contacts[0].muted,true);
 assert.equal(await f.ledger.receive(b,id,out.encodeRootChat(a,id,'hello')),true);
 assert.ok(!out.encodeRootChat(b,id,'hello').includes('muted'));
 await f.ledger.configure(b,{muted:false});assert.equal((await f.ledger.snapshot()).contacts[0].muted,false);
 await assert.rejects(f.ledger.configure(b,{muted:'yes'}),/Invalid notification/);
});

test('network storage persists without claiming delivery or leaving the retry queue',async()=>{
 const f=fixture();await f.ledger.enqueue(b,id,'hello');await f.ledger.networkStored(b,id,200000);
 let s=await f.ledger.snapshot();assert.equal(s.messages[0].status,'pending');assert.equal(s.messages[0].networkStoredUntil,200000);assert.equal(out.pendingRootChat(s,a).length,1);
 await f.ledger.networkStored(b,id,90000);assert.equal((await f.ledger.snapshot()).messages[0].networkStoredUntil,200000);
 await f.ledger.delivered(b,id);await f.ledger.networkStored(b,id,300000);assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');
});

test('status icons distinguish custody, complete media, read and expired custody',()=>{
 const status={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageStatus.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(status);
 const m={status:'pending',networkStoredUntil:200};assert.equal(status.rootMessageStatus(m,100),'stored');assert.equal(status.rootMessageStatus(m,200),'pending');
 assert.equal(status.rootMessageStatus({...m,attachment:{}},100),'pending');assert.equal(status.rootMessageStatus({...m,attachment:{},attachmentStoredUntil:200},100),'stored');
 assert.equal(status.rootMessageStatus({...m,attachment:{},read:true},100),'pending');assert.equal(status.rootMessageStatus({...m,status:'delivered'},100),'delivered');assert.equal(status.rootMessageStatus({...m,status:'delivered',read:true},100),'read');
 assert.deepEqual(['pending','stored','delivered','read'].map(status.deliveryStatusIcon),['time-outline','checkmark','checkmark-done','checkmark-done']);
});

test('message feedback only follows durable new admission, never history, receipts or replay',async()=>{
 let raw=null,fail=false;const events=[];const ledger=out.createRootChatLedger({owner:a,current:()=>true,now:()=>1,read:async()=>raw,write:async value=>{if(fail)throw Error('disk unavailable');raw=value;},messageCommitted:m=>events.push([m.direction,m.id])});
 await ledger.enqueue(b,id,'hello');await ledger.snapshot();await ledger.delivered(b,id);await ledger.enqueue(b,id,'hello');assert.deepEqual(events,[['outgoing',id]]);
 const incoming='f'.repeat(64),wire=out.encodeRootChat(a,incoming,'new');assert(await ledger.receive(b,incoming,wire));assert(await ledger.receive(b,incoming,wire));assert.equal(events.length,2);
 fail=true;await assert.rejects(ledger.enqueue(b,'e'.repeat(64),'failed'));assert.equal(events.length,2);
});

test('capability observation reads once, commits atomically and preserves unrelated history',async()=>{
 let raw=JSON.stringify({version:1,messages:[],contacts:[]}),reads=0,writes=0,fail=false,current=true;
 const ledger=out.createRootChatLedger({owner:a,now:()=>1,current:()=>current,read:async()=>{reads++;return raw;},write:async value=>{writes++;if(fail)throw Error('disk');raw=value;}});
 const input={profilePeers:[b,b,a,'invalid'],profileOfferPeers:[b],timestampPeers:[b],groupCustodyPeers:[b]};
 await ledger.rememberPeerCapabilities(input);assert.equal(reads,1);assert.equal(writes,1);
 for(const key of Object.keys(input))assert.deepEqual(JSON.parse(raw)[key],[b]);
 await ledger.rememberPeerCapabilities(input);assert.equal(reads,2);assert.equal(writes,1);
 await ledger.rememberPeerCapabilities({});assert.equal(reads,2);
 const before=raw,c='axonic:1:'+'c'.repeat(64);fail=true;
 await assert.rejects(ledger.rememberPeerCapabilities({timestampPeers:[c],groupCustodyPeers:[c]}),/disk/);assert.equal(raw,before);
 fail=false;await ledger.rememberPeerCapabilities({timestampPeers:[c],groupCustodyPeers:[c]});assert.deepEqual(JSON.parse(raw).timestampPeers,[b,c]);
 current=false;await assert.rejects(ledger.rememberPeerCapabilities(input),/Unlock/);
});

test('incoming admission uses one history read per serialized operation and keeps duplicate/conflict checks',async()=>{
 let raw=null,reads=0,writes=0;
 const ledger=out.createRootChatLedger({owner:a,current:()=>true,now:()=>1,read:async()=>{reads++;return raw;},write:async v=>{writes++;raw=v;}});
 assert.equal(await ledger.receive(b,id,out.encodeRootChat(a,id,'hello')),true);assert.equal(reads,1);assert.equal(writes,1);
 assert.equal(await ledger.receive(b,id,out.encodeRootChat(a,id,'hello')),true);assert.equal(reads,2);assert.equal(writes,1);
 assert.equal(await ledger.receive(b,id,out.encodeRootChat(a,id,'conflict')),false);assert.equal(reads,3);assert.equal(writes,1);
 assert.equal(JSON.parse(raw).messages[0].text,'hello');
});
