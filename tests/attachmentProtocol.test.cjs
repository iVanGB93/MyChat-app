const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),random=n=>new Uint8Array(crypto.randomBytes(n));
test('signed attachment streams decrypt in arbitrary order with bounded ciphertext proofs',()=>{
 for(const size of [1,4096,4097,9001,32769]){const f=fixture(size);assert(a.verifyAttachmentManifest(f.manifest,f.ids[0].record,now));
 const output=new Uint8Array(size);for(const chunk of [...f.chunks].reverse()){assert(a.verifyAttachmentChunk(f.manifest,chunk));output.set(a.decryptAttachmentChunk(f.manifest,chunk,f.key),chunk.index*a.ATTACHMENT_CHUNK_BYTES);assert(JSON.stringify(chunk).length<10000);}assert.deepEqual(output,f.plain);}
});

test('accelerated leaf hashes preserve canonical bytes, proofs, AEAD and rejection behavior',()=>{
 const hashLeaf=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
 for(const size of [1,4096,4097,787252]){
  const f=fixture(size);
  for(const c of f.chunks){
   assert.equal(a.attachmentLeaf(c.index,c.ciphertext,hashLeaf),a.attachmentLeaf(c.index,c.ciphertext));
   assert(a.verifyAttachmentChunk(f.manifest,c,hashLeaf));
   assert.deepEqual(a.decryptAttachmentChunk(f.manifest,c,f.key,hashLeaf),f.plain.slice(c.index*4096,(c.index+1)*4096));
  }
  const c=f.chunks[0],bad={...c,ciphertext:(c.ciphertext.startsWith('00')?'01':'00')+c.ciphertext.slice(2)};
  assert(!a.verifyAttachmentChunk(f.manifest,bad,hashLeaf));
  assert(!a.verifyAttachmentChunk({...f.manifest,root:'00'.repeat(32)},c,hashLeaf));
  assert.throws(()=>a.decryptAttachmentChunk(f.manifest,c,new Uint8Array(32),hashLeaf));
  assert(!a.verifyAttachmentChunk(f.manifest,c,()=>{throw Error('native failed');}));
  assert(!a.verifyAttachmentChunk(f.manifest,c,()=> 'bad'));
  const b=load('attachmentBatch'),chunks=f.chunks.slice(0,128);
  assert.equal(b.packAttachmentBatch(f.manifest,0,chunks,hashLeaf),b.packAttachmentBatch(f.manifest,0,chunks));
 }
 let called=false;assert.throws(()=>a.attachmentLeaf(0,'gg'.repeat(17),()=>{called=true;return '00'.repeat(32);}));assert.equal(called,false);
});
test('chunk tampering, swapped positions, wrong keys and unauthorized manifest mutations fail closed',()=>{
 const f=fixture(),chunk=f.chunks[0];assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,index:1}));assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,ciphertext:'00'+chunk.ciphertext.slice(2)}));
 assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,proof:[]}));assert.throws(()=>a.decryptAttachmentChunk(f.manifest,chunk,random(32)));
 for(const patch of [{bytes:9000},{root:'00'.repeat(32)},{recipient:f.ids[2].record.account},{recipientDevice:f.ids[2].device.id},{expires:f.manifest.expires-1}])assert(!a.verifyAttachmentManifest({...f.manifest,...patch},f.ids[0].record,now));
 assert(!a.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.manifest.expires));assert.throws(()=>a.encryptAttachmentChunk(f.manifest,-1,new Uint8Array(4096),f.key));
});
test('public branch reuse preserves reference hashes through eviction and never admits changed proofs',()=>{
 const crypto=require('node:crypto'),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const f=fixture(787252);
 let level=f.chunks.map(c=>hash(['axonic-attachment-leaf-v1',c.index,c.ciphertext]));
 while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2)next.push(hash(['axonic-attachment-branch-v1',level[i],level[i+1]??level[i]]));level=next;}
 assert.equal(f.manifest.root,level[0]);
 for(let round=0;round<2;round++){
  assert(a.verifyAttachmentChunk(f.manifest,f.chunks[0]));
  const bad={...f.chunks[0],proof:[...f.chunks[0].proof]};bad.proof[0]='00'.repeat(32);
  assert(!a.verifyAttachmentChunk(f.manifest,bad));
  assert(!a.verifyAttachmentChunk({...f.manifest,root:'00'.repeat(32)},f.chunks[0]));
  assert.throws(()=>a.decryptAttachmentChunk({...f.manifest,id:'01'.repeat(32)},f.chunks[0],f.key));
  assert.deepEqual(a.decryptAttachmentChunk(f.manifest,f.chunks[0],f.key),f.plain.slice(0,4096));
  // More distinct branches than the bounded cache can retain.
  a.buildAttachmentTree(Array.from({length:2048},(_,i)=>hash(['eviction',round,i])));
 }
});

test('only the intended device can issue the receipt authorizing ciphertext cleanup',()=>{
 const f=fixture(),receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now);
 assert(a.verifyAttachmentReceipt(receipt,f.manifest,f.ids[1].record,now));assert(!a.verifyAttachmentReceipt({...receipt,digest:'00'.repeat(32)},f.manifest,f.ids[1].record,now));
 assert.throws(()=>a.signAttachmentReceipt(f.manifest,f.ids[2].signingSeed,f.ids[2].record,now));assert(!a.verifyAttachmentReceipt(receipt,{...f.manifest,id:'00'.repeat(32)},f.ids[1].record,now));
});
test('warm signature cache never bypasses expiry, current identity/device checks or changed signed bytes',()=>{
 const f=fixture(),m=f.manifest,sender=f.ids[0].record,recipient=f.ids[1].record;
 const receipt=a.signAttachmentReceipt(m,f.ids[1].signingSeed,recipient,now);
 for(let i=0;i<3;i++){assert(a.verifyAttachmentManifest(m,sender,now));assert(a.verifyAttachmentReceipt(receipt,m,recipient,now));}
 assert(!a.verifyAttachmentManifest(m,sender,m.expires));assert(!a.verifyAttachmentReceipt(receipt,m,recipient,m.expires));
 assert(!a.verifyAttachmentManifest(m,{...sender,devices:[]},now));assert(!a.verifyAttachmentReceipt(receipt,m,{...recipient,devices:[]},now));
 assert(!a.verifyAttachmentManifest({...m,root:'01'.repeat(32)},sender,now));
 assert(!a.verifyAttachmentManifest({...m,signature:'00'.repeat(64)},sender,now));
 assert(!a.verifyAttachmentReceipt({...receipt,signature:'00'.repeat(64)},m,recipient,now));
 assert(!a.verifyAttachmentReceipt({...receipt,device:f.ids[2].device.id},m,recipient,now));
 assert(a.verifyAttachmentManifest(m,sender,now));assert(a.verifyAttachmentReceipt(receipt,m,recipient,now));
});
