const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let d,call=null,recording=false,ringStarts=0,ringStops=0;const exports={};
 const deps={'./messageSounds':{startMessageSounds:()=>()=>{}},'../services/ringerService':{startRingerModeListener:()=>ringStarts++,stopRingerModeListener:()=>ringStops++},'react-native':{Platform:{OS:'android'},AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Linking:{addEventListener:()=>({remove(){}}),getInitialURL:async()=>null}},'@react-native-async-storage/async-storage':{default:{getItem:async()=>null,setItem:async()=>{}}},'../../modules/axonic-app-update':{observePlayInstallState:()=>({remove(){}})},'../services/playUpdates':{createPlayUpdates:input=>{d=input;return {subscribe:()=>()=>{},check:async()=>{},snapshot:()=>({status:'idle'})};}},'./neuronRuntime':{localAccountCalls:()=>({snapshot:()=>call})},'../services/identity/rootVoiceRecorder':{rootVoiceRecordingActive:()=>recording},'../services/identity/identityLinks':{queueIdentityLink:()=>{}}};
 new Function('exports','require','__DEV__','setInterval','clearInterval',ts.transpileModule(fs.readFileSync('src/composition/appMaintenance.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(exports,n=>deps[n],false,()=>1,()=>{});
 return {ring:()=>[ringStarts,ringStops],d,api:exports,call:v=>call=v,record:v=>recording=v};
}
test('maintenance prevents update prompts after root cleanup and handles repeated cleanup',()=>{const f=fixture();assert.equal(f.d.foreground(),false);const stop=f.api.startAppMaintenance();assert.equal(f.d.foreground(),true);stop();stop();assert.equal(f.d.foreground(),false);const next=f.api.startAppMaintenance();assert.equal(f.d.foreground(),true);next();});
test('only active calls and recordings prevent an update restart',async()=>{
 const f=fixture();
 assert.equal(await f.d.safeToRestart(),true);
 f.call({status:'ringing'});assert.equal(await f.d.safeToRestart(),false);
 f.call({status:'ended'});assert.equal(await f.d.safeToRestart(),true);
 f.record(true);assert.equal(await f.d.safeToRestart(),false);
 f.record(false);assert.equal(await f.d.safeToRestart(),true);
});

test('ringer subscription has one owner across overlapping maintenance leases',()=>{
 const f=fixture(),a=f.api.startAppMaintenance(),b=f.api.startAppMaintenance();assert.deepEqual(f.ring(),[1,0]);a();assert.deepEqual(f.ring(),[1,0]);b();b();assert.deepEqual(f.ring(),[1,1]);
});

