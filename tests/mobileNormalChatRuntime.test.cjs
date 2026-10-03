const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');

function fixture(t,dev=true,flag='1'){
 const room='22222222-2222-4222-8222-222222222222',account='axonic:1:'+'a1'.repeat(32),peerAccount='axonic:1:'+'b1'.repeat(32);
 let state={user:{id:14},appLifecycle:'active',blockedIds:{}},lease=true,config,networkConfig,registration=null,stops=0,directoryStops=0,timer;
 let rooms=[{id:room,room_type:'direct',members:[14,18]}],pin=peerAccount;
 let row={id:'11111111-1111-4111-8111-111111111111',room_id:room,sender_id:14,content:'Own text',created_at:new Date().toISOString(),
  is_mine:true,is_deleted:false,type:'text',status:'pending',reply_to:null,duration_ms:null,file_uri:null};
 const identity={status:()=>({state:'unlocked',account}),signSignal(){},callDevice:()=>null};
 const noop=()=>{},native={axonLanStart:noop,axonLanStop:noop,axonLanSnapshot:noop,axonAccept:noop,axonClaim:noop};
 const mocks={ './neuronCallFeature':{neuronCallsEnabled:()=>false}, './accountIdentityActivity':{accountIdentityMayRun:s=>s.appLifecycle==='active'},
  // This fixture exercises the normal-text runtime with the call feature disabled.
  './neuronIceConfig':{},'./callMediaRelay':{},'./mobileCallWake':{},'./durableCallControl':{},
  './callControlProtocol':{},'./callControlRelay':{},'./callRelayPump':{},'./mobileCallControlRuntime':{},
  './mobileCallJournalStore':{},'./neuronCallCoordinator':{},'./mobileNeuronCalls':{},'./callRetryScheduler':{},
  '@noble/hashes/utils.js':{hexToBytes:()=>new Uint8Array()}, './mobilePushRegistration':{startMobilePushRegistration:()=>({tick(){},stop(){}}),rejectPushRegistration:async()=>null},
  './identityDirectoryLookup':{unavailableDirectoryLookup:()=>({status:'unavailable'})},
  './mobileDirectory':{createMobileDirectory:()=>({receive:async()=>'{"status":"rejected"}',tick:async()=>{},snapshot:()=>({confirmed:0,target:3}),stop(){directoryStops++;}})},
  'react-native':{NativeModules:{},Platform:{OS:'android'}},'react-native-webrtc':{RTCPeerConnection:class{}},
  '../../../modules/axonic-nearby':{default:native},'../../store/appStore':{useAppStore:{getState:()=>state}},
  '../allowedAxons':{allowedAxons:()=>5,loadAllowedAxons:async()=>{},subscribeAllowedAxons:()=>noop},
  '../localMessageStore':{getCachedRooms:async()=>rooms,getMessagesByIds:async()=>[row],getPendingOutbox:async()=>[row]},
  '../ingressRouter':{ingestVerifiedNeuronText:async(_m,owner,_name,guard)=>owner===14&&guard()},
  '../transports/p2pTextBridge':{acceptMailboxDelivered:async(owner,_m,_peer,guard)=>owner===14&&guard()},
  '../transports/neuronTextBridge':{registerNeuronTextAttempt:attempt=>{registration=attempt;return()=>{registration=null;}}},
  './chatIdentityPinStore':{createChatIdentityPinStore:()=>({read:async()=>pin})},
  './identityRecordStore':{createMobileIdentityRecordStore:()=>({})},'./ownCustodyStore':{createOwnCustodyStore:()=>({})},
  './normalChatOutboxStore':{createNormalChatOutboxStore:()=>({})},'./mobileCustodyStore':{createMobileCustodyStore:()=>({})},
  './normalChatRuntime':{createNormalChatRuntime:d=>{config=d;d.network({});return {attempt:async()=>null,tick(){},stop(){stops++;}};}},
  './lanIdentityRuntime':{createLanIdentityRuntime:d=>{networkConfig=d;return {setLimit(){}};}},
  './internetAxonTransport':{},'./mobileAxonTransport':{mobileAxonTransportSupported:()=>true},
 };
 const out={};new Function('require','exports','__DEV__','process','setInterval','clearInterval',
  ts.transpileModule(fs.readFileSync('src/services/identity/mobileNormalChatRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(
  p=>{if(!mocks[p])throw Error(`Unexpected dependency ${p}`);return mocks[p];},out,dev,{env:{EXPO_PUBLIC_AXONIC_CHAT_IDENTITY:flag}},
  f=>{timer=f;return 1;},()=>{timer=null;});
 const stop=out.startMobileNormalChatRuntime(14,identity,()=>lease);t.after(stop);
 return {directoryStops:()=>directoryStops,room,account,peerAccount,config,networkConfig,stop,registration:()=>registration,timer:()=>timer,
  change:p=>{state={...state,...p};},rooms:v=>{rooms=v;},pin:v=>{pin=v;},edit:p=>{row={...row,...p};},invalidate:()=>{lease=false;}};
}

test('mobile account runtime uses verified room pins, respects blocks, and detaches on account cleanup',async t=>{
 const f=fixture(t),peer={user:18,account:f.peerAccount};
 assert.equal(f.networkConfig.limit,5);assert.equal(typeof f.registration(),'function');
 assert.deepEqual(await f.config.boundary.peer(f.room),peer);
 assert.equal(f.config.allowed(f.peerAccount),true);assert.equal(f.config.allowed('untrusted neuron'),false);
 f.change({blockedIds:{18:true}});assert.equal(f.config.allowed(f.peerAccount),false);
 assert.equal(f.config.boundary.authorized(f.room,peer),false);assert.equal(await f.config.boundary.peer(f.room),null);
 f.change({blockedIds:{}});f.pin(null);assert.equal(await f.config.boundary.peer(f.room),null);
 f.pin(f.peerAccount);assert.deepEqual(await f.config.boundary.peer(f.room),peer);
 f.rooms([]);assert.equal(await f.config.boundary.peer(f.room),null);
 f.change({user:{id:18}});assert.equal(f.config.boundary.current(),false);
 f.stop();assert.equal(f.directoryStops(),1);assert.equal(f.registration(),null);assert.equal(f.timer(),null);
});

test('release account runtime requires an explicit feature flag and stays account-scoped',async t=>{
 const disabled=fixture(t,false,'0');assert.equal(disabled.registration(),null);assert.equal(disabled.config,undefined);
 const missing=fixture(t,false,'');assert.equal(missing.registration(),null);
 const enabled=fixture(t,false,'1');assert.equal(typeof enabled.registration(),'function');
 enabled.change({appLifecycle:'background'});assert.equal(enabled.config.boundary.current(),false);
 assert.deepEqual(await enabled.config.pending(),[]);
});

test('mobile retry scan and original-row reads exclude edits, other owners and unsupported messages',async t=>{
 const f=fixture(t);
 assert.equal((await f.config.pending()).length,1);
 f.edit({revision:1});assert.deepEqual(await f.config.pending(),[]);assert.equal(await f.config.boundary.readOutgoing('id'),null);
 f.edit({revision:0,reply_to:{id:'reply'}});assert.deepEqual(await f.config.pending(),[]);
 f.edit({reply_to:null,status:'delivered'});assert.deepEqual(await f.config.pending(),[]);
 f.edit({status:'pending',sender_id:18});assert.equal(await f.config.boundary.readOutgoing('id'),null);
 f.edit({sender_id:14});f.invalidate();assert.deepEqual(await f.config.pending(),[]);
});
