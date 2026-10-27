const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,load}=require('./helpers/attachment.cjs'),p=load('attachmentProtocol');
test('platform decryption verifies signed block before invoking primitive and checks result length',async()=>{
 const f=fixture(19),chunk=f.chunks[0];let calls=0;
 const decrypt=async(cipher,key,aad)=>{calls++;assert.equal(aad,p.attachmentChunkAAD(f.manifest,0));return p.decryptAttachmentChunk(f.manifest,{...chunk,ciphertext:cipher},key);};
 assert.deepEqual(await p.decryptAttachmentChunkAsync(f.manifest,chunk,f.key,undefined,undefined,decrypt),f.plain);
 for(const bad of [{...chunk,index:1},{...chunk,proof:['00'.repeat(64)]},{...chunk,ciphertext:'00'+chunk.ciphertext.slice(2)}])await assert.rejects(p.decryptAttachmentChunkAsync(f.manifest,bad,f.key,undefined,undefined,decrypt));
 assert.equal(calls,1);
 const short=new Uint8Array(18).fill(7);
 await assert.rejects(p.decryptAttachmentChunkAsync(f.manifest,chunk,f.key,undefined,undefined,async()=>short));
 assert(short.every(n=>n===0));
 await assert.rejects(p.decryptAttachmentChunkAsync(f.manifest,chunk,f.key,undefined,undefined,async()=>{throw Error('native rejected');}),/native rejected/);
 assert.deepEqual(await p.decryptAttachmentChunkAsync(f.manifest,chunk,f.key),f.plain);
});
test('sync processing timing records fixed stages and errors without changing return behavior',()=>{
 let now=0;const timing=load('attachmentTiming').createAttachmentTiming(true,()=>now);
 assert.equal(timing.measureSync('decodeBlock',()=>{now=12;return 7;}),7);
 assert.throws(()=>timing.measureSync('verifyDecryptBlock',()=>{now=20;throw Error('failure');}));
 assert.deepEqual(timing.snapshot().decodeBlock,{calls:1,milliseconds:12,maximum:12,errors:0});
 assert.equal(timing.snapshot().verifyDecryptBlock.errors,1);
});
