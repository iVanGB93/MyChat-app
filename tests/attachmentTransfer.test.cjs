const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),crypto=require('crypto'),{DatabaseSync}=require('node:sqlite');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),{createAttachmentTransfer}=load('attachmentTransfer');
function directContext(t,overrides={}){
 const f=context(t),sender=createAttachmentTransfer(f.deps(0)),base=f.deps(1);
 const peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};
 const receiver=createAttachmentTransfer({...base,peers:()=>[f.ids[0].record.account],
  request:(_p,raw)=>sender.receive(raw,peer),...overrides(f,base)});
 return {...f,sender,receiver,begin:async()=>{await sender.enqueue(f.descriptor,'outgoing');await receiver.enqueue(f.descriptor,'incoming');}};
}
test('direct stream uses normal file verification and signed delivery receipt',async t=>{
 const events=[];const f=directContext(t,(f,base)=>({directStream:async(job,live)=>{
  assert(await live());assert.equal(job.descriptor.checksum,f.descriptor.checksum);
  f.written.push(f.plain.slice());events.push('stream');return true;
 },commitFile:async(...args)=>{await base.commitFile(...args);events.push('verify');},
 signReceipt:async m=>{events.push('receipt');return base.signReceipt(m);}}));
 await f.begin();await f.receiver.tick();await f.receiver.tick();
 assert.deepEqual(events,['stream','verify','receipt']);assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
});
for(const failure of ['unavailable','disconnect'])test(`direct stream ${failure} falls back to encrypted chunks`,async t=>{
 let attempts=0;const f=directContext(t,()=>({directStream:async()=>{attempts++;if(failure==='disconnect')throw Error('lost channel');return false;}}));
 await f.begin();for(let n=0;n<8;n++)await f.receiver.tick();
 assert.equal(attempts,1);assert.equal((await f.job(1)).phase,'complete');assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});
test('not-yet-ready stream retries promptly while encrypted fallback still makes progress',async t=>{
 let attempts=0;
 const f=directContext(t,(f)=>({directStream:async()=>{
  if(++attempts===1)return 'unavailable';
  f.written.splice(0,f.written.length,f.plain.slice());return true;
 }}));
 await f.begin();await f.receiver.tick();assert.equal(attempts,1);assert.equal((await f.job(1)).cursor,1);
 f.advance(1001);await f.receiver.tick();await f.receiver.tick();
 assert.equal(attempts,2);assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
});

test('not-yet-ready stream has a bounded retry interval',async t=>{
 let attempts=0;const f=directContext(t,()=>({directStream:async()=>{attempts++;return 'unavailable';}}));
 await f.begin();await f.receiver.tick();await f.receiver.tick();assert.equal(attempts,1);
 assert.equal((await f.job(1)).cursor,2);
});

for(const response of [null,JSON.stringify({status:'unavailable'})])test(`temporary source response ${response} recovers after bounded retry without a ten-second exclusion`,async t=>{
 let requests=0;const f=directContext(t,()=>({request:async(p,raw)=>{
  if(++requests===1)return response;
  return f.sender.receive(raw,{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000});
 }}));
 await f.begin();await f.receiver.tick();assert.equal((await f.job(1)).failures,1);
 f.advance(999);await f.receiver.tick();assert.equal(requests,1);
 f.advance(1);for(let n=0;n<5;n++)await f.receiver.tick();
 assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
 assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});

test('persistent source unavailability backs off instead of flooding a connected peer',async t=>{
 let requests=0;const f=directContext(t,()=>({request:async()=>{requests++;return JSON.stringify({status:'unavailable'});}}));
 await f.begin();await f.receiver.tick();
 for(const delay of [1000,2000,4000,8000,16000,30000,30000]){
  const prior=requests;f.advance(delay-1);await f.receiver.tick();assert.equal(requests,prior);
  f.advance(1);await f.receiver.tick();assert.equal(requests,prior+1);
 }
 assert.equal((await f.job(1)).receipt,null);
});

test('malformed source responses retain the longer peer exclusion',async t=>{
 let requests=0;const f=directContext(t,()=>({request:async()=>{requests++;return JSON.stringify({status:'ok',chunk:{index:999}});}}));
 await f.begin();await f.receiver.tick();f.advance(1000);await f.receiver.tick();assert.equal(requests,1);
 f.advance(8999);await f.receiver.tick();assert.equal(requests,1);
 f.advance(1);await f.receiver.tick();assert.equal(requests,2);assert.equal((await f.job(1)).receipt,null);
});

test('corrupt streamed file never produces a receipt',async t=>{
 let signed=0;const f=directContext(t,(f,base)=>({directStream:async()=>{f.written.push(new Uint8Array(f.plain.length));return true;},
 signReceipt:async m=>{signed++;return base.signReceipt(m);}}));
 await f.begin();await f.receiver.tick();assert.equal(signed,0);assert.equal((await f.job(1)).receipt,null);assert.notEqual((await f.job(1)).phase,'complete');
});
test('cancelling a direct transfer invalidates its lease and prevents publication',async t=>{
 let release,entered=false,lease;const gate=new Promise(r=>release=r);
 const f=directContext(t,()=>({directStream:async(_job,live)=>{lease=live;entered=true;await gate;return true;}}));
 await f.begin();const pending=f.receiver.tick();while(!entered)await new Promise(setImmediate);
 await f.receiver.cancel(a.attachmentDigest(f.manifest));assert.equal(await lease(),false);release();await pending;
 assert.equal((await f.job(1)).phase,'cancelled');assert.equal((await f.job(1)).receipt,null);assert.equal(f.complete.length,0);
});
test('custodian downloads never invoke plaintext direct stream',async t=>{
 const f=context(t);let attempts=0;const sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 for(let n=0;n<5;n++)await sender.tick();
 const receiver=createAttachmentTransfer({...f.deps(1),directStream:async()=>{attempts++;return true;}});
 await receiver.enqueue(f.descriptor,'incoming');for(let n=0;n<8;n++)await receiver.tick();
 assert.equal(attempts,0);assert.equal((await f.job(1)).phase,'complete');
});
test('direct stream serving requires the exact recipient device and revokes on cancellation',async t=>{
 const f=context(t);let calls=0,lease;
 const sender=createAttachmentTransfer({...f.deps(0),serveStream:async(_job,live)=>{calls++;lease=live;return true;}});
 const job=await sender.enqueue(f.descriptor,'outgoing'),raw=JSON.stringify({version:1,operation:'direct-stream',digest:job.digest});
 const peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};
 assert.equal(JSON.parse(await sender.receive(raw,{...peer,device:f.ids[2].device.id})).status,'rejected');assert.equal(calls,0);
 assert.equal(JSON.parse(await sender.receive(raw,peer)).status,'streaming');assert.equal(calls,1);assert(await lease());
 await sender.cancel(job.digest);assert.equal(await lease(),false);
 assert.equal(JSON.parse(await sender.receive(raw,peer)).status,'unavailable');assert.equal(calls,1);
});
test('older attachment adapters reject stream requests without changing the job',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0)),job=await sender.enqueue(f.descriptor,'outgoing');
 const result=await sender.receive(JSON.stringify({version:1,operation:'direct-stream',digest:job.digest}),{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000});
 assert.equal(JSON.parse(result).status,'unavailable');assert.equal((await f.job(0)).revision,0);
});
test('a newly connected sender can stream a partially downloaded attachment',async t=>{
 let receivedCursor=-1;const f=directContext(t,(f)=>({directStream:async(job)=>{receivedCursor=job.cursor;f.written.splice(0,f.written.length,f.plain.slice());return true;}}));
 await f.begin();const j=await f.job(1);f.written.push(f.plain.slice(0,4096));
 await f.store.save({...j,revision:j.revision+1,cursor:1,phase:'downloading'},j.revision,()=>true);
 await f.receiver.tick();await f.receiver.tick();assert.equal(receivedCursor,1);assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
});
test('reused journal writer hides uncommitted checkpoints, rolls back on lock, and preserves compare-and-set',async t=>{
 const path=require('node:path'),os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'axonic-journal-'));
 const connections=[];let gate=null,entered=false;
 t.after(()=>{for(const c of connections)c.close();for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);});
 const openDatabaseAsync=async()=>{
  const c=new DatabaseSync(path.join(dir,'jobs.db'));connections.push(c);
  return {execAsync:async sql=>c.exec(sql),
   getFirstAsync:async(sql,...args)=>c.prepare(sql).get(...args)??null,
   getFirstSync:(sql,...args)=>c.prepare(sql).get(...args)??null,
   getAllAsync:async(sql,...args)=>c.prepare(sql).all(...args),
   runAsync:async(sql,...args)=>{const result=c.prepare(sql).run(...args);if(gate&&sql.startsWith('INSERT INTO jobs')){entered=true;await gate;}return result;},
   withTransactionAsync:async work=>{c.exec('BEGIN');try{await work();c.exec('COMMIT');}catch(e){c.exec('ROLLBACK');throw e;}}
  };
 };
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentJobs.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync}:load(n.slice(2)),out);
 const f=context(t),store=out.createMobileAttachmentJobs(),worker=createAttachmentTransfer({...f.deps(0),store});
 const original=await worker.enqueue(f.descriptor,'outgoing'),changed={...original,revision:1,cursor:1,phase:'uploading'};
 let release,active=true;gate=new Promise(r=>release=r);
 const pending=store.save(changed,0,()=>active);
 while(!entered)await new Promise(setImmediate);
 assert.equal((await store.get(original.owner,original.digest)).revision,0);
 assert.equal(await store.isCurrent(original.owner,original.digest,0),true,'reader cannot see the uncommitted revision');
 assert.equal(await store.isCurrent(original.owner,original.digest,1),false);
 active=false;release();await assert.rejects(pending,/locked/);gate=null;
 assert.equal((await store.get(original.owner,original.digest)).cursor,0);
 const other=out.createMobileAttachmentJobs();
 assert.deepEqual(await Promise.all([store.save(changed,0,()=>true),other.save({...changed,cursor:2},0,()=>true)]),[true,false]);
 assert.equal((await other.get(original.owner,original.digest)).cursor,1);
 assert.equal(await store.isCurrent(original.owner,original.digest,0),false,'another store invalidates the old revision');
 assert.equal(await store.isCurrent(original.owner,original.digest,1),true);
 assert.equal(connections.length,2,'one reader and one writer are reused across store factories');
});

