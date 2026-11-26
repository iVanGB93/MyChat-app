const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),{createAttachmentCustody}=load('attachmentCustody');
test('ordinary sharing exceeds four files without losing custody; byte budget still rejects new content',async t=>{
 const f=fixture(17),s=storeFixture(t,f.ids[2].record.account);
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async()=>f.ids[0].record},now:()=>now,current:()=>true,maxBytes:17*20};
 let relay=createAttachmentCustody(deps);
 const peer={account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000};
 const manifests=Array.from({length:21},(_,i)=>a.signAttachmentManifest({...f.manifest,id:(i+1).toString(16).padStart(64,'0')},f.ids[0].signingSeed,f.ids[0].record,now));
 const offer=m=>relay.receive(JSON.stringify({version:1,operation:'offer',manifest:m}),peer).then(JSON.parse);
 for(const m of manifests.slice(0,20))assert.equal((await offer(m)).status,'held');
 const before=await s.store.transaction(tx=>tx.rows());assert.equal(before.length,20);
 assert.deepEqual(await offer(manifests[20]),{status:'full',reason:'byte_capacity'});
 relay=createAttachmentCustody(deps);
 assert.equal((await offer(manifests[0])).status,'held','existing grant remains usable at capacity after restart');
 assert.deepEqual(await s.store.transaction(tx=>tx.rows()),before,'refusal and retries preserve every reserved file');
});

test('sender metadata bound remains enforced without the old four-file bottleneck',async()=>{
 const f=fixture(1),limits=load('attachmentCustody').ATTACHMENT_CUSTODY_LIMITS,rows=[];
 for(let i=0;i<limits.senderContents;i++){
  const manifest={...f.manifest,id:(i+1).toString(16).padStart(64,'0')};
  rows.push({manifest,digest:a.attachmentDigest(manifest),received:0,receipt:null});
 }
 const store={transaction:async work=>work({rows:async()=>rows,save:async()=>{throw Error('must not save');},erase:async()=>{throw Error('must not erase');},eraseChunks:async()=>{throw Error('must not erase');}})};
 const relay=createAttachmentCustody({owner:f.ids[2].record.account,store,records:{read:async()=>f.ids[0].record},now:()=>now,current:()=>true});
 const r=JSON.parse(await relay.receive(JSON.stringify({version:1,operation:'offer',manifest:f.manifest}),{account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000}));
 assert.deepEqual(r,{status:'full',reason:'sender_capacity'});assert.equal(rows.length,limits.senderContents);
});
test('retired local custody records stay intact and do not block current offers',async()=>{
 const f=fixture(),old={digest:'a'.repeat(64),manifest:{version:3},received:0,receipt:null},rows=[old];
 const store={transaction:async work=>work({rows:async()=>rows,save:async row=>rows.push(row),erase:async()=>{throw Error('must preserve old data');},eraseChunks:async()=>{throw Error('must preserve old files');}})};
 const relay=createAttachmentCustody({owner:f.ids[2].record.account,store,records:{read:async()=>f.ids[0].record},now:()=>now,current:()=>true});
 const response=JSON.parse(await relay.receive(JSON.stringify({version:1,operation:'offer',manifest:f.manifest}),{account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000}));
 assert.equal(response.status,'held');assert.equal(rows[0],old);assert.equal(rows.length,2);
});
function storeFixture(t,owner){const database=new DatabaseSync(':memory:');t.after(()=>database.close());
 const queries=[];
 const tx={runAsync:async(s,...p)=>database.prepare(s).run(...p),getAllAsync:async(s,...p)=>{queries.push(s);return database.prepare(s).all(...p);},getFirstAsync:async(s,...p)=>{queries.push(s);return database.prepare(s).get(...p)??null;}};
 const db={...tx,execAsync:async s=>database.exec(s),withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(tx);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>db}:load(n.slice(2)),out);
 return {store:out.createMobileAttachmentStore(owner),other:out.createMobileAttachmentStore('axonic:1:'+'a'.repeat(64)),db:database,queries};
}

