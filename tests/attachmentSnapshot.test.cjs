const test=require('node:test'),assert=require('node:assert/strict');
const {createAttachmentSnapshot}=require('./helpers/attachment.cjs').load('attachmentPolicy');

test('committed state handoff is revision bound and never survives writes or account changes',async()=>{
 let owner='a',revision=1,reads=0;
 const cache=createAttachmentSnapshot({owner:()=>owner,revision:()=>revision,read:async()=>{reads++;return {contacts:[{blocked:true}],messages:[]};}});
 const state={contacts:[],messages:[]};assert.equal(cache.committed('a',1,state),true);
 assert.equal((await cache.read()).state,state);assert.equal(reads,0);
 revision=2;assert.equal(cache.committed('a',1,state),false);assert.equal((await cache.read()).state.contacts[0].blocked,true);assert.equal(reads,1);
 owner='b';assert.equal(cache.committed('a',2,state),false);await cache.read();assert.equal(reads,2);
 cache.clear();await cache.read();assert.equal(reads,3);
});

test('queued permission read accepts the revision captured inside the ledger, including newly blocked contacts',async()=>{
 const {createRootChatLedger}=require('./helpers/attachment.cjs').load('rootChatLedger');
 const owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64);let revision=0,raw=null,reads=0;
 const ledger=createRootChatLedger({owner,now:()=>100000,current:()=>true,read:async()=>{reads++;return raw;},write:async v=>{raw=v;revision++;}});
 const cache=createAttachmentSnapshot({owner:()=>owner,revision:()=>revision,read:()=>ledger.snapshot(),readVersioned:()=>ledger.revisionSnapshot(()=>revision)});
 const writes=[ledger.configure(peer,{accepted:true}),ledger.configure(peer,{blocked:true})];
 const pending=cache.read();await Promise.all(writes);const result=await pending;
 assert.equal(result.revision,2);assert.equal(result.state.contacts[0].blocked,true);
 assert.equal(reads,3,'one permission read after the two queued writes, no discard/retry');
 assert.equal(await cache.read(),result);
});

test('versioned permission reads reject writes after capture, account changes and cleared epochs',async()=>{
 for(const change of ['revision','owner','clear']){
  let owner='a',revision=0,resolve;
  const cache=createAttachmentSnapshot({owner:()=>owner,revision:()=>revision,read:async()=>{throw Error('unstamped read');},readVersioned:()=>new Promise(r=>resolve=r)});
  const pending=cache.read();if(change==='revision')revision++;else if(change==='owner')owner='b';else cache.clear();
  resolve({state:{contacts:[],messages:[]},revision:0});assert.equal(await pending,null);
 }
});
test('idle media ticks reuse history and permission changes invalidate immediately',async()=>{
 let revision=0,reads=0,owner='a';const cache=createAttachmentSnapshot({owner:()=>owner,revision:()=>revision,read:async()=>({version:1,contacts:[],messages:[],test:++reads})});
 const first=await cache.read();for(let i=0;i<100;i++)assert.equal(await cache.read(),first);assert.equal(reads,1);
 revision++;assert.notEqual(await cache.read(),first);assert.equal(reads,2);
 owner='b';assert.equal((await cache.read()).owner,'b');assert.equal(reads,3);
 owner=null;assert.equal(await cache.read(),null);
});
test('racing writes and lock/unlock cannot install a stale attachment policy',async()=>{
 let revision=0,resolve;const cache=createAttachmentSnapshot({owner:()=> 'a',revision:()=>revision,read:()=>new Promise(r=>resolve=r)});
 const first=cache.read();revision++;resolve({contacts:[]});assert.equal(await first,null);
 const second=cache.read();cache.clear();resolve({contacts:[]});assert.equal(await second,null);
 const third=cache.read();resolve({contacts:[{blocked:true}]});assert.equal((await third).state.contacts[0].blocked,true);
});
test('failed storage reads remain retryable',async()=>{
 let fail=true;const cache=createAttachmentSnapshot({owner:()=> 'a',revision:()=>0,read:async()=>{if(fail)throw Error('disk');return {contacts:[]};}});
 await assert.rejects(cache.read(),/disk/);fail=false;assert.ok(await cache.read());
});

test('concurrent snapshot consumers share reads but never reuse an old revision or cleared epoch',async()=>{
 let revision=0,reads=0;const releases=[];
 const cache=createAttachmentSnapshot({owner:()=> 'a',revision:()=>revision,read:()=>{reads++;return new Promise(r=>releases.push(r));}});
 const first=cache.read(),second=cache.read();assert.equal(reads,1);
 revision++;const fresh=cache.read();assert.equal(reads,2);
 releases[0]({contacts:[],messages:[]});assert.equal(await first,null);assert.equal(await second,null);
 releases[1]({contacts:[],messages:[]});assert.equal((await fresh).revision,1);
 cache.clear();const third=cache.read();cache.clear();const fourth=cache.read();assert.equal(reads,4);
 releases[2]({contacts:[],messages:[]});assert.equal(await third,null);
 releases[3]({contacts:[],messages:[]});assert.equal((await fourth).revision,1);
});

test('admission retries a racing ledger write without admitting its stale snapshot',async()=>{
 const {readAttachmentAdmissionSnapshot:read}=require('./helpers/attachment.cjs').load('attachmentPolicy');
 let revision=0,calls=0;const cache=createAttachmentSnapshot({owner:()=> 'a',revision:()=>revision,read:async()=>{calls++;if(calls===1)revision++;return {contacts:[{blocked:calls===2}],messages:[]};}});
 const result=await read(cache.read,()=>true);assert.equal(calls,2);assert.equal(result.revision,1);assert.equal(result.state.contacts[0].blocked,true);
});
test('admission retry remains bounded and cannot survive an account change or storage failure',async()=>{
 const {readAttachmentAdmissionSnapshot:read}=require('./helpers/attachment.cjs').load('attachmentPolicy');let calls=0;
 assert.equal(await read(async()=>{calls++;return null;},()=>true),null);assert.equal(calls,2);
 let current=true;calls=0;assert.equal(await read(async()=>{calls++;current=false;return {stale:true};},()=>current),null);assert.equal(calls,1);
 await assert.rejects(read(async()=>{throw Error('disk');},()=>true),/disk/);
});