test('indexed liveness rejects absent, cancelled and archived jobs and invalid arguments',async t=>{
 const f=context(t),worker=createAttachmentTransfer(f.deps(0)),j=await worker.enqueue(f.descriptor,'outgoing');
 assert.equal(await f.store.isCurrent(j.owner,j.digest,0),true);
 assert.equal(await f.store.isCurrent(j.owner,'0'.repeat(64),0),false);
 assert.equal(await f.store.isCurrent(j.owner,j.digest,-1),false);
 assert.equal(await f.store.isCurrent('invalid',j.digest,0),false);
 await worker.cancel(j.digest);const paused=await f.job(0);
 assert.equal(await f.store.isCurrent(j.owner,j.digest,paused.revision),false);
 assert.equal(await f.store.save({...paused,phase:'expired',revision:paused.revision+1},paused.revision,()=>true),true);
 assert.equal(await f.store.isCurrent(j.owner,j.digest,paused.revision+1),false);
});

test('external journal revision changes revoke a downloaded window before writing bytes',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 for(let i=0;i<5;i++)await sender.tick();
 const base=f.deps(1);let release,entered=false;const gate=new Promise(r=>release=r);
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,request:async(...args)=>{const r=await base.request(...args);entered=true;await gate;return r;}});
 const j=await receiver.enqueue(f.descriptor,'incoming'),pending=receiver.tick();
 while(!entered)await new Promise(setImmediate);
 const saved=await f.job(1);
 assert.equal(await f.store.save({...saved,phase:'cancelled',revision:saved.revision+1},saved.revision,()=>true),true);
 release();await pending;assert.equal(f.written.length,0);assert.equal((await f.job(1)).phase,'cancelled');
});

test('journal liveness fallback still delivers for adapters without indexed checks',async t=>{
 const f=context(t),store={...f.store,isCurrent:undefined},sender=createAttachmentTransfer({...f.deps(0),store});
 await sender.enqueue(f.descriptor,'outgoing');for(let i=0;i<5;i++)await sender.tick();
 const receiver=createAttachmentTransfer({...f.deps(1),store,downloadWindow:4});await receiver.enqueue(f.descriptor,'incoming');
 for(let i=0;i<8;i++)await receiver.tick();assert.equal((await f.job(1)).phase,'complete');assert.equal(f.written.length,3);
});

for(const window of [2,4])test(`negotiated three-chunk window ${window} preserves final bytes and receipt`,async t=>{
 const f=context(t,4096*13+19),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 const source=f.ids[0].record.account,peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};const counts=[];
 const receiver=createAttachmentTransfer({...f.deps(1),peers:()=>[source],bulkPeers:()=>[source],batchChunks:()=>3,batchWindow:()=>window,
 request:(_p,raw)=>sender.receive(raw,peer),bulkRequest:(_p,raw)=>{counts.push(JSON.parse(raw).count);return sender.receive(raw,peer);}});
 await receiver.enqueue(f.descriptor,'incoming');for(let n=0;n<8&&(await f.job(1)).phase!=='complete';n++)await receiver.tick();
 assert.deepEqual(counts,[3,3,3,3,2]);assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
 assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});

for(const window of [2,4])test(`small batch window ${window} drains requests and checkpoints only the verified prefix on failure`,async t=>{
 const f=context(t,4096*13+19),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 const source=f.ids[0].record.account,peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};let active=0,peak=0;
 const receiver=createAttachmentTransfer({...f.deps(1),peers:()=>[source],bulkPeers:()=>[source],batchChunks:()=>3,batchWindow:()=>window,
 request:(_p,raw)=>sender.receive(raw,peer),bulkRequest:async(_p,raw)=>{
  active++;peak=Math.max(peak,active);const index=JSON.parse(raw).index;
  try{await new Promise(r=>setTimeout(r,index===0?10:1));if(index===3)throw Error('lost batch');return await sender.receive(raw,peer);}finally{active--;}
 }});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();
 assert.equal(peak,window);assert.equal(active,0);assert.equal((await f.job(1)).cursor,3);
 assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain.slice(0,3*4096)));
});

test('temporary batch unavailability preserves the verified prefix and resumes after one second',async t=>{
 const f=context(t,4096*13+19),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 const source=f.ids[0].record.account,peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};let failed=false;
 const receiver=createAttachmentTransfer({...f.deps(1),peers:()=>[source],bulkPeers:()=>[source],batchChunks:()=>3,batchWindow:()=>2,
 request:(_p,raw)=>sender.receive(raw,peer),bulkRequest:async(_p,raw)=>{
  if(JSON.parse(raw).index===3&&!failed){failed=true;return JSON.stringify({status:'unavailable'});}
  return sender.receive(raw,peer);
 }});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();assert.equal((await f.job(1)).cursor,3);
 f.advance(1000);for(let n=0;n<4;n++)await receiver.tick();
 assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
 assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});

