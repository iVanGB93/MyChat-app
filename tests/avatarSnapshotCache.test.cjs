const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/ui/avatarSnapshotCache.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
test('navigation shares avatar reads, including missing photos, with bounded eviction',async()=>{
 let reads=0;const cache=mod.createAvatarSnapshotCache({current:o=>o==='a',read:async(o,p)=>{reads++;return p==='missing'?null:p;}},2);
 await Promise.all([cache.read('a','one'),cache.read('a','one')]);assert.equal(reads,1);
 for(let i=0;i<10;i++)assert.equal(await cache.read('a','missing'),null);assert.equal(reads,2);
 await cache.read('a','two');await cache.read('a','one');assert.equal(reads,4);
 assert.equal(await cache.read('other','one'),null);assert.equal(reads,4);
});
test('avatar changes and same-account relock invalidate in-flight and cached images',async()=>{
 const releases=[];let active=true;
 const cache=mod.createAvatarSnapshotCache({current:()=>active,read:()=>new Promise(r=>releases.push(r))});
 const old=cache.read('a','one');await Promise.resolve();cache.clear();releases.shift()('old');assert.equal(await old,null);
 const fresh=cache.read('a','one');await Promise.resolve();releases.shift()('new');assert.equal(await fresh,'new');
 cache.clear();const locked=cache.read('a','one');await Promise.resolve();active=false;releases.shift()('private');assert.equal(await locked,null);
});
test('failed avatar storage reads are retried instead of cached as missing',async()=>{
 let reads=0;const cache=mod.createAvatarSnapshotCache({current:()=>true,read:async()=>{if(++reads===1)throw Error('disk');return 'image';}});
 await assert.rejects(cache.read('a','one'),/disk/);assert.equal(await cache.read('a','one'),'image');
});
