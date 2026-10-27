const test=require('node:test'),assert=require('node:assert/strict');
const {load,fixture,now}=require('./helpers/attachment.cjs');
const b=load('attachmentBatch'),a=load('attachmentProtocol'),{createAttachmentCustody}=load('attachmentCustody');
function shared(version=4){
 const f=fixture(version===4?5_000_000:9001),other=fixture().ids[1];f.ids.push(other);
 const base={...f.manifest,version,shared:{id:'ab'.repeat(32),count:2,slot:0}},block=a.attachmentBlockBytes(base);
 const encrypted=Array.from({length:Math.ceil(f.plain.length/block)},(_,i)=>a.encryptAttachmentChunk(base,i,f.plain.slice(i*block,(i+1)*block),f.key));
 const first=a.signAttachmentManifest({...base,root:a.attachmentBlockPublicKey(f.signer)},f.ids[0].signingSeed,f.ids[0].record,now);
 const second=a.signAttachmentManifest({...first,id:'cd'.repeat(32),recipient:other.record.account,recipientDevice:other.device.id,shared:{...base.shared,slot:1}},f.ids[0].signingSeed,f.ids[0].record,now);
 return {...f,first,second,chunks:encrypted.map((ciphertext,index)=>a.signAttachmentBlock(first,index,ciphertext,f.signer))};
}
test('shared ciphertext decrypts for separate signed grants, with recipient-bound receipts',()=>{
 const f=shared();assert.notEqual(a.attachmentDigest(f.first),a.attachmentDigest(f.second));assert.equal(a.attachmentContentDigest(f.first),a.attachmentContentDigest(f.second));
 for(const m of [f.first,f.second]){assert(a.verifyAttachmentManifest(m,f.ids[0].record,now));for(const c of f.chunks)assert.deepEqual(a.decryptAttachmentChunk(m,c,f.key),f.plain.slice(c.index*3_000_000,(c.index+1)*3_000_000));}
 for(const patch of [{recipient:f.second.recipient},{shared:{...f.first.shared,slot:1}},{shared:{...f.first.shared,count:3}},{version:1}])assert.equal(a.verifyAttachmentManifest({...f.first,...patch},f.ids[0].record,now),false);
 assert.throws(()=>a.decryptAttachmentChunk(f.first,f.chunks[0],new Uint8Array(32)));
 const receipt=a.signAttachmentReceipt(f.first,f.ids[1].signingSeed,f.ids[1].record,now);
 assert.equal(a.verifyAttachmentReceipt(receipt,f.second,f.ids[3].record,now),false);
});
test('one uploaded blob survives an early receipt and serves a later grant, then is erased',async()=>{
 const f=shared(),rows=new Map(),chunks=new Map();let clock=now,puts=0;
 const store={transaction:async work=>work({rows:async()=>[...rows.values()],save:async r=>rows.set(r.digest,r),chunk:async(d,i)=>chunks.get(d+':'+i)??null,saveChunk:async(d,c)=>{puts++;chunks.set(d+':'+c.index,c);},eraseChunks:async d=>{for(const k of chunks.keys())if(k.startsWith(d+':'))chunks.delete(k);},erase:async d=>rows.delete(d)})};
 const deps={owner:f.ids[2].record.account,store,records:{read:async account=>f.ids.find(i=>i.record.account===account)?.record},now:()=>clock,current:()=>true};let relay=createAttachmentCustody(deps);
 const request=async(i,m,operation,extra={})=>{if(operation==='put'){const c=extra.chunk;operation='put-batch';extra={index:c.index,count:1,data:b.packAttachmentBatch(m,c.index,[c])};}else if(operation==='get'){operation='get-batch';extra={...extra,count:1};}const result=JSON.parse(await relay.receive(JSON.stringify({version:1,operation,digest:a.attachmentDigest(m),...extra}),{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:clock+60000}));if(result.data)result.chunk=b.unpackAttachmentBatch(m,extra.index,1,result.data)[0];return result;};
 assert.equal((await request(0,f.first,'offer',{manifest:f.first})).status,'held');
 // Out-of-order uploads must not advertise a resumable prefix across a hole.
 await request(0,f.first,'put',{chunk:f.chunks[1]});assert.equal((await request(0,f.first,'status')).received,0);
 await request(0,f.first,'put',{chunk:f.chunks[0]});assert.equal((await request(0,f.first,'status')).received,2);

 const receipt=a.signAttachmentReceipt(f.first,f.ids[1].signingSeed,f.ids[1].record,now);
 assert.equal((await request(1,f.first,'receipt',{receipt})).status,'completed');assert.equal(chunks.size,2);
 relay=createAttachmentCustody(deps);
 assert.equal((await request(0,f.second,'offer',{manifest:f.second})).received,2);
 assert.equal((await request(1,f.second,'get',{index:0})).status,'rejected');
 assert.deepEqual((await request(3,f.second,'get',{index:0})).chunk,f.chunks[0]);assert.equal(puts,2);
 const r2=a.signAttachmentReceipt(f.second,f.ids[3].signingSeed,f.ids[3].record,now);
 assert.equal((await request(3,f.second,'receipt',{receipt:r2})).status,'completed');assert.equal(chunks.size,0);
 clock=f.first.expires;await relay.sweep();assert.equal(rows.size,0);
});