test('RTC pipeline replenishes a verified batch before a slower adjacent batch completes',async t=>{
 const f=context(t,4096*13+19),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 const source=f.ids[0].record.account,peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};
 let release,active=0,peak=0;const gate=new Promise(r=>release=r),started=[];
 const receiver=createAttachmentTransfer({...f.deps(1),peers:()=>[source],bulkPeers:()=>[source],batchChunks:()=>3,batchWindow:()=>2,
 request:(_p,raw)=>sender.receive(raw,peer),bulkRequest:async(_p,raw)=>{
  const index=JSON.parse(raw).index;started.push(index);active++;peak=Math.max(peak,active);
  try{if(index===3)await gate;return await sender.receive(raw,peer);}finally{active--;}
 }});
 await receiver.enqueue(f.descriptor,'incoming');const work=receiver.tick();
 try{for(let n=0;n<100&&!started.includes(6);n++)await new Promise(setImmediate);
  assert(started.includes(6),'third request starts while second is held');assert.equal(peak,2);
 }finally{release();await work;}
 assert.equal(active,0);assert.equal((await f.job(1)).cursor,14);
 assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});

test('direct 512 KiB batches deliver a larger file with two batch reads and a verified receipt',async t=>{
 const f=context(t,787252),baseSender=f.deps(0);let reads=0;
 const sender=createAttachmentTransfer({...baseSender,readChunk:()=>{throw Error('Single read used');},readChunks:async(job,index,count)=>{reads++;return Promise.all(Array.from({length:count},(_,n)=>baseSender.readChunk(job,index+n)));}});await sender.enqueue(f.descriptor,'outgoing');
 const source=f.ids[0].record.account,peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};let batches=0;
 const base=f.deps(1),receiver=createAttachmentTransfer({...base,peers:()=>[source],bulkPeers:()=>[source],
  request:(_p,raw)=>sender.receive(raw,peer),bulkRequest:(_p,raw)=>{batches++;return sender.receive(raw,peer);}});
 await receiver.enqueue(f.descriptor,'incoming');for(let n=0;n<8&&(await f.job(1)).phase!=='complete';n++)await receiver.tick();
 assert.equal(batches,2);assert.equal(reads,2);assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);
 assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});

for(const mode of ['short','tampered','locked'])test('batch read fails closed: '+mode,async t=>{
 const f=context(t,16384),base=f.deps(0);
 const sender=createAttachmentTransfer({...base,readChunks:async(job,index,count)=>{
  const chunks=await Promise.all(Array.from({length:count},(_,n)=>base.readChunk(job,index+n)));
  if(mode==='short')chunks.pop();if(mode==='tampered')chunks[0]={...chunks[0],ciphertext:'00'.repeat(chunks[0].ciphertext.length/2)};if(mode==='locked')f.lock();return chunks;
 }});const job=await sender.enqueue(f.descriptor,'outgoing');
 const response=JSON.parse(await sender.receive(JSON.stringify({version:1,operation:'direct-get-batch',digest:job.digest,index:0,count:3}),{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000}));
 assert.notEqual(response.status,'ok');assert.equal(response.data,undefined);
});

test('tampered bulk tail preserves only verified prefix and resumes after worker recreation',async t=>{
 const f=context(t,512*1024+19),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 const source=f.ids[0].record.account,peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};let tamper=true;
 const deps={...f.deps(1),peers:()=>[source],bulkPeers:()=>[source],request:(_p,raw)=>sender.receive(raw,peer),bulkRequest:async(_p,raw)=>{
  const response=JSON.parse(await sender.receive(raw,peer));if(tamper){tamper=false;const bytes=Buffer.from(response.data,'base64');bytes[bytes.length-1]^=1;response.data=bytes.toString('base64');}return JSON.stringify(response);
 }};
 let receiver=createAttachmentTransfer(deps);await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();
 assert.equal((await f.job(1)).cursor,127);assert.equal((await f.job(1)).receipt,null);assert.equal(f.written.length,127);
 receiver.stop();receiver=createAttachmentTransfer(deps);f.advance(11000);
 for(let n=0;n<8&&(await f.job(1)).phase!=='complete';n++)await receiver.tick();
 assert.equal((await f.job(1)).phase,'complete');assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
});

test('bulk serving stops when the owner locks and cannot leak a partial batch',async t=>{
 const f=context(t,512*1024),base=f.deps(0);let reads=0;
 const sender=createAttachmentTransfer({...base,readChunk:async(...args)=>{if(++reads===17)f.lock();return base.readChunk(...args);}});
 const job=await sender.enqueue(f.descriptor,'outgoing');
 const response=await sender.receive(JSON.stringify({version:1,operation:'direct-get-batch',digest:job.digest,index:0,count:128}),{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000});
 assert.equal(JSON.parse(response).status,'unavailable');assert.equal(reads,17);assert(!response.includes('data'));
});

test('optional indexed journal benchmark uses identical committed rows', {skip:process.env.AXON_JOURNAL_BENCHMARK!=='1'},async t=>{
 const f=context(t),worker=createAttachmentTransfer(f.deps(0)),j=await worker.enqueue(f.descriptor,'outgoing');
 const samples={full:[],indexed:[]},iterations=2000;
 for(let round=0;round<6;round++)for(const name of round%2?['indexed','full']:['full','indexed']){
  const start=performance.now();for(let n=0;n<iterations;n++){
   const ok=name==='indexed'?await f.store.isCurrent(j.owner,j.digest,j.revision):await f.store.get(j.owner,j.digest).then(r=>r?.revision===j.revision&&!['complete','expired','cancelled'].includes(r.phase));assert.equal(ok,true);
  }samples[name].push(performance.now()-start);
 }
 t.diagnostic(JSON.stringify({scope:'PC SQLite journal checks only, not phone transfer latency',iterations,samples}));
});

test('bounded bursts transfer multiple chunks without timer sleeps and preserve verified delivery',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 for(let n=0;n<5&&(await f.job(0)).cursor<3;n++)assert.equal(await sender.tick({maxSteps:32,maxMilliseconds:100}),true);
 assert.equal((await f.job(0)).cursor,3);assert.equal(f.complete.length,0);
 sender.stop();const resumed=createAttachmentTransfer(f.deps(0));
 const receiver=createAttachmentTransfer(f.deps(1));await receiver.enqueue(f.descriptor,'incoming');
 for(let n=0;n<8&&(await f.job(1)).phase!=='complete';n++)await receiver.tick({maxSteps:32,maxMilliseconds:100});
 assert.equal((await f.job(1)).phase,'complete');assert.equal(f.written.length,3);assert.equal(f.chunks.size,0);
 f.advance(3000);await resumed.tick({maxSteps:32,maxMilliseconds:100});assert.equal((await f.job(0)).phase,'complete');
 assert.equal(await receiver.tick({maxSteps:32}),false);
});
test('burst respects its step budget and stops on cancellation while a chunk is in flight',async t=>{
 const f=context(t),base=f.deps(0);let release,waiting=false;
 const gate=new Promise(r=>release=r),worker=createAttachmentTransfer({...base,readChunk:async(j,i)=>{waiting=true;await gate;return base.readChunk(j,i);}});
 await worker.enqueue(f.descriptor,'outgoing');await worker.tick({maxSteps:1});assert.equal(f.chunks.size,0);
 const pending=worker.tick({maxSteps:32,maxMilliseconds:100});while(!waiting)await new Promise(setImmediate);
 assert.equal(await worker.tick({maxSteps:32}),false);await worker.cancel(a.attachmentDigest(f.manifest));release();
 assert.equal(await pending,false);assert.equal(f.chunks.size,0);assert.equal((await f.job(0)).phase,'cancelled');
 for(const maxSteps of [0,33,NaN])await assert.rejects(worker.tick({maxSteps}),/budget/);
});
test('burst does not spin on unavailable records or retry a failed route without backoff',async t=>{
 const f=context(t),base=f.deps(0);let reads=0,requests=0;
 await createAttachmentTransfer(base).enqueue(f.descriptor,'outgoing');
 const unavailable=createAttachmentTransfer({...base,record:async()=>{reads++;return null;}});
 assert.equal(await unavailable.tick({maxSteps:32}),false);assert.equal(reads,1);
 const failed=createAttachmentTransfer({...base,request:async()=>{requests++;return null;}});
 assert.equal(await failed.tick({maxSteps:32}),false);assert.equal(requests,1);
 assert.equal(await failed.tick({maxSteps:32}),false);assert.equal(requests,1);
});
test('slow requests exhaust the burst time budget without starting another request',async t=>{
 const f=context(t),base=f.deps(0);let requests=0;
 const worker=createAttachmentTransfer({...base,request:async(p,raw)=>{requests++;await new Promise(r=>setTimeout(r,10));return base.request(p,raw);}});
 await worker.enqueue(f.descriptor,'outgoing');
 await worker.tick({maxSteps:32,maxMilliseconds:1});assert.equal(requests,1);assert.equal((await f.job(0)).cursor,0);
 await worker.tick({maxSteps:32,maxMilliseconds:1});assert.equal(requests,2);assert.equal((await f.job(0)).cursor,1);
});
test('per-job membership policy rejects direct media and stops in-flight upload after removal',async t=>{
 const f=context(t);let allowed=true,reads=0;const deps=f.deps(0),sender=createAttachmentTransfer({...deps,allowedJob:()=>allowed,readChunk:async(...args)=>{reads++;allowed=false;return deps.readChunk(...args);}});
 await sender.enqueue(f.descriptor,'outgoing');allowed=false;await sender.tick();assert.equal(f.chunks.size,0);
 const peer={account:f.ids[1].record.account,device:f.ids[1].device.id,instance:'1'.repeat(64),expiresAt:now+60000},raw=JSON.stringify({version:1,operation:'direct-get',digest:a.attachmentDigest(f.manifest),index:0});
 assert.equal(JSON.parse(await sender.receive(raw,peer)).status,'unavailable');assert.equal(reads,0);
 allowed=true;await sender.tick();await sender.tick();assert.equal(f.chunks.size,0);assert.equal((await f.job(0)).cursor,0);sender.stop();
});
function jobs(t,capture){const database=new DatabaseSync(':memory:');if(capture)capture.database=database;t.after(()=>database.close());const tx={runAsync:async(s,...p)=>database.prepare(s).run(...p),getAllAsync:async(s,...p)=>database.prepare(s).all(...p),getFirstAsync:async(s,...p)=>database.prepare(s).get(...p)??null};
 const db={...tx,getFirstSync:(s,...p)=>database.prepare(s).get(...p)??null,execAsync:async s=>database.exec(s),withTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(tx);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentJobs.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>db}:load(n.slice(2)),out);return out.createMobileAttachmentJobs(capture?.now);}