test('upload batches validate all proofs, commit atomically, and retry idempotently across restart',async t=>{
 const f=fixture(12_000_019),s=storeFixture(t,f.ids[2].record.account),digest=a.attachmentDigest(f.manifest),b=load('attachmentBatch');
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async id=>f.ids.find(i=>i.record.account===id)?.record},now:()=>now,current:()=>true};let relay=createAttachmentCustody(deps);
 const peer=i=>({account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:now+60000});
 const send=(body,i=0)=>relay.receive(JSON.stringify({version:1,digest,...body}),peer(i)).then(JSON.parse);
 await send({operation:'offer',manifest:f.manifest});
 const batch={operation:'put-batch',index:0,count:1,data:b.packAttachmentBatch(f.manifest,0,f.chunks.slice(0,1))};
 const corrupt=Buffer.from(batch.data,'base64');corrupt[corrupt.length-1]^=1;
 for(const body of [{...batch,data:corrupt.toString('base64')},{...batch,index:2},{...batch,count:129},{...batch,extra:'forbidden'},{...batch,data:batch.data+'='}])assert.equal((await send(body)).status,'rejected');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM asset_chunks').get().n,0);
 assert.equal((await send(batch,1)).status,'rejected');
 assert.equal((await send(batch)).received,1);assert.equal(relay.contribution().counts.blocksStored,1);assert.equal(relay.contribution().counts.ciphertextBytesStored,Buffer.from(f.chunks[0].ciphertext,'hex').length);
 s.queries.length=0;
 await send(batch);
 assert.equal((await send({operation:'status'})).received,1);
 assert.equal(s.queries.filter(sql=>sql.startsWith('SELECT raw FROM assets')).length,2);
 assert.equal(s.queries.some(sql=>sql.startsWith('SELECT raw FROM asset_chunks')),false);
 assert.equal(relay.contribution().counts.blocksStored,1);relay=createAttachmentCustody(deps);assert.equal((await send(batch)).received,1);assert.equal(relay.contribution().counts.blocksStored,0);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM asset_chunks').get().n,1);
 const tail={operation:'put-batch',index:1,count:1,data:b.packAttachmentBatch(f.manifest,1,[f.chunks[1]])};
 const response=await send(tail);assert.deepEqual(response,{status:'held',index:1,count:1,received:2});
 assert.deepEqual(b.unpackAttachmentBatch(f.manifest,1,1,(await send({operation:'get-batch',index:1,count:1},1)).data)[0],f.chunks[1]);assert.equal((await send({operation:'status'})).receipt,null);
});
for(const mode of ['write-failure','commit-failure','lock','expiry'])test('batch rollback without acknowledgement on '+mode,async t=>{
 const f=fixture(),s=storeFixture(t,f.ids[2].record.account),digest=a.attachmentDigest(f.manifest),b=load('attachmentBatch');let active=true,clock=now;
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async()=>f.ids[0].record},now:()=>clock,current:()=>active};
 const peer={account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000};
 await createAttachmentCustody(deps).receive(JSON.stringify({version:1,operation:'offer',manifest:f.manifest}),peer);
 const failing={transaction:work=>s.store.transaction(async tx=>{let writes=0;const wrapped={...tx,saveChunk:async(...args)=>{await tx.saveChunk(...args);if(++writes===1){if(mode==='write-failure')throw Error('disk');if(mode==='lock')active=false;if(mode==='expiry')clock=f.manifest.expires;}}};const result=await work(wrapped);if(mode==='commit-failure')throw Error('commit');return result;})};
 const result=JSON.parse(await createAttachmentCustody({...deps,store:failing}).receive(JSON.stringify({version:1,operation:'put-batch',digest,index:0,count:f.chunks.length,data:b.packAttachmentBatch(f.manifest,0,f.chunks)}),peer));
 assert.equal(result.status,'rejected');assert.equal(s.db.prepare('SELECT COUNT(*) n FROM asset_chunks').get().n,0);assert.equal((await s.store.transaction(tx=>tx.rows()))[0].received,0);
});
test('attachment custody resumes, rejects unauthorized peers and deletes all chunks only on recipient receipt',async t=>{
 const f=fixture(),s=storeFixture(t,f.ids[2].record.account),digest=a.attachmentDigest(f.manifest);let clock=now;
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async account=>f.ids.find(i=>i.record.account===account)?.record},now:()=>clock,current:()=>true};
 let relay=createAttachmentCustody(deps);
 const b=load('attachmentBatch');const request=async(i,operation,extra={})=>{if(operation==='put'){const c=extra.chunk;operation='put-batch';extra={index:c.index,count:1,data:b.packAttachmentBatch(f.manifest,c.index,[c])};}else if(operation==='get'){operation='get-batch';extra={...extra,count:1};}const result=JSON.parse(await relay.receive(JSON.stringify({version:1,operation,digest,...extra}),{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:clock+60000}));if(result.data)result.chunk=b.unpackAttachmentBatch(f.manifest,extra.index,1,result.data)[0];return result;};
 assert.equal((await request(0,'offer',{manifest:f.manifest})).status,'held');assert.equal((await request(0,'put',{chunk:f.chunks[0]})).received,1);
 relay=createAttachmentCustody(deps);assert.equal((await request(0,'put',{chunk:f.chunks[0]})).received,1);
 assert.equal((await request(1,'put',{chunk:f.chunks[0]})).status,'rejected');assert.equal((await request(0,'get',{index:0})).status,'rejected');
 for(const chunk of f.chunks.slice(1))assert.equal((await request(0,'put',{chunk})).status,'held');
 assert.deepEqual((await request(1,'get',{index:0})).chunk,f.chunks[0]);assert.equal((await request(0,'status')).received,f.chunks.length);
 const receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,clock);
 assert.equal((await request(0,'receipt',{receipt})).status,'rejected');assert.equal((await request(1,'receipt',{receipt:{...receipt,signature:'00'.repeat(64)}})).status,'rejected');
 assert.equal((await request(1,'receipt',{receipt})).status,'completed');await request(1,'receipt',{receipt});assert.equal(relay.contribution().counts.attachmentReceipts,1);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM asset_chunks').get().n,0);
 assert.equal((await request(0,'offer',{manifest:f.manifest})).status,'completed');assert.equal((await request(0,'put',{chunk:f.chunks[0]})).status,'completed');
 assert.deepEqual(await s.other.transaction(tx=>tx.rows()),[]);clock=f.manifest.expires;await relay.sweep();assert.equal(s.db.prepare('SELECT COUNT(*) n FROM assets').get().n,0);
});
test('attachment capacity reservations, failed commits and stopped sessions cannot acknowledge custody',async t=>{
 const f=fixture(),s=storeFixture(t,f.ids[2].record.account),base={owner:f.ids[2].record.account,records:{read:async()=>f.ids[0].record},now:()=>now,current:()=>true};
 const peer={account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000},raw=JSON.stringify({version:1,operation:'offer',manifest:f.manifest});
 assert.equal(JSON.parse(await createAttachmentCustody({...base,store:s.store,maxBytes:1}).receive(raw,peer)).status,'full');
 const broken={transaction:work=>s.store.transaction(async tx=>{await work(tx);throw Error('disk full');})};
 assert.equal(JSON.parse(await createAttachmentCustody({...base,store:broken}).receive(raw,peer)).status,'rejected');assert.equal((await s.store.transaction(tx=>tx.rows())).length,0);
 let live=true;const stopped={transaction:work=>s.store.transaction(async tx=>{const save=tx.save;tx.save=async row=>{await save(row);live=false;};return work(tx);})};
 assert.equal(JSON.parse(await createAttachmentCustody({...base,store:stopped,current:()=>live}).receive(raw,peer)).status,'rejected');assert.equal((await s.store.transaction(tx=>tx.rows())).length,0);
});

