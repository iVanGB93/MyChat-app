const test=require('node:test'),assert=require('node:assert/strict');
const {createCallRecovery}=require('../src/services/callRecovery.ts');
function fixture(outgoing=true){let now=0,id=0,restarts=0,ended=0;const timers=new Map(),changes=[];
 const recovery=createCallRecovery({outgoing,restart:async()=>{restarts++;},ended:()=>ended++,recovering:v=>changes.push(v),schedule:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},cancel:id=>timers.delete(id)});
 return {recovery,changes,timers,counts:()=>({restarts,ended}),async advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await Promise.resolve();await Promise.resolve();}};
}
test('temporary disconnect recovers without ending call or restarting ICE',async()=>{const f=fixture();f.recovery.state('disconnected');await f.advance(2000);f.recovery.state('connected');await f.advance(30000);assert.deepEqual(f.counts(),{restarts:0,ended:0});assert.deepEqual(f.changes,[true,false]);assert.equal(f.timers.size,0);});
test('failure restarts once, repeated events cannot extend deadline, and ends once',async()=>{const f=fixture();f.recovery.state('failed');await f.advance(1000);f.recovery.state('failed');await f.advance(33000);assert.deepEqual(f.counts(),{restarts:1,ended:0});f.recovery.state('disconnected');await f.advance(1000);await f.advance(30000);assert.deepEqual(f.counts(),{restarts:1,ended:1});});
test('callee waits for caller restart and successful recovery permits a later episode',async()=>{const f=fixture(false);f.recovery.state('failed');await f.advance(6000);assert.equal(f.counts().restarts,0);f.recovery.state('completed');await f.advance(30000);assert.equal(f.counts().ended,0);f.recovery.state('disconnected');await f.advance(35000);assert.equal(f.counts().ended,1);});
test('hangup cancels all recovery work and ignores late state callbacks',async()=>{const f=fixture();f.recovery.state('disconnected');f.recovery.stop();await f.advance(30000);f.recovery.state('failed');assert.deepEqual(f.counts(),{restarts:0,ended:0});assert.equal(f.timers.size,0);});

test('hangup before a queued restart prevents the restart itself',async()=>{const f=fixture();f.recovery.state('failed');f.recovery.stop();await f.advance(30000);assert.deepEqual(f.counts(),{restarts:0,ended:0});});