function context(t,size){const f=fixture(size),store=jobs(t),rows=[],chunks=new Map(),complete=[],written=[],descriptor={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'photo.png',mime:'image/png'};let clock=now,active=true;
 const custodyStore={transaction:async work=>{const saved=structuredClone(rows),savedChunks=new Map([...chunks].map(([k,v])=>[k,structuredClone(v)]));const result=await work({rows:async()=>saved,save:async row=>{const i=saved.findIndex(r=>r.digest===row.digest);if(i<0)saved.push(structuredClone(row));else saved[i]=structuredClone(row);},chunk:async(d,i)=>savedChunks.get(d+':'+i)??null,saveChunk:async(d,c)=>savedChunks.set(d+':'+c.index,structuredClone(c)),eraseChunks:async d=>{for(const k of savedChunks.keys())if(k.startsWith(d+':'))savedChunks.delete(k);},erase:async d=>{const i=saved.findIndex(r=>r.digest===d);if(i>=0)saved.splice(i,1);for(const k of savedChunks.keys())if(k.startsWith(d+':'))savedChunks.delete(k);}});rows.splice(0,rows.length,...saved);chunks.clear();for(const [k,v] of savedChunks)chunks.set(k,v);return result;}};
 const records={read:async account=>f.ids.find(i=>i.record.account===account)?.record??null};const relay=load('attachmentCustody').createAttachmentCustody({owner:f.ids[2].record.account,store:custodyStore,records,now:()=>clock,current:()=>true});
 const deps=i=>({owner:()=>active?f.ids[i].record.account:null,device:()=>f.ids[i].device.id,now:()=>clock,store,record:records.read,peers:()=>[f.ids[2].record.account],allowed:()=>true,
 request:async(_peer,raw)=>relay.receive(raw,{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:clock+60000}),
 readChunk:async(_job,index)=>f.chunks[index],writeChunk:async(_job,index,plain,current)=>{if(!current())throw Error('locked');written[index]=plain.slice();},
 commitFile:async(_job,current)=>{assert(current());const plain=Buffer.concat(written.map(p=>Buffer.from(p)));assert.equal(plain.length,f.plain.length);assert.equal(crypto.createHash('sha256').update(plain).digest('hex'),descriptor.checksum);},
 signReceipt:async m=>a.signAttachmentReceipt(m,f.ids[i].signingSeed,f.ids[i].record,clock),completed:async(job,current)=>{assert(current());complete.push(job.direction);}});
 return {...f,store,descriptor,rows,chunks,complete,written,deps,advance:ms=>clock+=ms,lock:()=>active=false,unlock:()=>active=true,job:i=>store.get(f.ids[i].record.account,a.attachmentDigest(f.manifest))};
}
test('durable attachment jobs survive worker recreation and only complete after file verification and a signed receipt',async t=>{
 const f=context(t);let sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');await sender.tick();await sender.tick();sender.stop();sender=createAttachmentTransfer(f.deps(0));
 for(let i=0;i<5;i++)await sender.tick();assert.equal((await f.job(0)).phase,'confirming');assert.equal(f.complete.length,0);
 const receiver=createAttachmentTransfer(f.deps(1));await receiver.enqueue(f.descriptor,'incoming');for(let i=0;i<8;i++)await receiver.tick();
 assert.equal((await f.job(1)).phase,'complete');assert.equal(f.chunks.size,0);f.advance(3000);await sender.tick();assert.equal((await f.job(0)).phase,'complete');assert(f.complete.includes('incoming'));assert(f.complete.includes('outgoing'));
});
test('last download window publishes only after file verification and durable receipt in the same turn',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');
 for(let i=0;i<5;i++)await sender.tick();
 const base=f.deps(1),events=[];
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,
  commitFile:async(...args)=>{await base.commitFile(...args);events.push('verified');},
  completed:async(job,current)=>{assert.deepEqual(events,['verified']);assert.deepEqual((await f.job(1)).receipt,job.receipt);assert(job.receipt);events.push('published');await base.completed(job,current);}});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();
 assert.deepEqual(events,['verified','published']);assert.equal((await f.job(1)).phase,'confirming');
 assert.equal(f.chunks.size,3,'custody is retained until the remote receipt is acknowledged');
 await receiver.tick();assert.equal((await f.job(1)).phase,'complete');assert.equal(f.chunks.size,0);assert.equal(f.complete.length,1);
});

test('locking during final verification prevents receipt signing and immediate publication',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let i=0;i<5;i++)await sender.tick();
 const base=f.deps(1);let signed=0;
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,
  commitFile:async(...args)=>{await base.commitFile(...args);f.lock();},
  signReceipt:async m=>{signed++;return base.signReceipt(m);}});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();f.unlock();
 assert.equal(signed,0);assert.equal((await f.job(1)).receipt,null);assert.equal(f.complete.length,0);assert.equal(f.chunks.size,3);
});

test('failed immediate publication resumes from its durable receipt after worker recreation',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let i=0;i<5;i++)await sender.tick();
 const base=f.deps(1);let signed=0;
 const deps={...base,downloadWindow:4,signReceipt:async m=>{signed++;return base.signReceipt(m);}};
 let receiver=createAttachmentTransfer({...deps,completed:async()=>{throw Error('chat storage temporarily unavailable');}});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();assert((await f.job(1)).receipt);assert.equal(f.complete.length,0);
 receiver.stop();f.advance(11000);receiver=createAttachmentTransfer(deps);await receiver.tick();
 assert.equal(signed,1);assert.equal(f.complete.length,1);assert.equal((await f.job(1)).phase,'complete');assert.equal(f.chunks.size,0);
});

