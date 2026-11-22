const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('peer introductions cannot replace a configured Internet endpoint with an RTC route',()=>{
 const id=n=>'axonic:1:'+n.toString(16).padStart(64,'0'),offers=[],source={};
 const bootstrap={account:id(2),endpoint:'wss://bootstrap.test/v2/axon'};
 const network={snapshot:()=>({state:'active',account:id(1),pool:{connections:[{account:id(3),state:'connected'}]},introductions:[{account:id(2),via:id(3),expiresAt:60000},{account:id(4),via:id(3),expiresAt:60000}]}),offer:c=>offers.push(c),tick(){},stop(){}};
 const deps={
  './identityNetwork':{createIdentityNetwork:()=>network},
  './nativeAxonTransport':{createNativeAxonConnector:()=>()=>{}},
  './rtcAxonTransport':{createRtcAxonTransport:()=>({stop(){}})},
 };
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/lanIdentityRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(source,n=>deps[n]);
 const runtime=source.createLanIdentityRuntime({identity:{subscribe:()=>()=>{}},native:{axonLanStart:()=>new Promise(()=>{}),axonLanStop(){},axonLanSnapshot:()=>({peers:[]})},now:()=>1000,rtc:{},internet:{peers:[bootstrap],connect(){}}});
 try{runtime.tick();const latest=new Map(offers.map(c=>[c.account,c]));
  assert.equal(latest.get(id(2)).endpoint,bootstrap.endpoint);
  assert.equal(latest.get(id(4)).endpoint,'rtc:'+id(3),'ordinary introduced peers still use RTC');
 }finally{runtime.stop();}
});

