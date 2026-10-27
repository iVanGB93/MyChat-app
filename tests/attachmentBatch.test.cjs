const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,load}=require('./helpers/attachment.cjs'),b=load('attachmentBatch'),a=load('attachmentProtocol');
test('3 MB block and final tail preserve exact encrypted chunks and proofs',()=>{
 const f=fixture(3_000_019);
 for(const [start,count] of [[0,1],[1,1]]){
  const chunks=f.chunks.slice(start,start+count),packed=b.packAttachmentBatch(f.manifest,start,chunks);
  assert(packed.length<b.ATTACHMENT_STREAM_FRAME_BYTES-1024);
  assert.deepEqual(b.unpackAttachmentBatch(f.manifest,start,count,packed),chunks);
  for(const chunk of b.unpackAttachmentBatch(f.manifest,start,count,packed))assert(a.verifyAttachmentChunk(f.manifest,chunk));
 }
});
test('batch framing rejects oversized ranges, truncated bytes, noncanonical encoding and invalid source proofs',()=>{
 const f=fixture(),packed=b.packAttachmentBatch(f.manifest,0,f.chunks);
 for(const [start,count] of [[-1,1],[0,2],[0,0],[2,2],[0,1.5]])assert.throws(()=>b.unpackAttachmentBatch(f.manifest,start,count,packed),/range/);
 for(const raw of [null,packed.slice(1),packed+'AAAA','!'+packed.slice(1)])assert.throws(()=>b.unpackAttachmentBatch(f.manifest,0,1,raw));
 const changed=structuredClone(f.chunks);changed[0].ciphertext='00'+changed[0].ciphertext.slice(2);assert.throws(()=>b.packAttachmentBatch(f.manifest,0,changed),/chunk/);
});
test('decoded tampering remains untrusted and fails independent chunk verification',()=>{
 const f=fixture(),packed=b.packAttachmentBatch(f.manifest,0,f.chunks),bytes=Buffer.from(packed,'base64');bytes[17]^=1;
 const chunks=b.unpackAttachmentBatch(f.manifest,0,1,bytes.toString('base64'));
 assert.equal(a.verifyAttachmentChunk(f.manifest,chunks[0]),false);assert.throws(()=>a.decryptAttachmentChunk(f.manifest,chunks[0],f.key));
});

test('canonical base64 padding and unused bits are checked without a full re-encode',()=>{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 for(const size of [1,2,3,4,5,6,19]){
  const f=fixture(size),packed=b.packAttachmentBatch(f.manifest,0,f.chunks);
  const codec={fromBase64:s=>new Uint8Array(Buffer.from(s,'base64')),toBase64:()=>{throw Error('unnecessary full re-encode');},toHex:b=>Buffer.from(b).toString('hex')};
  assert.deepEqual(b.unpackAttachmentBatch(f.manifest,0,1,packed,codec),f.chunks);
  const padding=packed.endsWith('==')?2:packed.endsWith('=')?1:0;
  if(padding){const at=packed.length-padding-1;
   const alias=packed.slice(0,at)+alphabet[alphabet.indexOf(packed[at])|1]+packed.slice(at+1);
   assert.deepEqual(Buffer.from(alias,'base64'),Buffer.from(packed,'base64'));
   assert.throws(()=>b.unpackAttachmentBatch(f.manifest,0,1,alias),/Noncanonical/);
   assert.throws(()=>b.unpackAttachmentBatch(f.manifest,0,1,packed.slice(0,-1)+'A'));
  }else assert.throws(()=>b.unpackAttachmentBatch(f.manifest,0,1,packed.slice(0,-1)+'='));
 }
});