test('lost chunk reply retries the same ciphertext without inflating remote progress',async t=>{
 const f=context(t),deps=f.deps(0);let lost=true;const sender=createAttachmentTransfer({...deps,request:async(p,raw)=>{const result=await deps.request(p,raw);if(JSON.parse(raw).operation==='put'&&lost){lost=false;return null;}return result;}});
 await sender.enqueue(f.descriptor,'outgoing');await sender.tick();await sender.tick();assert.equal(f.rows[0].received,1);f.advance(11000);
 for(let i=0;i<6;i++)await sender.tick();assert.equal(f.rows[0].received,f.chunks.size);assert.equal(f.rows[0].received,3);assert.equal(f.complete.length,0);
});
test('failed final file verification never signs a receipt or deletes custodian bytes',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let i=0;i<5;i++)await sender.tick();let signed=0;
 const deps=f.deps(1),receiver=createAttachmentTransfer({...deps,commitFile:async()=>{throw Error('corrupt disk');},signReceipt:async m=>{signed++;return deps.signReceipt(m);}});
 await receiver.enqueue(f.descriptor,'incoming');for(let i=0;i<5;i++)await receiver.tick();assert.equal(signed,0);assert.equal(f.chunks.size,3);assert.equal(f.complete.length,0);
});
test('lock and cancellation revoke in-flight work without advancing progress',async t=>{
 for(const cancel of [false,true]){const f=context(t),deps=f.deps(0);let release;const gate=new Promise(r=>release=r);let waiting=false;
 const worker=createAttachmentTransfer({...deps,readChunk:async(j,i)=>{waiting=true;await gate;return deps.readChunk(j,i);}});await worker.enqueue(f.descriptor,'outgoing');await worker.tick();const pending=worker.tick();while(!waiting)await new Promise(setImmediate);
 if(cancel)await worker.cancel(a.attachmentDigest(f.manifest));else f.lock();release();await pending;f.unlock();assert.equal((await f.job(0)).cursor,0);assert.equal(f.chunks.size,0);if(cancel)assert.equal((await f.job(0)).phase,'cancelled');}
});
test('expired jobs stop sending, and counterfeit completed status cannot deliver an attachment',async t=>{
 const f=context(t),deps=f.deps(0);let requests=0;const worker=createAttachmentTransfer({...deps,request:async(p,raw)=>{requests++;if(JSON.parse(raw).operation==='status')return JSON.stringify({status:'completed',receipt:{signature:'00'.repeat(64)}});return deps.request(p,raw);}});
 await worker.enqueue(f.descriptor,'outgoing');for(let i=0;i<6;i++)await worker.tick();assert.equal(f.complete.length,0);f.advance(a.ATTACHMENT_TTL+40000);const before=requests;await worker.tick();assert.equal((await f.job(0)).phase,'expired');assert.equal(requests,before);
});
test('job journal rejects stale concurrent updates, changed descriptors and cross-owner reads',async t=>{
 const f=context(t),worker=createAttachmentTransfer(f.deps(0)),job=await worker.enqueue(f.descriptor,'outgoing');
 const results=await Promise.all([f.store.save({...job,revision:1,next:1},0,()=>true),f.store.save({...job,revision:1,next:2},0,()=>true)]);assert.equal(results.filter(Boolean).length,1);
 const saved=await f.job(0);assert.equal(await f.store.save({...saved,revision:2,descriptor:{...saved.descriptor,name:'changed.png'}},1,()=>true),false);
 assert.equal(await f.store.get(f.ids[1].record.account,job.digest),null);assert.equal(await f.store.save({...saved,revision:2},1,()=>false),false);
});

test('two endpoints deliver directly with no third-party custody and retain signed delivery semantics',async t=>{
 const f=context(t),workers=[],operations=[];
 for(const i of [0,1])workers.push(createAttachmentTransfer({...f.deps(i),peers:()=>[f.ids[1-i].record.account],request:async(peer,raw)=>{
  assert.equal(peer,f.ids[1-i].record.account);operations.push(JSON.parse(raw).operation);
  return workers[1-i].receive(raw,{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:now+60000});
 }}));
 await workers[0].enqueue(f.descriptor,'outgoing');await workers[1].enqueue(f.descriptor,'incoming');
 for(let n=0;n<12;n++){await workers[0].tick();await workers[1].tick();f.advance(2100);}
 assert.equal((await f.job(0)).phase,'complete');assert.equal((await f.job(1)).phase,'complete');
 assert.equal(f.rows.length,0);assert.equal(f.chunks.size,0);assert(operations.includes('direct-get'));assert(operations.includes('direct-receipt'));
 assert(operations.every(o=>o.startsWith('direct-')));assert(f.complete.includes('outgoing'));
});

test('direct receipt retries a concurrent outgoing checkpoint without losing progress',async t=>{
 const f=context(t),base=f.deps(0);let raced=false;
 const store={...base.store,save:async(j,expected,current)=>{
  if(j.receipt&&!raced){raced=true;const latest=await base.store.get(j.owner,j.digest);
   assert(await base.store.save({...latest,revision:latest.revision+1,cursor:1,phase:'uploading'},latest.revision,current));
  }return base.store.save(j,expected,current);
 }};
 const sender=createAttachmentTransfer({...base,store});await sender.enqueue(f.descriptor,'outgoing');
 const receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now);
 const peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};
 const reply=JSON.parse(await sender.receive(JSON.stringify({version:1,operation:'direct-receipt',digest:a.attachmentDigest(f.manifest),receipt}),peer));
 assert.equal(reply.status,'completed');assert.equal((await f.job(0)).cursor,1);assert.deepEqual((await f.job(0)).receipt,receipt);
 await sender.tick();assert.equal((await f.job(0)).phase,'complete');assert.deepEqual(f.complete,['outgoing']);
});

test('direct receipt race never overwrites concurrent cancellation',async t=>{
 const f=context(t),base=f.deps(0);let raced=false;
 const store={...base.store,save:async(j,expected,current)=>{
  if(j.receipt&&!raced){raced=true;const latest=await base.store.get(j.owner,j.digest);
   assert(await base.store.save({...latest,revision:latest.revision+1,phase:'cancelled'},latest.revision,current));
  }return base.store.save(j,expected,current);
 }};
 const sender=createAttachmentTransfer({...base,store});await sender.enqueue(f.descriptor,'outgoing');
 const receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now);
 const reply=JSON.parse(await sender.receive(JSON.stringify({version:1,operation:'direct-receipt',digest:a.attachmentDigest(f.manifest),receipt}),{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000}));
 assert.equal(reply.status,'unavailable');assert.equal((await f.job(0)).phase,'cancelled');assert.equal((await f.job(0)).receipt,null);
});

test('direct receipt retries are bounded and stop when the account locks',async t=>{
 for(const lock of [false,true]){
  const f=context(t),base=f.deps(0);let attempts=0;
  const store={...base.store,save:async(j,expected,current)=>{
   if(j.receipt){attempts++;if(lock)f.lock();return false;}return base.store.save(j,expected,current);
  }};
  const sender=createAttachmentTransfer({...base,store});await sender.enqueue(f.descriptor,'outgoing');
  const receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now);
  const reply=JSON.parse(await sender.receive(JSON.stringify({version:1,operation:'direct-receipt',digest:a.attachmentDigest(f.manifest),receipt}),{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000}));
  assert.equal(reply.status,'unavailable');assert.equal(attempts,lock?1:3);assert.equal((await f.job(0)).receipt,null);
 }
});

