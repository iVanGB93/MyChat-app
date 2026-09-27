const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/services/transports/nearbyRecovery.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const settle = () => new Promise(r => setImmediate(r));
function fixture(automatic = false) {
  let context = {userId:27,roomId:'room'}, state = {enabled:false,peers:0,message:'off'}, listener;
  let starts=0, retries=0, fail=false, blockRecovery;
  const timers=new Map(); let id=0;
  const controller={getState:()=>state,subscribe(fn){listener=fn;},trySend:async()=>null,
    async start(){starts++;if(fail)throw Error('No Wi-Fi');state={enabled:true,peers:1,message:'found'};listener();},
    async stop(){state={enabled:false,peers:0,message:'off'};listener();}};
  const exports={};vm.runInNewContext(code,{exports,setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
  const recovery=exports.createNearbyRecovery(controller,{automatic,context:()=>context,recover:async(_scope,current)=>{
    if(blockRecovery)await blockRecovery;if(current())retries++;
  }});
  return {...recovery,controller,timers,get starts(){return starts},get retries(){return retries},
    context(v){context=v},fail(v){fail=v},block(p){blockRecovery=p},
    async tick(){const item=timers.entries().next().value;assert.ok(item,'expected scheduled recovery');timers.delete(item[0]);item[1].fn();await settle();}};
}
test('only an opted-in chat resumes after backgrounding or room navigation',async()=>{
  const f=fixture();f.refresh();await settle();assert.equal(f.timers.size,0);
  await f.start();f.context(null);f.refresh();await settle();assert.equal(f.getState().enabled,false);
  assert.equal(f.getState().requested,true);assert.equal(f.timers.size,0);
  f.context({userId:27,roomId:'other'});f.refresh();await settle();assert.equal(f.timers.size,0);
  f.context({userId:27,roomId:'room'});f.refresh();await settle();await f.tick();
  assert.equal(f.starts,2);assert.equal(f.retries,1);
});
test('Wi-Fi failure retries with bounded backoff and Stop cancels consent',async()=>{
  const f=fixture();await f.start();await f.controller.stop();f.fail(true);
  for(let i=0;i<7;i++)await f.tick();
  assert.ok([...f.timers.values()].every(t=>t.ms<=30000));
  f.fail(false);await f.tick();assert.equal(f.getState().enabled,true);
  await f.stop();assert.equal(f.getState().requested,false);assert.equal(f.timers.size,0);
  f.refresh();await settle();assert.equal(f.timers.size,0);
});
test('account mismatch cannot resume or flush the previous account',async()=>{
  const f=fixture();await f.start();f.context({userId:22,roomId:'room'});f.refresh();await settle();
  assert.equal(f.timers.size,0);assert.equal(f.retries,0);await f.stop();
});
test('in-flight recovery is single flight and cancelled by a pause',async()=>{
  const f=fixture();let finish;f.block(new Promise(r=>finish=r));await f.start();await f.tick();
  assert.equal(f.timers.size,0);f.context(null);f.refresh();await settle();finish();await settle();
  assert.equal(f.retries,0);assert.equal(f.timers.size,0);
});
test('initial enable failure does not leave automatic retries behind',async()=>{
  const f=fixture();f.fail(true);await assert.rejects(f.start(),/No Wi-Fi/);
  assert.equal(f.getState().requested,false);assert.equal(f.timers.size,0);
});

test('automatic discovery starts without opt-in and follows foreground chats',async()=>{
  const f=fixture(true);f.refresh();await settle();await f.tick();
  assert.equal(f.starts,1);assert.equal(f.getState().enabled,true);
  f.context(null);f.refresh();await settle();
  assert.equal(f.getState().enabled,false);assert.equal(f.timers.size,0);
  f.context({userId:27,roomId:'other'});f.refresh();await settle();await f.tick();
  assert.equal(f.starts,2);assert.equal(f.retries,2);
});

test('automatic startup retries missing Wi-Fi without user action',async()=>{
  const f=fixture(true);f.fail(true);f.refresh();await settle();
  for(let i=0;i<7;i++)await f.tick();
  assert.equal(f.getState().enabled,false);assert.equal(f.getState().requested,true);
  assert.ok([...f.timers.values()].every(t=>t.ms<=30000));
  f.fail(false);await f.tick();assert.equal(f.getState().enabled,true);
});

test('automatic account changes cancel old recovery before starting a new scope',async()=>{
  const f=fixture(true);let finish;f.block(new Promise(r=>finish=r));
  f.refresh();await settle();await f.tick();
  f.context({userId:22,roomId:'new-room'});f.refresh();await settle();
  finish();await settle();assert.equal(f.retries,0);
  f.block(null);await f.tick();assert.equal(f.retries,1);assert.equal(f.starts,2);
  f.context(null);f.refresh();await settle();assert.equal(f.timers.size,0);
});
