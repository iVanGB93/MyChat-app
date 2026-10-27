const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),{createAttachmentCustody}=load('attachmentCustody');
test('retired local custody records stay intact and do not block current offers',async()=>{
 const f=fixture(),old={digest:'a'.repeat(64),manifest:{version:3},received:0,receipt:null},rows=[old];
 const store={transaction:async work=>work({rows:async()=>rows,save:async row=>rows.push(row),erase:async()=>{throw Error('must preserve old data');},eraseChunks:async()=>{throw Error('must preserve old files');}})};
 const relay=createAttachmentCustody({owner:f.ids[2].record.account,store,records:{read:async()=>f.ids[0].record},now:()=>now,current:()=>true});
 const response=JSON.parse(await relay.receive(JSON.stringify({version:1,operation:'offer',manifest:f.manifest}),{account:f.ids[0].record.account,device:f.ids[0].device.id,expiresAt:now+60000}));
 assert.equal(response.status,'held');assert.equal(rows[0],old);assert.equal(rows.length,2);
});
function storeFixture(t,owner){const database=new DatabaseSync(':memory:');t.after(()=>database.close());
 const tx={runAsync:async(s,...p)=>database.prepare(s).run(...p),getAllAsync:async(s,...p)=>database.prepare(s).all(...p),getFirstAsync:async(s,...p)=>database.prepare(s).get(...p)??null};
 const db={...tx,execAsync:async s=>database.exec(s),withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(tx);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>db}:load(n.slice(2)),out);
 return {store:out.createMobileAttachmentStore(owner),other:out.createMobileAttachmentStore('axonic:1:'+'a'.repeat(64)),db:database};
}

test('upload batches validate all proofs, commit atomically, and retry idempotently across restart',async t=>{
 const f=fixture(3_000_019),s=storeFixture(t,f.ids[2].record.account),digest=a.attachmentDigest(f.manifest),b=load('attachmentBatch');
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async id=>f.ids.find(i=>i.record.account===id)?.record},now:()=>now,current:()=>true};let relay=createAttachmentCustody(deps);
 const peer=i=>({account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:now+60000});
 const send=(body,i=0)=>relay.receive(JSON.stringify({version:1,digest,...body}),peer(i)).then(JSON.parse);
 await send({operation:'offer',manifest:f.manifest});
 const batch={operation:'put-batch',index:0,count:1,data:b.packAttachmentBatch(f.manifest,0,f.chunks.slice(0,1))};
 const corrupt=Buffer.from(batch.data,'base64');corrupt[corrupt.length-1]^=1;
 for(const body of [{...batch,data:corrupt.toString('base64')},{...batch,index:2},{...batch,count:129},{...batch,extra:'forbidden'},{...batch,data:batch.data+'='}])assert.equal((await send(body)).status,'rejected');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM asset_chunks').get().n,0);
 assert.equal((await send(batch,1)).status,'rejected');
 assert.equal((await send(batch)).received,1);relay=createAttachmentCustody(deps);assert.equal((await send(batch)).received,1);
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
 assert.equal((await request(1,'receipt',{receipt})).status,'completed');assert.equal(s.db.prepare('SELECT COUNT(*) n FROM asset_chunks').get().n,0);
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