test('direct own-file endpoint rejects other accounts, wrong devices, counterfeit receipts and locked reads',async t=>{
 const f=context(t),worker=createAttachmentTransfer(f.deps(0));await worker.enqueue(f.descriptor,'outgoing');
 const peer={account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000};
 const raw=operation=>JSON.stringify({version:1,operation,digest:a.attachmentDigest(f.manifest),index:0,receipt:{signature:'00'.repeat(64)}});
 for(const invalid of [{...peer,account:f.ids[2].record.account},{...peer,device:f.ids[2].device.id},{...peer,expiresAt:now-1}])assert.notEqual(JSON.parse(await worker.receive(raw('direct-get'),invalid)).status,'ok');
 assert.equal(JSON.parse(await worker.receive(raw('direct-receipt'),peer)).status,'rejected');assert.equal((await f.job(0)).receipt,null);
 assert.equal(JSON.parse(await worker.receive(raw('direct-get'),peer)).status,'ok');f.lock();assert.equal(JSON.parse(await worker.receive(raw('direct-get'),peer)).status,'rejected');
 assert.equal(await worker.receive(JSON.stringify({operation:'get'}),peer),null);
});

test('unavailable direct endpoint falls back to a custodian',async t=>{
 const f=context(t),base=f.deps(1),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<5;n++)await sender.tick();
 const receiver=createAttachmentTransfer({...base,peers:()=>[f.ids[2].record.account,f.ids[0].record.account],request:async(peer,raw)=>peer===f.ids[0].record.account?JSON.stringify({status:'rejected'}):base.request(peer,raw)});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();f.advance(2000);
 for(let n=0;n<10;n++)await receiver.tick();assert.equal((await f.job(1)).phase,'complete');assert.equal(f.chunks.size,0);
});

test('switching from a partial custody upload to direct download also clears the partial custodian',async t=>{
 const f=context(t),workers=[],base=f.deps(1);let connected=false;
 const sender=createAttachmentTransfer({...f.deps(0),peers:()=>connected?[f.ids[1].record.account,f.ids[2].record.account]:[f.ids[2].record.account],request:async(peer,raw)=>peer===f.ids[1].record.account?workers[1].receive(raw,{account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000}):f.deps(0).request(peer,raw)});workers[0]=sender;
 await sender.enqueue(f.descriptor,'outgoing');await sender.tick();await sender.tick();assert.equal(f.chunks.size,1);
 const receiver=createAttachmentTransfer({...base,peers:()=>[f.ids[0].record.account,f.ids[2].record.account],request:async(peer,raw)=>peer===f.ids[0].record.account?sender.receive(raw,{account:f.ids[1].record.account,device:f.ids[1].device.id,expiresAt:now+60000}):base.request(peer,raw)});workers[1]=receiver;connected=true;
 await receiver.enqueue(f.descriptor,'incoming');for(let n=0;n<12;n++){await sender.tick();await receiver.tick();f.advance(2100);}
 assert.equal((await f.job(1)).phase,'complete');assert.equal((await f.job(0)).phase,'complete');assert.equal(f.chunks.size,0);
 assert.deepEqual(new Set((await f.job(1)).acknowledged),new Set([f.ids[0].record.account,f.ids[2].record.account]));
});

test('paused download retains its checkpoint across worker recreation and resumes without duplicate writes',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<5;n++)await sender.tick();
 let receiver=createAttachmentTransfer(f.deps(1));await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();assert.equal((await f.job(1)).cursor,1);
 await receiver.cancel(a.attachmentDigest(f.manifest));receiver.stop();receiver=createAttachmentTransfer(f.deps(1));
 for(let n=0;n<3;n++)await receiver.tick();assert.equal((await f.job(1)).cursor,1);assert.equal(f.written.length,1);
 await receiver.retry(a.attachmentDigest(f.manifest));for(let n=0;n<8;n++)await receiver.tick();assert.equal((await f.job(1)).phase,'complete');assert.equal(f.written.length,3);
 await assert.rejects(receiver.retry(a.attachmentDigest(f.manifest)),/complete/);
});

test('retry rejects expired, locked or blocked transfers and pause cannot interrupt signed-receipt cleanup',async t=>{
 const f=context(t),deps=f.deps(0);let allowed=true;const worker=createAttachmentTransfer({...deps,allowed:()=>allowed});const j=await worker.enqueue(f.descriptor,'outgoing');
 await worker.cancel(j.digest);allowed=false;await assert.rejects(worker.retry(j.digest),/unblock/);allowed=true;f.lock();await assert.rejects(worker.retry(j.digest),/Unlock/);f.unlock();
 f.advance(a.ATTACHMENT_TTL+1);await assert.rejects(worker.retry(j.digest),/expired/);
 const g=context(t),w=createAttachmentTransfer(g.deps(0)),job=await w.enqueue(g.descriptor,'outgoing'),receipt=a.signAttachmentReceipt(g.manifest,g.ids[1].signingSeed,g.ids[1].record,now);
 await g.store.save({...job,receipt,revision:1},0,()=>true);await assert.rejects(w.cancel(job.digest),/received/);assert.equal((await g.job(0)).phase,'queued');
});

test('finished jobs leave the active queue but retain receipt lookups beyond 128 lifetime transfers',async t=>{
 const f=context(t),worker=createAttachmentTransfer(f.deps(0)),base=await worker.enqueue(f.descriptor,'outgoing');let archived;
 for(let i=0;i<130;i++){
  const manifest=a.signAttachmentManifest({...f.manifest,id:(i+1).toString(16).padStart(64,'0')},f.ids[0].signingSeed,f.ids[0].record,now),digest=a.attachmentDigest(manifest);
  archived={...base,descriptor:{...f.descriptor,manifest},digest,phase:'complete',receipt:a.signAttachmentReceipt(manifest,f.ids[1].signingSeed,f.ids[1].record,now)};
  assert(await f.store.save(archived,null,()=>true));
 }
 assert.equal((await f.store.list(base.owner)).length,1);assert.deepEqual(await f.store.get(base.owner,archived.digest),archived);
 assert.equal(await f.store.save({...archived,phase:'queued',revision:1},0,()=>true),false);assert.equal(await f.store.get(f.ids[1].record.account,archived.digest),null);
});

test('legacy completed-job retirement rolls back on lock and preserves active work and receipts',async t=>{
 const f=fixture(),capture={},store=jobs(t,capture);await store.list(f.manifest.sender);
 const manifest=f.manifest,job={version:1,owner:manifest.sender,digest:a.attachmentDigest(manifest),descriptor:{manifest,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'fixture.bin',mime:'application/octet-stream'},direction:'outgoing',revision:7,phase:'complete',cursor:3,relay:null,next:0,failures:0,receipt:a.signAttachmentReceipt(manifest,f.ids[1].signingSeed,f.ids[1].record,now),custodians:[],acknowledged:[]};
 capture.database.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(job.owner,job.digest,job.revision,JSON.stringify(job));let calls=0;
 await assert.rejects(store.retire(job.owner,()=>++calls===1),/locked/);assert.equal((await store.list(job.owner)).length,1);
 await store.retire(job.owner,()=>true);assert.deepEqual(await store.list(job.owner),[]);assert.deepEqual(await store.get(job.owner,job.digest),job);
 assert.equal(await store.save({...job,revision:8},6,()=>true),false);
});

test('paused jobs retire after expiration so abandoned transfers cannot permanently fill the queue',async t=>{
 const f=context(t);let clock=now;const store=jobs(t,{now:()=>clock}),worker=createAttachmentTransfer({...f.deps(0),store});
 const job=await worker.enqueue(f.descriptor,'outgoing');await worker.cancel(job.digest);await store.retire(job.owner,()=>true);
 const paused=await store.get(job.owner,job.digest);assert.equal((await store.list(job.owner)).length,1);
 clock+=a.ATTACHMENT_TTL+1;await store.retire(job.owner,()=>true);assert.deepEqual(await store.list(job.owner),[]);assert.equal((await store.get(job.owner,job.digest)).phase,'expired');
 assert.equal(await store.save({...paused,phase:'queued',revision:paused.revision+1},paused.revision,()=>true),false);
});