function streamFixture(options={}){
 const id=n=>'axonic:1:'+n.toString(16).padStart(64,'0'),device='ab'.repeat(32),offers=[],source={};let now=1000,state='active';
 const own=id(options.higher?9:1),peer=id(4),seed=id(2),capable=options.capable!==false;
 let ticks=0,snapshots=0;
 const network={snapshot:()=>({state,account:state==='active'?own:null,pool:{connections:[{account:seed,state:'connected'}]},introductions:[{account:peer,via:seed,expiresAt:now+60000}]}),
  attachmentStreamPeer:p=>capable?{account:p,device}:null,offer:c=>{offers.push(c);return true;},nextDeadline:()=>Infinity,tick(){ticks++;},stop(){}};
 const deps={'./identityNetwork':{createIdentityNetwork:()=>network},'./nativeAxonTransport':{createNativeAxonConnector:()=>()=>{}},'./rtcAxonTransport':{createRtcAxonTransport:()=>({stop(){},canStream:()=>false})}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/lanIdentityRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(source,n=>deps[n]);
 let lanStarts=0;
 const runtime=source.createLanIdentityRuntime({recoveryPeers:options.recoveryPeers,foregroundStartup:options.foregroundStartup,remembered:options.remembered,identity:{subscribe:()=>()=>{}},native:{axonLanStart:()=>{lanStarts++;return options.readyLan?Promise.resolve():new Promise(()=>{});},axonAccept:()=>new Promise(()=>{}),axonLanStop(){},axonLanSnapshot:()=>{snapshots++;return {active:true,peers:[{account:peer,host:'10.0.0.2',port:12345}]};}},now:()=>now,rtc:options.noGuard?{}:{streamCredit:async()=>true},internet:{peers:[{account:seed,endpoint:'wss://seed.test',preferredBootstrap:true},...(options.extraSeeds??[])],connect(){}}});
 runtime.tick();offers.length=0;
 return {runtime,id,peer,seed,device,offers,lanStarts:()=>lanStarts,counts:()=>({ticks,snapshots}),advance:n=>now+=n,lock:()=>state='locked'};
}
test('foreground discovery batches native LAN and Internet candidates in one pool pass',async()=>{
 const f=streamFixture({readyLan:true});
 try{
  await new Promise(setImmediate);
  const before=f.counts();
  f.runtime.tick();
  assert.deepEqual(f.counts(),{ticks:before.ticks+1,snapshots:before.snapshots+1});
  assert.deepEqual(f.offers.map(c=>c.route),['internet','lan']);
 }finally{f.runtime.stop();}
});
test('headless recovery offers only requested configured peers until normal routing resumes',()=>{
 const other='axonic:1:'+'8'.repeat(64);
 let scope=new Set([other]);
 const f=streamFixture({recoveryPeers:()=>scope,extraSeeds:[{account:other,endpoint:'wss://other.test'}],remembered:()=>[{account:'remembered',expiresAt:60000}]});
 try{
  f.runtime.tick();assert.deepEqual(f.offers.map(c=>c.account),[other]);assert.equal(f.lanStarts(),0);
  scope.add(f.seed);f.offers.length=0;f.runtime.tick();assert.deepEqual(f.offers.map(c=>c.account),[f.seed,other]);
  scope=undefined;f.offers.length=0;f.runtime.tick();assert.equal(f.lanStarts(),1);assert(f.offers.some(c=>c.account==='remembered'));
 }finally{f.runtime.stop();}
});
test('LAN stream promotion is requested on demand over its authenticated peer, not at idle',()=>{
 const f=streamFixture();try{
  f.runtime.tick();assert(!f.offers.some(c=>c.account===f.peer));
  assert(f.runtime.attachmentStreams.request(f.peer,f.device));f.runtime.tick();
  assert(f.offers.some(c=>c.account===f.peer&&c.endpoint==='rtc:'+f.peer));
  f.offers.length=0;f.advance(30001);f.runtime.tick();assert(!f.offers.some(c=>c.account===f.peer));
 }finally{f.runtime.stop();}
});
test('upgrade demand rejects wrong devices, legacy peers and missing native guard',()=>{
 for(const options of [{},{capable:false},{noGuard:true}]){
  const f=streamFixture(options);try{assert.equal(f.runtime.attachmentStreams.request(f.peer,'wrong'),false);
   assert.equal(f.runtime.attachmentStreams.request(f.seed,f.device),options.capable!==false&&!options.noGuard);
   if(options.capable===false||options.noGuard)assert.equal(f.runtime.attachmentStreams.request(f.peer,f.device),false);
   f.lock();assert.equal(f.runtime.attachmentStreams.request(f.peer,f.device),false);
  }finally{f.runtime.stop();}
 }
});

test('explicit stream-capable bootstrap peer can upgrade on demand, never from an introduction alone',()=>{
 const f=streamFixture();try{
  assert(f.runtime.attachmentStreams.request(f.seed,f.device));f.runtime.tick();
  assert(f.offers.some(c=>c.account===f.seed&&c.endpoint==='rtc:'+f.seed));
 }finally{f.runtime.stop();}
});
test('stream demand is bounded, respects dialing tie break, and is cleared on lock/stop',()=>{
 const f=streamFixture({higher:true});try{
  assert(f.runtime.attachmentStreams.request(f.peer,f.device));f.runtime.tick();assert(!f.offers.some(c=>c.account===f.peer));
  for(let i=10;i<14;i++)assert(f.runtime.attachmentStreams.request(f.id(i),f.device));
  assert.equal(f.runtime.attachmentStreams.request(f.id(14),f.device),false);
  f.lock();f.runtime.tick();f.runtime.stop();assert.equal(f.runtime.attachmentStreams.request(f.peer,f.device),false);
 }finally{f.runtime.stop();}
});

test('foreground startup waits on the saved bootstrap, then expands on chat readiness',()=>{
 const f=streamFixture({foregroundStartup:true,extraSeeds:[{account:'secondary',endpoint:'wss://other.test'}]});
 try{
  f.runtime.tick();assert.deepEqual(f.offers.map(candidate=>candidate.account),[f.seed]);assert.equal(f.lanStarts(),0);
  f.offers.length=0;f.runtime.finishStartup();f.runtime.tick();
  assert(f.offers.some(candidate=>candidate.account==='secondary'));assert.equal(f.lanStarts(),1);
 }finally{f.runtime.stop();}
});
test('foreground startup expands at the five-second deadline even if chat or bootstrap is unavailable',()=>{
 const f=streamFixture({foregroundStartup:true,extraSeeds:[{account:'secondary',endpoint:'wss://other.test'}]});
 try{
  assert.equal(f.runtime.nextDeadline(),6000);
  f.advance(4999);f.runtime.tick();
  assert.deepEqual(f.offers.map(candidate=>candidate.account),[f.seed]);assert.equal(f.lanStarts(),0);
  f.offers.length=0;f.advance(1);f.runtime.tick();
  assert(f.offers.some(candidate=>candidate.account==='secondary'));assert.equal(f.lanStarts(),1);
 }finally{f.runtime.stop();}
});
