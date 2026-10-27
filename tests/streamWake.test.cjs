const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');const {createStreamWake}=load('streamWake');

test('native clock advances background burst and idle waits while JS timers are suspended',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[];
 const wake=createStreamWake(ms=>new Promise(resolve=>calls.push({ms,resolve})));
 let done=0;const burst=wake.wait().then(()=>done++);assert.equal(calls[0].ms,0);
 calls[0].resolve();await burst;assert.equal(done,1);
 const idle=wake.wait(true).then(()=>done++);assert.equal(calls[1].ms,100);
 calls[1].resolve();await idle;assert.equal(done,2);
});

test('late native timeout cannot consume a newer stream signal',async()=>{
 const clocks=[],wake=createStreamWake(()=>new Promise(resolve=>clocks.push(resolve)));
 const first=wake.wait(true);wake.signal();await first;
 wake.signal();clocks[0]();await Promise.resolve();
 await wake.wait(true);assert.equal(clocks.length,1);
});
test('ack before an idle wait is consumed without the 100ms safety delay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const wake=createStreamWake();wake.signal();let done=false;wake.wait(true).then(()=>done=true);await Promise.resolve();await Promise.resolve();assert.equal(done,true);
});
test('idle waits coalesce signals and retain the safety timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const wake=createStreamWake();let count=0;
 wake.signal();wake.signal();const first=wake.wait(true).then(()=>count++);await first;assert.equal(count,1);
 const second=wake.wait(true).then(()=>count++);t.mock.timers.tick(99);await Promise.resolve();assert.equal(count,1);t.mock.timers.tick(1);await second;assert.equal(count,2);
});
test('burst yields are not skipped and do not swallow a pending acknowledgment',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const wake=createStreamWake();wake.signal();let yielded=false;const burst=wake.wait(false).then(()=>yielded=true);await Promise.resolve();assert.equal(yielded,false);t.mock.timers.tick(0);await burst;
 let resumed=false;wake.wait(true).then(()=>resumed=true);await Promise.resolve();await Promise.resolve();assert.equal(resumed,true);
});