test('network-stored callback waits for every encrypted chunk and never implies recipient delivery',async t=>{
 const f=context(t);let held=0;const worker=createAttachmentTransfer({...f.deps(0),stored:async(job,current)=>{assert(current());held++;assert.equal(f.chunks.size,Math.ceil(f.manifest.bytes/a.ATTACHMENT_CHUNK_BYTES));}});
 await worker.enqueue(f.descriptor,'outgoing');await worker.tick();assert.equal(held,0);
 const count=Math.ceil(f.manifest.bytes/a.ATTACHMENT_CHUNK_BYTES);
 for(let n=0;n<count;n++){await worker.tick();if(n<count-1)assert.equal(held,0);}
 assert.equal(held,1);assert.equal(f.complete.length,0);assert.equal((await f.job(0)).phase,'confirming');
});

test('download read-ahead overlaps requests but persists only an ordered verified prefix',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<4;n++)await sender.tick();
 const base=f.deps(1);let outstanding=0,maximum=0;const release=[];
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,request:async(p,raw)=>{if(JSON.parse(raw).operation!=='get')return base.request(p,raw);outstanding++;maximum=Math.max(maximum,outstanding);await new Promise(r=>release.push(r));try{return await base.request(p,raw);}finally{outstanding--;}}});
 await receiver.enqueue(f.descriptor,'incoming');const work=receiver.tick();while(release.length<3)await new Promise(setImmediate);
 release[2]();release[1]();release[0]();await work;
 assert.equal(maximum,3);assert.equal(outstanding,0);assert.equal((await f.job(1)).cursor,3);assert.equal(f.written.length,3);
 await receiver.tick();await receiver.tick();assert.equal((await f.job(1)).phase,'complete');
});
test('failed prefetched chunk keeps durable prefix and retries without skipping or duplicating bytes',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<4;n++)await sender.tick();
 const base=f.deps(1);let corrupt=true;const indices=[];
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,request:async(p,raw)=>{const request=JSON.parse(raw);if(request.operation==='get'){indices.push(request.index);if(corrupt&&request.index===1)return JSON.stringify({status:'ok',chunk:{index:1,ciphertext:'00',proof:[]}});}return base.request(p,raw);}});
 const job=await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();assert.equal((await f.job(1)).cursor,1);assert.equal(f.written.length,1);assert.equal((await f.job(1)).receipt,null);
 corrupt=false;await receiver.retry(job.digest);await receiver.tick();assert.equal((await f.job(1)).cursor,3);assert.deepEqual(indices,[0,1,2,1,2]);
});
test('cancelling a prefetched window drains requests and never publishes their bytes',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<4;n++)await sender.tick();
 const base=f.deps(1);let release,requests=0;const gate=new Promise(r=>release=r);
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,request:async(p,raw)=>{requests++;await gate;return base.request(p,raw);}});
 const job=await receiver.enqueue(f.descriptor,'incoming'),work=receiver.tick();while(requests<3)await new Promise(setImmediate);await receiver.cancel(job.digest);release();await work;
 assert.equal(f.written.length,0);assert.equal((await f.job(1)).phase,'cancelled');assert.equal((await f.job(1)).receipt,null);
 for(const downloadWindow of [0,5,NaN])assert.throws(()=>createAttachmentTransfer({...base,downloadWindow}),/window/);
});

test('verified download window uses one checkpoint and replays safely after checkpoint failure',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<4;n++)await sender.tick();
 const base=f.deps(1);let fail=true;const checkpoints=[];
 const store={...base.store,save:async(j,expected,current)=>{if(j.cursor>0&&j.direction==='incoming'&&!j.receipt){checkpoints.push(j.cursor);if(fail)throw Error('disk unavailable');}return base.store.save(j,expected,current);}};
 const receiver=createAttachmentTransfer({...base,store,downloadWindow:4});const job=await receiver.enqueue(f.descriptor,'incoming');
 await receiver.tick();assert.equal((await f.job(1)).cursor,0);assert.equal(f.written.length,3);assert.deepEqual(checkpoints,[3]);
 receiver.stop();fail=false;const resumed=createAttachmentTransfer({...base,store,downloadWindow:4});await resumed.retry(job.digest);await resumed.tick();
 assert.equal((await f.job(1)).cursor,3);assert.deepEqual(checkpoints,[3,3]);
 await resumed.tick();await resumed.tick();assert.equal((await f.job(1)).phase,'complete');
 assert.equal(crypto.createHash('sha256').update(Buffer.concat(f.written)).digest('hex'),f.descriptor.checksum);
});

test('cancelling during a window write cannot checkpoint or publish the partial file',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<4;n++)await sender.tick();
 const base=f.deps(1);let receiver;
 receiver=createAttachmentTransfer({...base,downloadWindow:4,writeChunk:async(...args)=>{await base.writeChunk(...args);if(args[1]===1)await receiver.cancel(args[0].digest);}});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();const job=await f.job(1);
 assert.equal(job.phase,'cancelled');assert.equal(job.cursor,0);assert.equal(job.receipt,null);
});

test('attachment timings aggregate fixed stages and preserve failures without retaining content',async()=>{
 const {createAttachmentTiming}=load('attachmentTiming');let clock=0;const timing=createAttachmentTiming(true,()=>clock);
 assert.equal(await timing.measure('network',async()=>{clock+=20;return 'private payload';}),'private payload');
 await assert.rejects(timing.measure('network',async()=>{clock+=5;throw Error('private failure');}));
 assert.deepEqual(timing.snapshot(),{network:{calls:2,milliseconds:25,maximum:20,errors:1}});
 const snapshot=timing.snapshot();snapshot.network.calls=100;assert.equal(timing.snapshot().network.calls,2);
 const disabled=createAttachmentTiming(false,()=>{throw Error('clock should not run');});await disabled.measure('chat',async()=>{});assert.deepEqual(disabled.snapshot(),{});
});

test('offline custody cleanup does not republish a delivered attachment every tick',async t=>{
 const f=context(t),sender=createAttachmentTransfer(f.deps(0));await sender.enqueue(f.descriptor,'outgoing');for(let n=0;n<4;n++)await sender.tick();
 const base=f.deps(1);let online=true,publications=0;
 const receiver=createAttachmentTransfer({...base,downloadWindow:4,peers:()=>online?base.peers():[],completed:async(...args)=>{publications++;return base.completed(...args);}});
 await receiver.enqueue(f.descriptor,'incoming');await receiver.tick();online=false;
 for(let n=0;n<20;n++)await receiver.tick();
 assert.equal((await f.job(1)).phase,'confirming');assert.equal(publications,1);
 receiver.invalidate();await receiver.tick();assert.equal(publications,2,'new account generation rechecks durable chat publication');
 online=true;await receiver.tick();assert.equal((await f.job(1)).phase,'complete');assert.equal(publications,2);
});

test('indexed attachment policy matches first-reference group rules and is isolated to its snapshot owner',t=>{
 const {indexAttachmentPolicy}=load('attachmentPolicy'),f=context(t),owner=f.manifest.recipient,peer=f.manifest.sender,digest=a.attachmentDigest(f.manifest);
 const message={id:f.manifest.id,peer,direction:'incoming',status:'pending',attachment:f.descriptor};
 const state={version:1,contacts:[],messages:[message],groups:[]};
 let allows=indexAttachmentPolicy(state,owner);assert.equal(allows({owner,digest}),true);assert.equal(allows({owner:peer,digest}),false);
 const groupContext={id:'a'.repeat(64),revision:0,messageId:'b'.repeat(64)};
 const denied={...message,group:groupContext};state.messages=[denied,message];
 allows=indexAttachmentPolicy(state,owner);assert.equal(allows({owner,digest}),false,'first reference controls admission');
 state.groups=[{id:groupContext.id,revision:0,members:[owner,peer],accepted:true,blocked:false}];
 assert.equal(indexAttachmentPolicy(state,owner)({owner,digest}),true);
 state.groups[0].accepted=false;assert.equal(indexAttachmentPolicy(state,owner)({owner,digest}),false);
 state.groups[0].accepted=true;state.contacts=[{account:peer,blocked:true}];assert.equal(indexAttachmentPolicy(state,owner)({owner,digest}),false);
 assert.equal(allows({owner,digest}),false,'an existing index retains its captured policy');
});