test('media scorecard observes committed unique offers and holds counters on rollback',async t=>{
 const f=fixture(17),s=storeFixture(t,f.ids[2].record.account),peer={account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000};
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async()=>f.ids[0].record},now:()=>now,current:()=>true};
 const relay=createAttachmentCustody(deps),raw=JSON.stringify({version:1,operation:'offer',manifest:f.manifest});
 await relay.receive(raw,peer);await relay.receive(raw,peer);assert.equal(relay.contribution().counts.attachmentGrantsHeld,1);
 const bad=createAttachmentCustody({...deps,store:{transaction:async fn=>{await fn({rows:async()=>[],save:async()=>{}});throw Error('commit failed');}}});
 await bad.receive(raw,peer);assert.equal(bad.contribution().counts.attachmentGrantsHeld,0);
});

test('cutover removes retired relay rows and old ciphertext while preserving current blocks',async t=>{
 const f=fixture(),owner=f.ids[2].record.account,s=storeFixture(t,owner),old='a'.repeat(64),orphan='b'.repeat(64);
 const active=a.attachmentDigest(f.manifest);
 await s.store.transaction(async tx=>{
  await tx.save({digest:old,manifest:{version:4},received:1,receipt:null});
  await tx.save({digest:active,manifest:f.manifest,received:1,receipt:null});
  await tx.saveChunk(old,f.chunks[0]);await tx.saveChunk(orphan,f.chunks[0]);await tx.saveChunk(active,f.chunks[0]);
 });
 const relay=createAttachmentCustody({owner,store:s.store,records:{read:async()=>null},now:()=>now,current:()=>true});
 await relay.sweep();
 const remaining=await s.store.inspect();
 assert.deepEqual(remaining.rows.map(r=>r.digest),[active]);
 assert.deepEqual(remaining.chunks.map(r=>r.digest),[active]);
});

