const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {sizes,fixture,load,source}=require('../scripts/experiments/attachment-chunk-sizes.cjs');
const legacy=require('./helpers/attachment.cjs').load('attachmentProtocol');
for(const size of sizes)for(const version of [1,2])test(`isolated actual ${size} byte chunks v${version}: tails, proofs, AEAD, signatures, resume and receipt`,()=>{
 const f=fixture(size,size*2+19,version),a=f.a.protocol,b=f.a.batch;
 assert.equal(f.chunks.length,3);assert(a.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.now));
 assert(!legacy.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.now));
 for(const other of sizes.filter(n=>n!==size))assert(!load(other).protocol.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.now));
 const out=new Uint8Array(f.plain.length);
 // Simulate a restart with a separately instantiated verifier, replaying prefix.
 for(const i of [0,0,1,2]){const p=load(size).protocol.decryptAttachmentChunk(f.manifest,f.chunks[i],f.key);out.set(p,i*size);p.fill(0);}
 assert.deepEqual(out,f.plain);
 for(const c of f.chunks){
  assert(!a.verifyAttachmentChunk(f.manifest,{...c,index:-1}));
  assert(!a.verifyAttachmentChunk(f.manifest,{...c,ciphertext:(c.ciphertext.startsWith('00')?'01':'00')+c.ciphertext.slice(2)}));
  assert(!a.verifyAttachmentChunk(f.manifest,{...c,proof:[]}));
  assert.throws(()=>a.decryptAttachmentChunk(f.manifest,c,new Uint8Array(32)));
 }
 const encoded=b.packAttachmentBatch(f.manifest,0,f.chunks);assert.deepEqual(b.unpackAttachmentBatch(f.manifest,0,3,encoded),f.chunks);
 assert.throws(()=>b.unpackAttachmentBatch(f.manifest,0,3,encoded.slice(4)));
 const receipt=a.signAttachmentReceipt(f.manifest,f.ids[1].seed,f.ids[1].record,f.now);
 assert(a.verifyAttachmentReceipt(receipt,f.manifest,f.ids[1].record,f.now));
 assert(!a.verifyAttachmentReceipt({...receipt,digest:'00'.repeat(32)},f.manifest,f.ids[1].record,f.now));
 f.key.fill(0);f.plain.fill(0);out.fill(0);
});
test('experimental parameter is allowlisted; shipping codec stays at 4096 and outside experimental domain',()=>{
 for(const size of [0,4095,8192,1048576,NaN])assert.throws(()=>source(size));
 const original=fs.readFileSync('src/services/identity/attachmentProtocol.ts','utf8');
 assert(original.includes('export const ATTACHMENT_CHUNK_BYTES=4096;'));assert(!original.includes('axonic-exp-'));
});
for(const size of sizes)test(`experimental ${size} byte chunks retain fixed 256 KiB transport budget`,()=>{
 const f=fixture(size,262144+19),b=f.a.batch,a=f.a.protocol,count=262144/size;
 const encoded=b.packAttachmentBatch(f.manifest,0,f.chunks.slice(0,count));
 assert(encoded.length<850000-1024);assert.equal(f.chunks.length,count+1);
 const tail=b.unpackAttachmentBatch(f.manifest,count,1,b.packAttachmentBatch(f.manifest,count,[f.chunks[count]]));
 assert.equal(a.decryptAttachmentChunk(f.manifest,tail[0],f.key).length,19);
 assert(!a.verifyAttachmentManifest({...f.manifest,bytes:f.manifest.bytes-1},f.ids[0].record,f.now));
 assert(!a.verifyAttachmentManifest({...f.manifest,recipient:f.manifest.sender},f.ids[0].record,f.now));
 assert(!a.verifyAttachmentManifest(f.manifest,f.ids[0].record,f.manifest.expires));
 f.key.fill(0);f.plain.fill(0);
});
