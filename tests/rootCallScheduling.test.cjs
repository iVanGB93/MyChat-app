const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 const hooks={},seen={ticks:0,relay:0,retry:0};let release;
 const stalled=new Promise(r=>{release=r;});
 const coordinator={ready:async()=>{},tick:async()=>{seen.ticks++;},stop(){},diagnostics(){}};
 const exports={};
 const modules={
  './neuronCallCoordinator':{createNeuronCallCoordinator:d=>(hooks.coordinator=d,coordinator)},
  './callControlRuntime':{createCallControlRuntime:()=>({submit:async()=>true,drain:async()=>0,stop(){}})},
  './callRetryScheduler':{createCallRetryScheduler:d=>(hooks.retry=d,{tick:()=>{seen.retry++;return stalled;},stop(){}})},
  './callRelayPump':{createCallRelayPump:d=>(hooks.relay=d,{tick:async()=>{seen.relay++;},stop(){},diagnostics(){}})},
  './callControlRelay':{createCallControlRelay:()=>({stop(){}}),createCallRelayEndpoint:()=>async()=>null},
  './callMediaRelay':{createCallMediaRelay:()=>async()=>false},
  './identityProtocol':{validAccountId:()=>true},'./neuronIceConfig':{},'./callControlProtocol':{},'./durableCallControl':{},
 };
 const code=ts.transpileModule(fs.readFileSync('src/services/identity/rootAccountCalls.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText;
 new Function('require','exports',code)(name=>{if(!(name in modules))throw Error(name);return modules[name];},exports);
 const historical=[{callId:'old'},{callId:'new'}],pending=[historical[1]];
 const app=exports.createRootAccountCalls({identity:{status:()=>({account:'owner'}),callDevice:()=> 'device'},network:()=>({}),records:{},store:{},list:async()=>historical,listPending:async()=>pending,current:()=>true,now:()=>100,contacts:async()=>[],changed(){}});
 return {app,hooks,seen,release,historical,pending};
}
test('call recovery retains history while direct and relay retries use only pending journals',async()=>{
 const f=fixture();assert.deepEqual(await f.hooks.coordinator.list(),f.historical);
 assert.deepEqual(await f.hooks.retry.list(),f.pending);assert.deepEqual(await f.hooks.relay.list(),f.pending);f.app.stop();f.release();
});
test('a stalled direct send cannot block relay polling or later call-expiry ticks',async()=>{
 const f=fixture();try{
  const first=f.app.tick();await new Promise(r=>setImmediate(r));
  assert.equal(f.seen.relay,1);assert.equal(f.seen.ticks,1);
  const second=f.app.tick();await new Promise(r=>setImmediate(r));
  assert.equal(f.seen.retry,1);assert.equal(f.seen.relay,1);assert.equal(f.seen.ticks,2);
  f.release();await Promise.all([first,second]);
 }finally{f.release();f.app.stop();}
});
