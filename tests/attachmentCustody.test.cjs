const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),{createAttachmentCustody}=load('attachmentCustody');
function storeFixture(t,owner){const database=new DatabaseSync(':memory:');t.after(()=>database.close());
 const tx={runAsync:async(s,...p)=>database.prepare(s).run(...p),getAllAsync:async(s,...p)=>database.prepare(s).all(...p),getFirstAsync:async(s,...p)=>database.prepare(s).get(...p)??null};
 const db={...tx,execAsync:async s=>database.exec(s),withExclusiveTransactionAsync:async fn=>{database.exec('BEGIN');try{await fn(tx);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>db}:load(n.slice(2)),out);
 return {store:out.createMobileAttachmentStore(owner),other:out.createMobileAttachmentStore('axonic:1:'+'a'.repeat(64)),db:database};
}
test('attachment custody resumes, rejects unauthorized peers and deletes all chunks only on recipient receipt',async t=>{
 const f=fixture(),s=storeFixture(t,f.ids[2].record.account),digest=a.attachmentDigest(f.manifest);let clock=now;
 const deps={owner:f.ids[2].record.account,store:s.store,records:{read:async account=>f.ids.find(i=>i.record.account===account)?.record},now:()=>clock,current:()=>true};
 let relay=createAttachmentCustody(deps);
 const request=async(i,operation,extra={})=>JSON.parse(await relay.receive(JSON.stringify({version:1,operation,digest,...extra}),{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:clock+60000}));
 assert.equal((await request(0,'offer',{manifest:f.manifest})).status,'held');assert.equal((await request(0,'put',{chunk:f.chunks[0]})).received,1);
 relay=createAttachmentCustody(deps);assert.equal((await request(0,'put',{chunk:f.chunks[0]})).received,1);
 assert.equal((await request(1,'put',{chunk:f.chunks[1]})).status,'rejected');assert.equal((await request(0,'get',{index:0})).status,'rejected');
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