for(const [batched,version] of [[true,4]])test('group transfer workers upload each ciphertext block once and independently confirm both recipients, batch='+batched+', version='+version,async()=>{
 const f=shared(version),rows=new Map(),chunks=new Map(),jobs=new Map(),received=new Map();let puts=0,clock=now,tail=Promise.resolve();
 const tx={rows:async()=>[...rows.values()],save:async r=>rows.set(r.digest,r),chunk:async(d,i)=>chunks.get(d+':'+i)??null,saveChunk:async(d,c)=>{puts++;chunks.set(d+':'+c.index,c);},eraseChunks:async d=>{for(const k of chunks.keys())if(k.startsWith(d+':'))chunks.delete(k);},erase:async d=>rows.delete(d)};
 const store={transaction:work=>{const next=tail.then(()=>work(tx));tail=next.catch(()=>{});return next;}};
 const relay=createAttachmentCustody({owner:f.ids[2].record.account,store,records:{read:async account=>f.ids.find(i=>i.record.account===account)?.record},now:()=>clock,current:()=>true});
 const jobStore={list:async owner=>[...jobs.values()].filter(j=>j.owner===owner).map(j=>structuredClone(j)),get:async(owner,digest)=>structuredClone(jobs.get(owner+digest)??null),save:async(j,expected,current)=>{const key=j.owner+j.digest,old=jobs.get(key);if(!current()||(old?.revision??null)!==expected)return false;jobs.set(key,structuredClone(j));return true;}};
 const workers=[0,1,3].map(i=>load('attachmentTransfer').createAttachmentTransfer({owner:()=>f.ids[i].record.account,
device:()=>f.ids[i].device.id,
now:()=>clock,
record:async account=>f.ids.find(i=>i.record.account===account)?.record,
allowed:()=>true,
downloadWindow:4,
signReceipt:async m=>a.signAttachmentReceipt(m,f.ids[i].signingSeed,f.ids[i].record,clock),
completed:async()=>{},
 storage:{jobs:jobStore,files:{readChunk:async(_,index)=>f.chunks[index],
writeChunk:async(j,index,bytes)=>{const key=j.owner+j.digest;const parts=received.get(key)??[];parts[index]=Buffer.from(bytes);received.set(key,parts);},
writeChunks:batched?async(j,index,bytes)=>{const key=j.owner+j.digest,parts=received.get(key)??[];for(let n=0;n<bytes.length;n++)parts[index+n]=Buffer.from(bytes[n]);received.set(key,parts);}:undefined,
commitFile:async j=>assert.deepEqual(Buffer.concat(received.get(j.owner+j.digest)),Buffer.from(f.plain))}},
 connections:{peers:()=>[f.ids[2].record.account],
sharedPeers:()=>[f.ids[2].record.account],
request:async(_,raw)=>{assert(!raw.includes(Buffer.from(f.key).toString('hex')));return relay.receive(raw,{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:clock+60000});},
uploadBatchPeers:()=>batched?[f.ids[2].record.account]:[],
bulkRequest:async(_,raw)=>{assert(!raw.includes(Buffer.from(f.key).toString('hex')));return relay.receive(raw,{account:f.ids[i].record.account,device:f.ids[i].device.id,expiresAt:clock+60000});},
blockStreamPeers:()=>version===4?[f.ids[2].record.account]:[],
bulkPeers:()=>version===4?[f.ids[2].record.account]:[]}
}));
 const descriptor=m=>({manifest:m,key:Buffer.from(f.key).toString('hex'),checksum:require('crypto').createHash('sha256').update(f.plain).digest('hex'),name:'group.bin',mime:'application/octet-stream'});
 await workers[0].enqueue(descriptor(f.first),'outgoing');await workers[0].enqueue(descriptor(f.second),'outgoing');
 for(let n=0;n<20;n++){await workers[0].tick();clock+=300;}
 assert.equal(puts,f.chunks.length,'second recipient reuses the first upload');
 await workers[1].enqueue(descriptor(f.first),'incoming');
 for(let n=0;n<20;n++){await workers[1].tick();await workers[0].tick();clock+=300;}
 assert.equal((await jobStore.get(f.ids[0].record.account,a.attachmentDigest(f.first))).phase,'complete');
 assert.notEqual((await jobStore.get(f.ids[0].record.account,a.attachmentDigest(f.second))).phase,'complete');assert.equal(chunks.size,f.chunks.length);
 await workers[2].enqueue(descriptor(f.second),'incoming');
 for(let n=0;n<20;n++){await workers[2].tick();await workers[0].tick();clock+=300;}
 assert.equal((await jobStore.get(f.ids[0].record.account,a.attachmentDigest(f.second))).phase,'complete');assert.equal(chunks.size,0);assert.equal(puts,f.chunks.length);
 workers.forEach(w=>w.stop());
});
