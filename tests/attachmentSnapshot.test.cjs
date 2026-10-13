const test=require('node:test'),assert=require('node:assert/strict');
const {createAttachmentSnapshot}=require('./helpers/attachment.cjs').load('attachmentPolicy');
test('idle media ticks reuse history and permission changes invalidate immediately',async()=>{
 let revision=0,reads=0,owner='a';const cache=createAttachmentSnapshot({owner:()=>owner,revision:()=>revision,read:async()=>({version:1,contacts:[],messages:[],test:++reads})});
 const first=await cache.read();for(let i=0;i<100;i++)assert.equal(await cache.read(),first);assert.equal(reads,1);
 revision++;assert.notEqual(await cache.read(),first);assert.equal(reads,2);
 owner='b';assert.equal((await cache.read()).owner,'b');assert.equal(reads,3);
 owner=null;assert.equal(await cache.read(),null);
});
test('racing writes and lock/unlock cannot install a stale attachment policy',async()=>{
 let revision=0,resolve;const cache=createAttachmentSnapshot({owner:()=> 'a',revision:()=>revision,read:()=>new Promise(r=>resolve=r)});
 const first=cache.read();revision++;resolve({contacts:[]});assert.equal(await first,null);
 const second=cache.read();cache.clear();resolve({contacts:[]});assert.equal(await second,null);
 const third=cache.read();resolve({contacts:[{blocked:true}]});assert.equal((await third).state.contacts[0].blocked,true);
});
test('failed storage reads remain retryable',async()=>{
 let fail=true;const cache=createAttachmentSnapshot({owner:()=> 'a',revision:()=>0,read:async()=>{if(fail)throw Error('disk');return {contacts:[]};}});
 await assert.rejects(cache.read(),/disk/);fail=false;assert.ok(await cache.read());
});