test('a shared preview is stored once and served only to the authenticated recipient of each grant',async t=>{
 const f=fixture(500),owner=f.ids[2].record.account,s=storeFixture(t,owner),other=fixture().ids[1];
 const ids=[...f.ids,other],shared={id:'5'.repeat(64),count:2,slot:0};
 const fields={...f.manifest,shared},plain=new Uint8Array([2,4,6]);
 const encrypted=a.sealAttachmentPreview(fields,f.key,plain),wire=Buffer.from(encrypted).toString('base64');
 const preview={width:10,height:10,ciphertextHash:a.attachmentPreviewHash(encrypted)};
 const first=a.signAttachmentManifest({...fields,preview},f.ids[0].signingSeed,f.ids[0].record,now);
 const second=a.signAttachmentManifest({...fields,preview,id:'4'.repeat(64),recipient:other.record.account,recipientDevice:other.device.id,shared:{...shared,slot:1}},f.ids[0].signingSeed,f.ids[0].record,now);
 const relay=createAttachmentCustody({owner,store:s.store,records:{read:async id=>ids.find(i=>i.record.account===id)?.record},now:()=>now,current:()=>true});
 const send=(body,i=0)=>relay.receive(JSON.stringify({version:1,...body}),{account:ids[i].record.account,device:ids[i].device.id,expiresAt:now+60000}).then(JSON.parse);
 const firstDigest=a.attachmentDigest(first),secondDigest=a.attachmentDigest(second);
 assert.equal((await send({operation:'offer',manifest:first})).previewNeeded,true);
 assert.equal((await send({operation:'put-preview',digest:firstDigest,data:wire})).status,'held');
 assert.equal((await send({operation:'offer',manifest:second})).previewNeeded,false);
 assert.equal((await s.store.inspect()).rows.filter(row=>row.preview).length,1);
 assert.equal((await send({operation:'get-preview',digest:secondDigest},1)).status,'rejected');
 const response=await send({operation:'get-preview',digest:secondDigest},3);
 assert.deepEqual(a.openAttachmentPreview(second,f.key,Buffer.from(response.data,'base64')),plain);
});
