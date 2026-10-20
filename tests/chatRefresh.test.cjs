const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={},cacheMod={};const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:1,target:9}}).outputText;
new Function('exports','require',compile('src/modules/ui/chatRefresh.ts'))(mod,()=>require('./helpers/storageSafety.cjs'));
new Function('exports',compile('src/modules/ui/chatSnapshotCache.ts'))(cacheMod);
function fixture(){
 let now=0,seq=0,owner='a',reads=0,revision=0,value=0,fail=false,block;
 const timers=new Map(),shown=[],errors=[];
 const cache=cacheMod.createChatSnapshotCache({current:o=>o===owner,revision:()=>revision,read:async()=>{reads++;const captured=value;if(block)await block;if(fail)throw Error('AXONIC_STORAGE_FULL');return captured;}});
 const refresh=mod.createChatRefresh({owner:()=>owner,read:cache.read,fresh:(owner,value)=>cache.peek(owner)===value,ready:(value,ms)=>shown.push({value,ms,at:now}),failed:e=>errors.push(e),now:()=>now,
  schedule:(fn,delay)=>{timers.set(++seq,{fn,at:now+delay});return seq;},cancel:id=>timers.delete(id)});
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 async function advance(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;}
 return {refresh,cache,timers,shown,errors,advance,flush,reads:()=>reads,write(n){value=n;revision++;refresh.wake(owner);},switch(o){owner=o;cache.clear();if(o)refresh.wake(o);},fail(v){fail=v;},block(p){block=p;}};
}
test('committed writes refresh immediately and bursts coalesce; unchanged views avoid storage',async t=>{
 const f=fixture();t.after(()=>f.refresh.stop());await f.advance(0);await f.advance(1);for(let i=1;i<=30;i++)f.write(i);await f.advance(0);
 assert.equal(f.shown.at(-1).value,30);assert.equal(f.shown.at(-1).at,1);assert.equal(f.reads(),2);assert.equal(f.timers.size,0);
 const shown=f.shown.length;await f.advance(3600000);assert.equal(f.reads(),2);assert.equal(f.shown.length,shown,'quiet screens do no scheduled refresh work');
});
test('a write during a slow read catches up immediately without starving rendering',async t=>{
 const f=fixture();t.after(()=>f.refresh.stop());let release;f.block(new Promise(r=>release=r));await f.advance(0);f.write(7);release();await f.flush();
 assert.equal(f.shown.at(-1).value,0);f.block(null);await f.advance(0);assert.equal(f.shown.at(-1).value,7);assert.equal(f.reads(),2);
});
test('failed reads retain the last good view and exponential retry; committed write retries promptly',async t=>{
 const f=fixture();t.after(()=>f.refresh.stop());await f.advance(0);f.fail(true);f.write(9);await f.advance(0);assert.equal(f.errors.length,1);assert.equal(f.shown.at(-1).value,0);
 for(const delay of [2000,4000,8000,16000,32000,60000]){const before=f.reads();await f.advance(delay-1);assert.equal(f.reads(),before);await f.advance(1);assert.equal(f.reads(),before+1);}
 f.fail(false);f.write(10);await f.advance(0);assert.equal(f.shown.at(-1).value,10);
});
test('blur/stop cancels timers and ignores an in-flight result',async()=>{
 const f=fixture();let release;f.block(new Promise(r=>release=r));await f.advance(0);f.refresh.stop();release();await f.flush();f.write(4);await f.advance(60000);
 assert.equal(f.shown.length,0);assert.equal(f.timers.size,0);assert.equal(f.reads(),1);
});
test('account switch and same-account relock cannot publish stale private history',async t=>{
 for(const owner of ['a','b']){const f=fixture();let release;f.block(new Promise(r=>release=r));await f.advance(0);f.switch(null);f.switch(owner);release();await f.flush();assert.equal(f.shown.length,0);f.block(null);await f.advance(0);assert.equal(f.shown.length,1);f.refresh.stop();}
});
test('unrelated account writes do not schedule UI reads',async t=>{
 const f=fixture();t.after(()=>f.refresh.stop());await f.advance(0);f.refresh.wake('other');await f.advance(1);assert.equal(f.shown.length,1);
});
