const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol'),random=n=>new Uint8Array(crypto.randomBytes(n));
test('signed attachment streams decrypt in arbitrary order with bounded ciphertext proofs',()=>{
 for(const size of [1,4096,4097,9001,32769]){const f=fixture(size);assert(a.verifyAttachmentManifest(f.manifest,f.ids[0].record,now));
 const output=new Uint8Array(size);for(const chunk of [...f.chunks].reverse()){assert(a.verifyAttachmentChunk(f.manifest,chunk));output.set(a.decryptAttachmentChunk(f.manifest,chunk,f.key),chunk.index*a.ATTACHMENT_CHUNK_BYTES);assert(JSON.stringify(chunk).length<10000);}assert.deepEqual(output,f.plain);}
});
test('chunk tampering, swapped positions, wrong keys and unauthorized manifest mutations fail closed',()=>{
 const f=fixture(),chunk=f.chunks[0];assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,index:1}));assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,ciphertext:'00'+chunk.ciphertext.slice(2)}));
 assert(!a.verifyAttachmentChunk(f.manifest,{...chunk,proof:[]}));assert.throws(()=>a.decryptAttachmentChunk(f.manifest,chunk,random(32)));
 for(const patch of [{bytes:9000},{root:'00'.repeat(32)},{recipient:f.ids[2].record.account},{recipientDevice:f.ids[2].device.id},{expires:f.manifest.expires-1}])assert(!a.verifyAttachmentManifest({...f.manifest,...patch},f.ids[0].record,now));
 assert(!a.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.manifest.expires));assert.throws(()=>a.encryptAttachmentChunk(f.manifest,-1,new Uint8Array(4096),f.key));
});
test('only the intended device can issue the receipt authorizing ciphertext cleanup',()=>{
 const f=fixture(),receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now);
 assert(a.verifyAttachmentReceipt(receipt,f.manifest,f.ids[1].record,now));assert(!a.verifyAttachmentReceipt({...receipt,digest:'00'.repeat(32)},f.manifest,f.ids[1].record,now));
 assert.throws(()=>a.signAttachmentReceipt(f.manifest,f.ids[2].signingSeed,f.ids[2].record,now));assert(!a.verifyAttachmentReceipt(receipt,{...f.manifest,id:'00'.repeat(32)},f.ids[1].record,now));
});
