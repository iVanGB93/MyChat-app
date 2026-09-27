const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/services/transports/nearbyTextController.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ missing = false, startError = false, peer = async () => ({id:14,name:'peer'}) } = {}) {
  let context = {userId:18,roomId:'room'}, handler, runtimeDeps, resets=0, losses=0;
  const starts=[], signals=[], sends=[], nativeStops=[];
  const native = { async start(...args){ starts.push(args); if(startError) throw Error('No Wi-Fi'); }, async stop(){nativeStops.push(true);},
    send(frame){signals.push(JSON.parse(frame));return true}, addListener(_name,fn){handler=fn;return {remove(){handler=null}}} };
  const exports={};vm.runInNewContext(code,{exports,Error,require:()=>({createP2pTextRuntime:deps=>{runtimeDeps=deps;return {
    reset(){resets++},signalingLost(){losses++},async handleSignal(f){signals.push(f)},async trySend(m){sends.push(m);return 14}
  }}})});
  const controller=exports.createNearbyTextController({context:()=>context,peer,log(){},createConnection(){},sessionId(){},persist:async()=>true},missing?null:native);
  return {...controller,starts,signals,sends,nativeStops,get deps(){return runtimeDeps},get resets(){return resets},get losses(){return losses},
    event(e){handler?.(e)},getHandler:()=>handler,setContext(c){context=c}};
}
test('LAN discovery is opt-in and unavailable native builds fail clearly',async()=>{
  const f=fixture({missing:true});assert.equal(await f.trySend({id:'m'}),null);
  await assert.rejects(f.start(),/rebuilt Android/);assert.equal(f.getState().enabled,false);
});
test('known direct peer enables local signaling without consulting Axion',async()=>{
  const f=fixture();await f.start();assert.deepEqual(f.starts,[['room',18,14]]);assert.equal(f.deps.signalingReady(),false);
  f.event({type:'peers',count:1});assert.equal(f.deps.signalingReady(),true);
  assert.equal(f.deps.sendSignal({signal_type:'offer'}),true);assert.equal(f.signals[0].signal_type,'offer');
  assert.equal(await f.trySend({id:'m'}),14);await f.stop();assert.equal(f.getState().enabled,false);
  assert.equal(f.deps.sendSignal({signal_type:'offer'}),false);
});
test('Wi-Fi loss cancels peer sessions and late events cannot revive discovery',async()=>{
  const f=fixture();await f.start();const old=f.getHandler();f.event({type:'peers',count:1});
  f.event({type:'stopped',reason:'Wi-Fi disconnected'});old({type:'peers',count:1});
  assert.equal(f.getState().enabled,false);assert.equal(f.getState().peers,0);assert.match(f.getState().message,/disconnected/);
  assert.equal(f.deps.context(),null);assert.equal(await f.trySend({id:'late'}),null);
});
test('stopping while peer lookup is pending cannot start a listener under a stale account',async()=>{
  let resolve;const f=fixture({peer:()=>new Promise(r=>resolve=r)});const start=f.start();
  await new Promise(r=>setImmediate(r));await f.stop();f.setContext({userId:19,roomId:'other'});resolve({id:14,name:'peer'});
  await assert.rejects(start,/not available/);assert.equal(f.starts.length,0);assert.equal(f.getState().enabled,false);
});
test('native startup failure clears listeners and returns a visible failure',async()=>{
  const f=fixture({startError:true});await assert.rejects(f.start(),/No Wi-Fi/);
  assert.equal(f.getState().enabled,false);assert.equal(f.getHandler(),null);assert.match(f.getState().message,/No Wi-Fi/);
});
test('discovery loss invalidates unfinished handshakes and malformed signals are ignored',async()=>{
  const f=fixture();await f.start();f.event({type:'peers',count:1});f.event({type:'peers',count:0});assert.equal(f.losses,1);
  f.event({type:'signal',frame:'bad json'});assert.equal(f.signals.length,0);await f.stop();
});

test('overlapping enable requests allocate only the latest native listener',async()=>{
  const f=fixture();const first=f.start();const second=f.start();
  await assert.rejects(first,/cancelled/);await second;
  assert.equal(f.starts.length,1);await f.stop();
});
