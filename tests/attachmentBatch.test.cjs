const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,load}=require('./helpers/attachment.cjs'),b=load('attachmentBatch'),a=load('attachmentProtocol');
test('512 KiB batch and final tail preserve exact encrypted chunks and proofs',()=>{
 const f=fixture(512*1024+19);
 for(const [start,count] of [[0,128],[128,1]]){
  const chunks=f.chunks.slice(start,start+count),packed=b.packAttachmentBatch(f.manifest,start,chunks);
  assert(packed.length<b.ATTACHMENT_BULK_FRAME_BYTES-1024);
  assert.deepEqual(b.unpackAttachmentBatch(f.manifest,start,count,packed),chunks);
  for(const chunk of b.unpackAttachmentBatch(f.manifest,start,count,packed))assert(a.verifyAttachmentChunk(f.manifest,chunk));
 }
});
test('batch framing rejects oversized ranges, truncated bytes, noncanonical encoding and invalid source proofs',()=>{
 const f=fixture(),packed=b.packAttachmentBatch(f.manifest,0,f.chunks);
 for(const [start,count] of [[-1,1],[0,129],[0,0],[2,2],[0,1.5]])assert.throws(()=>b.unpackAttachmentBatch(f.manifest,start,count,packed),/range/);
 for(const raw of [null,packed.slice(1),packed+'AAAA','!'+packed.slice(1)])assert.throws(()=>b.unpackAttachmentBatch(f.manifest,0,3,raw));
 const changed=structuredClone(f.chunks);changed[1].ciphertext='00'+changed[1].ciphertext.slice(2);assert.throws(()=>b.packAttachmentBatch(f.manifest,0,changed),/chunk/);
});
test('decoded tampering remains untrusted and fails independent chunk verification',()=>{
 const f=fixture(),packed=b.packAttachmentBatch(f.manifest,0,f.chunks),bytes=Buffer.from(packed,'base64');bytes[17]^=1;
 const chunks=b.unpackAttachmentBatch(f.manifest,0,3,bytes.toString('base64'));
 assert.equal(a.verifyAttachmentChunk(f.manifest,chunks[0]),false);assert.throws(()=>a.decryptAttachmentChunk(f.manifest,chunks[0],f.key));
});
