const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/ui/chatSnapshotCache.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
test('unchanged history is read once across polls and screen opens; writes invalidate it',async()=>{
 let revision=0,reads=0,active='a';const cache=mod.createChatSnapshotCache({revision:()=>revision,current:o=>o===active,read:async()=>({messages:[++reads]})});
 const first=await cache.read('a');for(let i=0;i<100;i++)assert.equal(await cache.read('a'),first);
 assert.equal(reads,1);assert.equal(cache.peek('a'),first);
 revision++;assert.equal(cache.peek('a'),undefined);assert.notEqual(await cache.read('a'),first);assert.equal(reads,2);
 active='b';assert.equal(cache.peek('a'),undefined);assert.equal(await cache.read('a'),undefined);assert.equal(reads,2);
 await cache.read('b');assert.equal(reads,3);
});
test('concurrent readers share a read; racing writes are never cached as fresh',async()=>{
 let revision=0,resolve,reads=0;const cache=mod.createChatSnapshotCache({revision:()=>revision,current:()=>true,read:()=>{reads++;return new Promise(r=>resolve=r);}});
 const a=cache.read('a'),b=cache.read('a');assert.equal(a,b);revision++;resolve({old:true});await a;
 assert.equal(cache.peek('a'),undefined);const fresh=cache.read('a');resolve({fresh:true});await fresh;assert.equal(reads,2);assert.deepEqual(cache.peek('a'),{fresh:true});
});
test('failed reads can retry and account switches discard in-flight results',async()=>{
 let active=true,fail=true;const cache=mod.createChatSnapshotCache({revision:()=>0,current:()=>active,read:async()=>{if(fail)throw Error('disk');active=false;return {};}});
 await assert.rejects(cache.read('a'),/disk/);fail=false;assert.equal(await cache.read('a'),undefined);assert.equal(cache.peek('a'),undefined);
});
test('lock and unlock of the same account cannot resurrect an old in-flight view',async()=>{
 let resolve;const cache=mod.createChatSnapshotCache({revision:()=>0,current:()=>true,read:()=>new Promise(r=>resolve=r)});
 const pending=cache.read('a');cache.clear();resolve({private:true});assert.equal(await pending,undefined);assert.equal(cache.peek('a'),undefined);
});
