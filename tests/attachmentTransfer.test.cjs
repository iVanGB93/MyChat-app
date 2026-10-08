const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),crypto=require('crypto'),{DatabaseSync}=require('node:sqlite');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),{createAttachmentTransfer}=load('attachmentTransfer');
test('per-job membership policy rejects direct media and stops in-flight upload after removal',async t=>{
 const f=context(t);let allowed=true,reads=0;const deps=f.deps(0),sender=createAttachmentTransfer({...deps,allowedJob:()=>allowed,readChunk:async(...args)=>{reads++;allowed=false;return deps.readChunk(...args);}});
 await sender.enqueue(f.descriptor,'outgoing');allowed=false;await sender.tick();assert.equal(f.chunks.size,0);
 const peer={account:f.ids[1].record.account,device:f.ids[1].device.id,instance:'1'.repeat(64),expiresAt:now+60000},raw=JSON.stringify({version:1,operation:'direct-get',digest:a.attachmentDigest(f.manifest),index:0});
 assert.equal(JSON.parse(await sender.receive(raw,peer)).status,'unavailable');assert.equal(reads,0);
 allowed=true;await sender.tick();await sender.tick();assert.equal(f.chunks.size,0);assert.equal((await f.job(0)).cursor,0);sender.stop();
});
function jobs(t,capture){const database=new DatabaseSync(':memory:');if(capture)capture.database=database;t.after(()=>database.close());const tx={runAsync:async(s,...p)=>database.prepare(s).run(...p),getAllAsync:async(s,...p)=>database.prepare(s).all(...p),getFirstAsync:async(s,...p)=>database.prepare(s).get(...p)??null};
 const db={...tx,execAsync:async s=>database.exec(s),withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(tx);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentJobs.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>db}:load(n.slice(2)),out);return out.createMobileAttachmentJobs(capture?.now);}
function context(t){const f=fixture(),store=jobs(t),rows=[],chunks=new Map(),complete=[],written=[],descriptor={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'photo.png',mime:'image/png'};let clock=now,active=true;
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

