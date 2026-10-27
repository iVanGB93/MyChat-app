const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/workPump.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
function clock(run,options={}){
 let now=0,next=0;const timers=new Map();
 const pump=out.createWorkPump({run,now:()=>now,idleMilliseconds:200,maximumIdleMilliseconds:5000,...options,
  schedule:(fn,delay)=>{timers.set(++next,{fn,at:now+delay});return next;},cancel:id=>timers.delete(id)});
 async function advance(ms){const end=now+ms;for(;;){const due=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!due||due[1].at>end)break;now=due[1].at;timers.delete(due[0]);due[1].fn();for(let n=0;n<8;n++)await Promise.resolve();}now=end;}
 return {pump,advance,timers};
}
test('attachment capability event interrupts expiry sleep without background route polling',async()=>{
 const {load,fixture}=require('./helpers/attachment.cjs'),r=load('attachmentRouteSelection'),{attachmentWorkDelay}=load('attachmentSchedule');
 const manifest={...fixture(1).manifest,expires:600000};
 const job={owner:manifest.recipient,direction:'incoming',descriptor:{manifest},cursor:0,phase:'queued',next:0};
 let capable=false,finished=false,runs=0;
 const routes=()=>({peers:[manifest.sender],blocks:[],shared:[],bulk:[],uploads:[],bulkRequest:false,directStream:capable});
 const f=clock(async()=>{runs++;if(capable)finished=true;return false;},{nextDelay:()=>finished?Infinity:attachmentWorkDelay([job],0,j=>r.attachmentCanAdvance(j,routes(),0))});
 await f.advance(300000);assert.equal(runs,1,'unusable peer does not keep polling');
 assert.equal(f.pump.diagnostics().nextDeadline,600000);
 capable=true;f.pump.wake();await f.advance(0);assert.equal(runs,2);assert.equal(f.timers.size,0);
 assert.equal(f.pump.diagnostics().nextDeadline,null);f.pump.stop();
});
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
 await f.advance(5000);assert.equal(runs,2);assert.equal(f.pump.snapshot().failures,1);f.pump.stop();release(true);
 await Promise.resolve();await f.advance(60000);f.pump.wake();assert.equal(f.timers.size,0);assert.equal(runs,2);
});
test('quiet media polls back off while still checking at most five minutes later',async()=>{
 let runs=0;const f=clock(async()=>{runs++;},{idleMilliseconds:15000,maximumIdleMilliseconds:300000});
 await f.advance(1800000);assert.equal(runs,10);f.pump.wake();await f.advance(0);assert.equal(runs,11);f.pump.stop();
});
test('event-driven empty queues have no timer, and explicit retry deadlines survive',async()=>{
 let runs=0,delay=Infinity;const f=clock(async()=>{runs++;return false;},{nextDelay:()=>delay});
 await f.advance(3600000);assert.equal(runs,1);assert.equal(f.timers.size,0);
 delay=12000;f.pump.wake();await f.advance(0);assert.equal(runs,2);await f.advance(11999);assert.equal(runs,2);
 delay=Infinity;await f.advance(1);assert.equal(runs,3);assert.equal(f.timers.size,0);f.pump.stop();
});
test('a change while calculating a deadline forces another pass instead of sleeping',async()=>{
 let release,runs=0;const f=clock(async()=>{runs++;return false;},{nextDelay:()=>runs===1?new Promise(r=>release=r):Infinity});
 await f.advance(0);f.pump.wake();release(Infinity);for(let i=0;i<10;i++)await Promise.resolve();await f.advance(0);
 assert.equal(runs,2);assert.equal(f.timers.size,0);f.pump.stop();
});

test('native recovery tick runs overdue work with suspended JS timers, never early or twice',async()=>{
 let now=0,runs=0;const timers=new Map();let id=0;
 const pump=out.createWorkPump({run:async()=>{runs++;},now:()=>now,idleMilliseconds:200,maximumIdleMilliseconds:1000,nextDelay:()=>runs===1?500:Infinity,schedule:(cb,delay)=>{timers.set(++id,cb);return id;},cancel:i=>timers.delete(i)});
 pump.runDue();pump.runDue();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(runs,1);
 now=499;pump.runDue();assert.equal(runs,1);now=500;pump.runDue();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(runs,2);assert.equal(timers.size,0);
 now=100000;pump.runDue();assert.equal(runs,2);pump.wake();pump.stop();pump.runDue();assert.equal(runs,2);
});

test('immediate events during an in-flight checkpoint drain without frame timers',async()=>{
 let release,runs=0,active=0,maximum=0;
 const f=clock(async()=>{runs++;maximum=Math.max(maximum,++active);if(runs===1)await new Promise(r=>release=r);active--;return false;},{nextDelay:()=>Infinity});
 f.pump.wakeNow();f.pump.wakeNow();
 for(let i=0;i<8;i++)await Promise.resolve();assert.equal(runs,1);
 for(let i=0;i<20;i++)f.pump.wakeNow();f.pump.runDue();assert.equal(runs,1);
 release();for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(runs,2);assert.equal(maximum,1);assert.equal(f.timers.size,0);
 assert.equal(f.pump.diagnostics().nextDeadline,null);
 f.pump.wakeNow();f.pump.stop();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(runs,2);
});

test('immediate events interrupt retry deadlines but do not turn retries into polling',async()=>{
 let runs=0;const f=clock(async()=>{runs++;return false;},{nextDelay:()=>5000});
 f.pump.wakeNow();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(runs,1);
 await f.advance(4999);assert.equal(runs,1);
 f.pump.wakeNow();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(runs,2);assert.equal(f.timers.size,1);
 await f.advance(4999);assert.equal(runs,2);await f.advance(1);assert.equal(runs,3);f.pump.stop();
});
