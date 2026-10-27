const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),random=n=>new Uint8Array(crypto.randomBytes(n));

test('legacy manifests and encryption contexts fail closed instead of selecting a decoder',()=>{
 const f=fixture();
 for(const version of [undefined,0,1,2,3,5]){
  const old={...f.manifest,version};
  assert.equal(a.validAttachmentManifest(old,now),false);
  assert.equal(a.verifyAttachmentManifest(old,f.ids[0].record,now),false);
  assert.equal(a.verifyAttachmentChunk(old,f.chunks[0]),false);
  assert.throws(()=>a.attachmentBlockBytes(old),/Unsupported/);
  assert.throws(()=>a.encryptAttachmentChunk(old,0,f.plain,f.key));
  assert.throws(()=>a.signAttachmentManifest(old,f.ids[0].signingSeed,f.ids[0].record,now));
 }
});
test('binary leaf preparation preserves canonical hashes and rejects invalid local bounds',()=>{
 const native=value=>crypto.createHash('sha256').update(value).digest('hex');
 for(const length of [17,18,1024,4112])for(const index of [0,1,87]){
  const bytes=random(length),wire=Buffer.from(bytes).toString('hex');
  assert.equal(a.attachmentLeafBytes(index,bytes),a.attachmentLeaf(index,wire));
  assert.equal(a.attachmentLeafBytes(index,bytes,native),a.attachmentLeaf(index,wire));
 }
 for(const index of [-1,0.5,88])assert.throws(()=>a.attachmentLeafBytes(index,random(17)));
 for(const length of [0,16,3_000_017])assert.throws(()=>a.attachmentLeafBytes(0,random(length)));
 assert.throws(()=>a.attachmentLeafBytes(0,random(17),()=> 'bad'));
});
test('binary preparation matches the v4 private/shared nonce, AAD and ciphertext serialization',()=>{
 const {xchacha20poly1305}=require('@noble/ciphers/chacha.js');
 const f=fixture(3_000_001);
 for(const shared of [false,true]){
  const m={...f.manifest,version:4,...(shared?{shared:{id:'ab'.repeat(32),count:2,slot:0}}:{})};
  for(const index of [0,1]){
   const fields=shared?['axonic-attachment-shared-block-v4',m.shared.id,m.sender,m.senderDevice,m.shared.count,m.bytes,index]:['axonic-attachment-block-v4',m.id,m.sender,m.recipient,m.recipientDevice,m.bytes,index];
   const aad=Buffer.from(JSON.stringify(fields)),nonce=crypto.createHash('sha256').update(aad).digest().subarray(0,24),plain=f.plain.slice(index*3_000_000,(index+1)*3_000_000);
   const expected=xchacha20poly1305(f.key,nonce,aad).encrypt(plain);
   assert.deepEqual(a.encryptAttachmentChunkBytes(m,index,plain,f.key),expected);
   assert.equal(a.encryptAttachmentChunk(m,index,plain,f.key),Buffer.from(expected).toString('hex'));
  }
 }
 assert.throws(()=>a.encryptAttachmentChunkBytes(f.manifest,0,new Uint8Array(1),f.key));
 assert.throws(()=>a.encryptAttachmentChunkBytes(f.manifest,0,f.plain.slice(0,3_000_000),new Uint8Array(31)));
});
test('signed attachment streams decrypt in arbitrary order with bounded ciphertext proofs',()=>{
 for(const size of [1,4096,9001,3_000_000,3_000_001]){const f=fixture(size);assert(a.verifyAttachmentManifest(f.manifest,f.ids[0].record,now));
 const output=new Uint8Array(size);for(const chunk of [...f.chunks].reverse()){assert(a.verifyAttachmentChunk(f.manifest,chunk));output.set(a.decryptAttachmentChunk(f.manifest,chunk,f.key),chunk.index*a.ATTACHMENT_STREAM_BLOCK_BYTES);assert(JSON.stringify(chunk).length<6_002_000);}assert.deepEqual(output,f.plain);}
});

test('accelerated leaf hashes preserve canonical bytes, proofs, AEAD and rejection behavior',()=>{
 const hashLeaf=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
 for(const size of [1,4096,4097,787252]){
  const f=fixture(size);
  for(const c of f.chunks){
   assert.equal(a.attachmentLeaf(c.index,c.ciphertext,hashLeaf),a.attachmentLeaf(c.index,c.ciphertext));
   assert(a.verifyAttachmentChunk(f.manifest,c,hashLeaf));
   assert.deepEqual(a.decryptAttachmentChunk(f.manifest,c,f.key,hashLeaf),f.plain.slice(c.index*3_000_000,(c.index+1)*3_000_000));
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
 const f=fixture(),chunk=f.chunks[0];assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,index:1}));assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,ciphertext:(parseInt(chunk.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,'0')+chunk.ciphertext.slice(2)}));
 assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,proof:['00'.repeat(32)]}));assert.throws(()=>a.decryptAttachmentChunk(f.manifest,chunk,random(32)));
 for(const patch of [{bytes:9000},{root:'00'.repeat(32)},{recipient:f.ids[2].record.account},{recipientDevice:f.ids[2].device.id},{expires:f.manifest.expires-1}])assert(!a.verifyAttachmentManifest({...f.manifest,...patch},f.ids[0].record,now));
 assert(!a.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.manifest.expires));assert.throws(()=>a.encryptAttachmentChunk(f.manifest,-1,new Uint8Array(4096),f.key));
});
test('independent block signer authenticates lazy blocks without disclosing signing authority',()=>{
 const f=fixture(3_000_001);
 const publicKey=crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(f.manifest.root,'hex')]),format:'der',type:'spki'});
 for(const c of f.chunks){
  const leaf=crypto.createHash('sha256').update(JSON.stringify(['axonic-attachment-leaf-v1',c.index,c.ciphertext])).digest('hex');
  const body=Buffer.from(JSON.stringify(['axonic-attachment-block-signature-v4',a.attachmentChunkAAD(f.manifest,c.index),f.manifest.created,f.manifest.expires,f.manifest.checksum,leaf]));
  assert(crypto.verify(null,body,publicKey,Buffer.from(c.proof[0],'hex')),'independent OpenSSL Ed25519 verification');
  assert(a.verifyAttachmentChunk(f.manifest,c));
  assert.throws(()=>a.signAttachmentBlock(f.manifest,c.index,c.ciphertext,f.key),/signer/);
  for(const patch of [{created:now-1},{expires:f.manifest.expires-1},{checksum:'00'.repeat(32)},{root:'00'.repeat(32)},{id:'01'.repeat(32)}])
   assert(!a.verifyAttachmentChunk({...f.manifest,...patch},c));
 }
});
test('checksum commitment hides public content equality and is mandatory in the private descriptor',()=>{
 const f=fixture(),checksum=crypto.createHash('sha256').update(f.plain).digest('hex'),key=Buffer.from(f.key).toString('hex');
 const descriptor={manifest:f.manifest,key,checksum,name:'file',mime:'application/octet-stream'};
 assert.notEqual(f.manifest.checksum,checksum);
 assert.equal(f.manifest.checksum,a.attachmentChecksumCommitment(checksum,key));
 assert.notEqual(f.manifest.checksum,a.attachmentChecksumCommitment(checksum,'ff'.repeat(32)));
 const valid=load('attachmentTransfer').validAttachmentDescriptor;
 assert(valid(descriptor));assert(!valid({...descriptor,checksum:'00'.repeat(32)}));assert(!valid({...descriptor,key:'00'.repeat(32)}));
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
