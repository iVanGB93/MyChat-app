const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntimeChatReads,createPeerCapabilityWriter}=require('./helpers/attachment.cjs').load('runtimeChatReads');
test('runtime consumers coalesce unchanged reads and refresh on writes',async()=>{
 let reads=0,revision=0,owner='a';const cache=createRuntimeChatReads({owner:()=>owner,revision:()=>revision,read:async()=>({contacts:[],messages:[],read:++reads})});
 const [a,b]=await Promise.all([cache.read(),cache.read()]);assert.equal(a,b);
 for(let i=0;i<30;i++)assert.equal(await cache.read(),a);assert.equal(reads,1);
 revision++;assert.notEqual(await cache.read(),a);assert.equal(reads,2);
 owner=null;await assert.rejects(cache.read());
});
test('post-write permission lookup never shares a pre-write in-flight read',async()=>{
 let revision=0;const resolves=[];const cache=createRuntimeChatReads({owner:()=> 'a',revision:()=>revision,read:()=>new Promise(r=>resolves.push(r))});
 const old=cache.read();revision++;const fresh=cache.read();assert.notEqual(old,fresh);
 resolves[1]({blocked:true});await fresh;resolves[0]({blocked:false});await old;
 assert.equal((await cache.read()).blocked,true);
 const pending=(()=>{revision++;return cache.read();})();cache.clear();resolves[2]({});await assert.rejects(pending,/Account changed/);
});
test('capabilities persist only changed sets, retry failures, and invalidate on account changes',async()=>{
 let writes=0,owner='a',fail=false;const writer=createPeerCapabilityWriter({owner:()=>owner,write:async()=>{writes++;if(fail)throw Error('storage');}});
 await writer.update(['b','c'],['b']);await writer.update(['c','b'],['b']);assert.equal(writes,1);
 fail=true;await assert.rejects(writer.update(['b'],[]));fail=false;await writer.update(['b'],[]);assert.equal(writes,3);
 owner='d';await writer.update(['b'],[]);assert.equal(writes,4);writer.clear();await writer.update(['b'],[]);assert.equal(writes,5);
});
