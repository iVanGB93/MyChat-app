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
