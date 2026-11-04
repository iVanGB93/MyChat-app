const test=require('node:test'),assert=require('node:assert/strict');
const {createEventDeadlineTask}=require('./helpers/attachment.cjs').load('eventDeadlineTask');
function fixture(run){let now=0,id=0;const timers=new Map();const task=createEventDeadlineTask({immediateEvents:true,now:()=>now,run:()=>run(now),schedule:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},cancel:id=>timers.delete(id)});return {task,timers,async advance(ms=0){now+=ms;const due=[...timers].filter(([,t])=>t.at<=now);for(const [id,t]of due){timers.delete(id);t.fn();}await new Promise(setImmediate);}};}
test('coalesces events and has no idle timer after successful work',async()=>{let calls=0;const f=fixture(async()=>{calls++;});for(let i=0;i<100;i++)f.task.changed();assert.equal(f.timers.size,0);await f.advance();assert.equal(calls,1);assert.equal(f.timers.size,0);await f.advance(3600000);assert.equal(calls,1);});
test('event during unfinished work survives the old result',async()=>{let release,calls=0;const f=fixture(async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return 100000;});f.task.changed();await f.advance();f.task.changed();release();await new Promise(setImmediate);await f.advance();assert.equal(calls,2);assert.equal(f.timers.size,1);f.task.stop();assert.equal(f.timers.size,0);});
test('failure retries at a deadline and a new event advances it',async()=>{let calls=0;const f=fixture(async()=>{if(++calls===1)throw Error('temporary');});f.task.changed();await f.advance();await f.advance(4999);assert.equal(calls,1);f.task.changed();await f.advance();assert.equal(calls,2);assert.equal(f.timers.size,0);});
test('stop while running prevents late completion from scheduling anything',async()=>{let release;const f=fixture(async()=>{await new Promise(r=>release=r);return 1;});f.task.changed();await f.advance();f.task.changed();f.task.stop();release();await new Promise(setImmediate);assert.equal(f.timers.size,0);});
test('background clock invokes only overdue tasks and never scans idle workers',async()=>{let calls=0;const f=fixture(async()=>{calls++;return calls===1?5000:Infinity;});f.task.changed();await f.advance();for(let i=0;i<1000;i++)f.task.runDue();assert.equal(calls,1);await f.advance(5000);assert.equal(calls,2);for(let i=0;i<1000;i++)f.task.runDue();assert.equal(calls,2);});


test('events and changes during work dispatch while all frame timers are suspended',async()=>{
 let calls=0,release;const f=fixture(async()=>{if(++calls===1)await new Promise(r=>release=r);return Infinity;});
 for(let i=0;i<100;i++)f.task.changed();await new Promise(setImmediate);
 assert.equal(calls,1);assert.equal(f.timers.size,0);
 for(let i=0;i<100;i++)f.task.changed();release();await new Promise(setImmediate);
 assert.equal(calls,2);assert.equal(f.timers.size,0);
 f.task.changed();f.task.stop();await new Promise(setImmediate);assert.equal(calls,2);
});
test('failed event work retains a real retry deadline without an immediate spin',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('offline');});f.task.changed();await new Promise(setImmediate);
 assert.equal(calls,1);assert.equal(f.timers.size,1);await f.advance(4999);assert.equal(calls,1);
 await f.advance(1);assert.equal(calls,2);f.task.stop();assert.equal(f.timers.size,0);
});

test('self-generated events yield to I/O after a bounded burst instead of starving the event loop',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;f.task.changed();});f.task.changed();await new Promise(setImmediate);
 assert.equal(calls,8);assert.equal(f.timers.size,1);assert.equal(f.task.diagnostics().dirty,true);
 f.task.runDue();await new Promise(setImmediate);assert(calls>8&&calls<=17);
 f.task.stop();const stopped=calls;await f.advance(10000);assert.equal(calls,stopped);
});
