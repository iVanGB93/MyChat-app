const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function compile(name,requireFn=()=>{throw Error('Unexpected import')}){
 const out={};new Function('require','exports','__DEV__',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(requireFn,out,true);return out;
}
const {observeIdentityForeground}=compile('identityForeground');
function fixture(initial='active'){
 let state='unlocked',app=initial,locks=0;const identityListeners=new Set(),appListeners=new Set();
 const identity={status:()=>({state}),lock(){locks++;state='locked';for(const f of identityListeners)f();},subscribe(f){identityListeners.add(f);return()=>identityListeners.delete(f);}};
 return {identity,identityListeners,appListeners,locks:()=>locks,state:()=>state,
   unlock(){state='unlocked';for(const f of identityListeners)f();},
   app(next){app=next;for(const f of appListeners)f(next);},
   deps:{identity,currentState:()=>app,subscribeState:f=>{appListeners.add(f);return()=>appListeners.delete(f);}}};
}
test('foreground ownership survives screen observers; background locks and foreground never silently unlocks',()=>{
 const f=fixture(),stop=observeIdentityForeground(f.deps);
 const stopScreen=f.identity.subscribe(()=>{});stopScreen();assert.equal(f.state(),'unlocked');assert.equal(f.locks(),0);
 f.app('background');assert.equal(f.state(),'locked');f.app('active');assert.equal(f.state(),'locked');
 f.unlock();assert.equal(f.state(),'unlocked');stop();stop();assert.equal(f.locks(),2);
 assert.equal(f.identityListeners.size,0);assert.equal(f.appListeners.size,0);
});
test('unknown/background startup and late unlock fail closed without recursive lock loops',()=>{
 for(const initial of [null,'background','inactive']){
  const f=fixture(initial),stop=observeIdentityForeground(f.deps);assert.equal(f.state(),'locked');
  f.unlock();assert.equal(f.state(),'locked');assert.equal(f.locks(),2);stop();
 }
});
for(const guardVersion of [undefined,1]) test(`app owners share one pool; RTC requires native guard (${guardVersion})`,async()=>{
 const f=fixture();f.identity.status=()=>({state:f.state(),account:'axonic:1:'+'aa'.repeat(32)});let starts=0,stops=0,options,configuration;
 const native={axonConnect(){},axonRead(){},axonWrite(){},axonClose(){},axonLanStart(){},axonLanStop(){},axonLanSnapshot(){},axonAccept(){},axonClaim(){}};
 const m=compile('mobileIdentityNetwork',name=>({
   '../../../modules/axonic-nearby':{default:native},
   'react-native-webrtc':{RTCPeerConnection:class{constructor(c){configuration=c;}}},
   'react-native':{Platform:{OS:'android'},NativeModules:{WebRTCModule:{axonicIdentityGuardVersion:guardVersion?()=>guardVersion:undefined}},AppState:{currentState:'active',addEventListener:(_event,fn)=>{f.appListeners.add(fn);return{remove:()=>f.appListeners.delete(fn)};}}},
   './localIdentity':{localIdentity:f.identity},
   '../allowedAxons':{allowedAxons:()=>5,subscribeAllowedAxons:()=>()=>{},loadAllowedAxons:async()=>{}},
   './custodyCourier':{createCustodyCourier:()=>({deposit:async()=>{},tick:async()=>{},invalidate(){},stop(){}})},
   './ownCustodyStore':{createOwnCustodyStore:()=>({get:async()=>null,clear:async()=>{}})},
   './custodyService':{createCustodyService:()=>({receive:async()=>'',sweep:async()=>{}})},
   './mobileCustodyStore':{createMobileCustodyStore:()=>({})},
   './testMessageStore':{createTestMessageStore:()=>({list:async()=>[]})},
   './testMessageQueue':{createTestMessageQueue:d=>({receive:async m=>d.allowed(m.from),enqueue:async()=>null,tick:async()=>{},invalidate(){},stop(){}})},
   './identityProtocol':{validAccountId:id=>/^axonic:1:[0-9a-f]{64}$/.test(id)},
   './identityRecordStore':{createMobileIdentityRecordStore:()=>({})},
   './lanIdentityRuntime':{createLanIdentityRuntime:d=>{options=d;starts++;return{tick(){},snapshot:()=>({state:'active'}),stop(){stops++;}};}},
   './mobileAxonTransport':{mobileAxonTransportSupported:()=>true},
   './internetAxonTransport':{},'./identityForeground':{observeIdentityForeground},
 })[name]);
 assert.equal(m.mobileIdentityNetworkSnapshot(),null);const a=m.startMobileIdentityNetwork(),b=m.startMobileIdentityNetwork();
 assert.equal(!!options.rtc,guardVersion===1);
 const message={from:'axonic:1:'+'ab'.repeat(32),id:'cd'.repeat(32),text:'local development probe'};
 assert.equal(await options.onTestMessage(message),false);
 assert.equal(m.allowMobileIdentityTestPeer(message.from),true);
 assert.equal(await options.onTestMessage(message),true);
 assert.equal((await m.mobileIdentityTestInbox()).length,0);
 if(guardVersion===1){options.rtc.createConnection();assert.equal(configuration.axonicIdentityGuard,true);}
 assert.equal(starts,1);assert.equal(m.mobileIdentityNetworkSnapshot().state,'active');a();a();assert.equal(stops,0);
 b();assert.equal(stops,1);assert.equal(m.mobileIdentityNetworkSnapshot(),null);assert.equal(f.state(),'locked');
 assert.deepEqual(await m.mobileIdentityTestInbox(),[]);
});

