const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/workPump.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
function clock(run,options={}){
 let now=0,next=0;const timers=new Map();
 const pump=out.createWorkPump({run,idleMilliseconds:200,maximumIdleMilliseconds:5000,...options,
  schedule:(fn,delay)=>{timers.set(++next,{fn,at:now+delay});return next;},cancel:id=>timers.delete(id)});
 async function advance(ms){const end=now+ms;for(;;){const due=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!due||due[1].at>end)break;now=due[1].at;timers.delete(due[0]);due[1].fn();for(let n=0;n<8;n++)await Promise.resolve();}now=end;}
 return {pump,advance,timers};
}
test('idle backoff removes at least 90 percent of polls; wake interrupts the safety wait',async()=>{
 let runs=0;const f=clock(async()=>{runs++;return false;});await f.advance(60000);
 assert(runs<=17,`idle runs: ${runs}`);assert(runs>10,'safety poll remains active');
 const before=runs;f.pump.wake();await f.advance(0);assert.equal(runs,before+1);f.pump.stop();
});
test('active progress is not delayed, with only one pending timer',async()=>{
 let runs=0;const f=clock(async()=>++runs<=20);await f.advance(0);assert.equal(runs,21);assert.equal(f.timers.size,1);f.pump.stop();
});
test('events during an await are coalesced but never lost',async()=>{
 let release,runs=0;const f=clock(()=>{runs++;return runs===1?new Promise(r=>release=r):Promise.resolve(false);});
 await f.advance(0);for(let n=0;n<20;n++)f.pump.wake();assert.equal(runs,1);assert.equal(f.timers.size,0);
 release(false);await Promise.resolve();await f.advance(0);assert.equal(runs,2);assert.equal(f.timers.size,1);f.pump.stop();
});
test('errors retain a safety retry, stop prevents rescheduling in-flight work',async()=>{
 let release,runs=0;const f=clock(async()=>{if(++runs===1)throw Error('storage');return new Promise(r=>release=r);});
 await f.advance(200);assert.equal(runs,2);assert.equal(f.pump.snapshot().failures,1);f.pump.stop();release(true);
 await Promise.resolve();await f.advance(60000);f.pump.wake();assert.equal(f.timers.size,0);assert.equal(runs,2);
});
test('quiet media polls back off while still checking at most five minutes later',async()=>{
 let runs=0;const f=clock(async()=>{runs++;},{idleMilliseconds:15000,maximumIdleMilliseconds:300000});
 await f.advance(1800000);assert.equal(runs,10);f.pump.wake();await f.advance(0);assert.equal(runs,11);f.pump.stop();
});