test('upload window drains all replies, preserves exact encrypted chunks and batches its checkpoint',async t=>{
 const f=context(t),deps=f.deps(0);let tail=Promise.resolve(),active=0,peak=0,saves=0;
 const sender=createAttachmentTransfer({...deps,uploadWindow:4,store:{...deps.store,save:async(...args)=>{saves++;return deps.store.save(...args);}},request:async(peer,raw)=>{
  if(JSON.parse(raw).operation!=='put')return deps.request(peer,raw);
  active++;peak=Math.max(peak,active);const result=tail.then(()=>deps.request(peer,raw));tail=result.catch(()=>{});
  try{const reply=await result;await new Promise(r=>setTimeout(r,5));return reply;}finally{active--;}
 }});
 await sender.enqueue(f.descriptor,'outgoing');await sender.tick();const before=saves;await sender.tick();
 assert.equal(peak,3);assert.equal(active,0);assert.equal(saves-before,1);assert.equal((await f.job(0)).cursor,3);assert.equal(f.rows[0].received,3);
 const receiver=createAttachmentTransfer({...f.deps(1),downloadWindow:1});await receiver.enqueue(f.descriptor,'incoming');for(let i=0;i<8;i++)await receiver.tick();
 assert.equal((await f.job(1)).phase,'complete');assert.equal(f.chunks.size,0);
});
test('upload window failure waits for all work and resumes without inventing a received prefix',async t=>{
 const f=context(t),deps=f.deps(0);let active=0,fail=true,tail=Promise.resolve();
 const sender=createAttachmentTransfer({...deps,uploadWindow:4,request:async(peer,raw)=>{
  const request=JSON.parse(raw);if(request.operation!=='put')return deps.request(peer,raw);
  active++;try{if(request.chunk.index===1&&fail){await new Promise(r=>setTimeout(r,5));return null;}
   const result=tail.then(()=>deps.request(peer,raw));tail=result.catch(()=>{});return await result;
  }finally{active--;}
 }});
 await sender.enqueue(f.descriptor,'outgoing');await sender.tick();await sender.tick();assert.equal(active,0);assert.equal((await f.job(0)).cursor,0);
 fail=false;f.advance(11000);for(let i=0;i<4;i++)await sender.tick();assert.equal(f.rows[0].received,3);assert.equal((await f.job(0)).cursor,3);
});

test('encrypted file resumes byte-for-byte through real negotiated media sessions after reconnect',async t=>{
 const f=context(t,256*1024),{createPersistentAxon}=load('persistentAxon');let sessions=[],workers=[],clock=now,dead=false;
 const records=new Map(f.ids.map(v=>[v.record.account,v.record]));const recordStore={read:async id=>records.get(id)??null,compareAndSet:async(id,expected,next)=>{records.set(id,next);return true;}};
 const deps=i=>({...f.deps(i),downloadWindow:4,uploadWindow:4,peers:()=>[f.ids[1-i].record.account],request:async(_,raw)=>sessions[i].attachmentRequest(raw)});
 workers=[createAttachmentTransfer(deps(0)),createAttachmentTransfer(deps(1))];t.after(()=>{workers.forEach(w=>w.stop());sessions.forEach(s=>s.stop());});
 const connect=async()=>{
  dead=false;const listeners=[],ends=[];sessions=f.ids.slice(0,2).map((id,i)=>createPersistentAxon({...id,instance:new Uint8Array(crypto.randomBytes(32)),store:recordStore,now:()=>clock,current:()=>true,random:async n=>new Uint8Array(crypto.randomBytes(n)),onClosed(){},
   onAttachment:async(raw,peer)=>(await workers[i].receive(raw,peer))??'{"status":"rejected"}',wire:{mediaLane:true,listen(fn,end){listeners[i]=fn;ends[i]=end;return()=>{listeners[i]=null;};},send(raw){setTimeout(()=>{if(!dead)listeners[1-i]?.(raw);},2);},close(){if(dead)return;dead=true;ends.forEach(end=>end?.());}}}));
  await Promise.all(sessions.map(s=>s.ready));
 };
 const timer=setInterval(()=>{clock+=5;},5);t.after(()=>clearInterval(timer));
 await workers[0].enqueue(f.descriptor,'outgoing');await workers[1].enqueue(f.descriptor,'incoming');await connect();
 for(let i=0;i<3;i++)await workers[1].tick();const before=(await f.job(1)).cursor;assert(before>0&&before<64);
 sessions.forEach(s=>s.stop());workers[1].stop();workers[1]=createAttachmentTransfer(deps(1));await connect();
 assert.equal((await f.job(1)).cursor,before);
 for(let i=0;i<24&&(await f.job(1)).phase!=='complete';i++)await workers[1].tick();
 assert.equal((await f.job(1)).phase,'complete');assert.deepEqual(Buffer.concat(f.written.map(v=>Buffer.from(v))),Buffer.from(f.plain));
 assert((await f.job(0)).receipt);assert(sessions.every(s=>s.snapshot().mediaLane&&s.snapshot().state==='connected'));
});

test('negotiated bulk sessions resume after a 512 KiB checkpoint and verify the final receipt',async t=>{
 const f=context(t,787252),{createPersistentAxon}=load('persistentAxon');let sessions=[],workers=[],dead=false;const epoch=Date.now();
 const records=new Map(f.ids.map(v=>[v.record.account,v.record])),recordStore={read:async id=>records.get(id)??null,compareAndSet:async(id,_expected,next)=>{records.set(id,next);return true;}};
 const deps=i=>({...f.deps(i),peers:()=>[f.ids[1-i].record.account],bulkPeers:()=>sessions[i]?.supportsAttachmentBulk()?[f.ids[1-i].record.account]:[],
  request:(_,raw)=>sessions[i].attachmentRequest(raw),bulkRequest:(_,raw)=>sessions[i].attachmentBulkRequest(raw)});
 workers=[createAttachmentTransfer(deps(0)),createAttachmentTransfer(deps(1))];t.after(()=>{workers.forEach(w=>w.stop());sessions.forEach(s=>s.stop());});
 async function connect(){dead=false;const listeners=[],ends=[];sessions=f.ids.slice(0,2).map((id,i)=>createPersistentAxon({...id,instance:new Uint8Array(crypto.randomBytes(32)),store:recordStore,now:()=>now+Date.now()-epoch,current:()=>true,random:async n=>new Uint8Array(crypto.randomBytes(n)),onClosed(){},
  onAttachment:async(raw,peer)=>(await workers[i].receive(raw,peer))??'{"status":"rejected"}',wire:{mediaLane:true,bulkAttachments:true,listen(fn,end){listeners[i]=fn;ends[i]=end;return()=>{listeners[i]=null;};},send(raw){setTimeout(()=>{if(!dead)listeners[1-i]?.(raw);},2);},close(){if(dead)return;dead=true;ends.forEach(end=>end?.());}}}));await Promise.all(sessions.map(s=>s.ready));}
 await workers[0].enqueue(f.descriptor,'outgoing');await workers[1].enqueue(f.descriptor,'incoming');await connect();await workers[1].tick();
 assert.equal((await f.job(1)).cursor,128);sessions.forEach(s=>s.stop());workers[1].stop();workers[1]=createAttachmentTransfer(deps(1));await connect();
 for(let i=0;i<8&&(await f.job(1)).phase!=='complete';i++)await workers[1].tick();
 assert.equal((await f.job(1)).phase,'complete');assert((await f.job(0)).receipt);assert.deepEqual(Buffer.concat(f.written.map(Buffer.from)),Buffer.from(f.plain));
 assert(sessions.every(s=>s.snapshot().state==='connected'&&s.snapshot().bulkAttachments));
});
