const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('peer introductions cannot replace a configured Internet endpoint with an RTC route',()=>{
 const id=n=>'axonic:1:'+n.toString(16).padStart(64,'0'),offers=[],source={};
 const bootstrap={account:id(2),endpoint:'wss://bootstrap.test/v2/axon'};
 const network={snapshot:()=>({state:'active',account:id(1),introductions:[{account:id(2),via:id(3),expiresAt:60000},{account:id(4),via:id(3),expiresAt:60000}]}),offer:c=>offers.push(c),tick(){},stop(){}};
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
 const network={snapshot:()=>({state,account:state==='active'?own:null,introductions:[{account:peer,via:seed,expiresAt:now+60000}]}),
  attachmentStreamPeer:p=>capable?{account:p,device}:null,offer:c=>{offers.push(c);return true;},tick(){},stop(){}};
 const deps={'./identityNetwork':{createIdentityNetwork:()=>network},'./nativeAxonTransport':{createNativeAxonConnector:()=>()=>{}},'./rtcAxonTransport':{createRtcAxonTransport:()=>({stop(){},canStream:()=>false})}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/lanIdentityRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(source,n=>deps[n]);
 const runtime=source.createLanIdentityRuntime({identity:{subscribe:()=>()=>{}},native:{axonLanStart:()=>new Promise(()=>{}),axonLanStop(){},axonLanSnapshot:()=>({active:true,peers:[{account:peer}]})},now:()=>now,rtc:options.noGuard?{}:{streamCredit:async()=>true},internet:{peers:[{account:seed,endpoint:'wss://seed.test'}],connect(){}}});
 runtime.tick();offers.length=0;
 return {runtime,id,peer,seed,device,offers,advance:n=>now+=n,lock:()=>state='locked'};
}
test('LAN stream promotion is requested on demand over its authenticated peer, not at idle',()=>{
 const f=streamFixture();try{
  f.runtime.tick();assert(!f.offers.some(c=>c.account===f.peer));
  assert(f.runtime.attachmentStreams.request(f.peer,f.device));f.runtime.tick();
  assert(f.offers.some(c=>c.account===f.peer&&c.endpoint==='rtc:'+f.peer));
  f.offers.length=0;f.advance(30001);f.runtime.tick();assert(!f.offers.some(c=>c.account===f.peer));
 }finally{f.runtime.stop();}
});
test('upgrade demand rejects wrong devices, legacy peers, missing native guard and configured AoNs',()=>{
 for(const options of [{},{capable:false},{noGuard:true}]){
  const f=streamFixture(options);try{assert.equal(f.runtime.attachmentStreams.request(f.peer,'wrong'),false);assert.equal(f.runtime.attachmentStreams.request(f.seed,f.device),false);
   if(options.capable===false||options.noGuard)assert.equal(f.runtime.attachmentStreams.request(f.peer,f.device),false);
   f.lock();assert.equal(f.runtime.attachmentStreams.request(f.peer,f.device),false);
  }finally{f.runtime.stop();}
 }
});
test('stream demand is bounded, respects dialing tie break, and is cleared on lock/stop',()=>{
 const f=streamFixture({higher:true});try{
  assert(f.runtime.attachmentStreams.request(f.peer,f.device));f.runtime.tick();assert(!f.offers.some(c=>c.account===f.peer));
  for(let i=10;i<14;i++)assert(f.runtime.attachmentStreams.request(f.id(i),f.device));
  assert.equal(f.runtime.attachmentStreams.request(f.id(14),f.device),false);
  f.lock();f.runtime.tick();f.runtime.stop();assert.equal(f.runtime.attachmentStreams.request(f.peer,f.device),false);
 }finally{f.runtime.stop();}
});
