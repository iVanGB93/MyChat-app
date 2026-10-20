const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(read,status='ended'){
 const effects=[],timers=[],timeouts=[],cleared=[],updates=[],call={id:'call',peerUser:'axonic:1:'+'a'.repeat(64),peerName:'peer',status,outgoing:true,media:'voice'};let count=0;
 const react={useState:initial=>[count++===0?call:initial,value=>updates.push(value)],useRef:value=>({current:value}),useEffect:effect=>effects.push(effect),useCallback:fn=>fn,createElement:()=>null};
 const imports={'../../services/identity/rootCallNotificationAction':{subscribeRootCallNotificationAction:()=>()=>{},takeRootCallNotificationAction:async()=>null},'../../hooks/useRingingCameraPreview':{default:()=>null},react:{default:react,...react},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'../../modules/messaging/notifications':{subscribeRootCallNotificationAction:()=>()=>{},takeRootCallNotificationAction:async()=>null},'../../services/soundService':{stopLooping:()=>{}},'./CallStage':{},'./IncomingCallAppearance':{},'../../modules/messaging':{conversations:()=>({snapshot:read}),subscribeLocalAccountCalls:()=>()=>{}},'../../modules/storage':{subscribeOwnChatWrites:fn=>{timers.push(fn);return ()=>{};},readSharedAvatar:async()=>null,subscribeSharedAvatars:()=>()=>{}},'../../modules/identity':{localAccount:{status:()=>({account:null})},shortIdentity:peer=>peer.replace('axonic:1:','axon')},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../services/identity/localAccountNetwork':{subscribeLocalAccountCalls:()=>()=>{}}};
 const out={};new Function('exports','require','setInterval','clearInterval','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync('src/screens/calls/RootAccountCallScreen.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,name=>imports[name]??{},fn=>{timers.push(fn);return timers.length;},()=>{},(fn,delay)=>{timeouts.push({fn,delay});return timeouts.length;},id=>cleared.push(id));
 out.default();return {effects,timers,timeouts,cleared,updates,call,imports};
}
test('finding is silent; caller ringback starts only in confirmed ringing state',async()=>{
 for(const status of ['finding','ringing','connecting']){
  const f=fixture(()=>Promise.resolve({contacts:[]}),status),sounds=[];
  f.imports['../../modules/identity'].localAccount.status=()=>({account:'owner'});
  Object.assign(f.imports['../../modules/messaging/notifications'],{readRootNotificationPreferences:async()=>({sound:true})});
  Object.assign(f.imports['../../services/soundService'],{playLooping:kind=>sounds.push(kind),stopLooping:()=>{}});
  const cleanups=f.effects.map(fn=>fn());await new Promise(r=>setImmediate(r));assert.deepEqual(sounds,status==='ringing'?['caller_ringback']:[]);
  for(const cleanup of cleanups)cleanup?.();
 }
});
test('visible incoming calls retry a transient confirmation failure and stop after confirmation',async()=>{
 const f=fixture(()=>Promise.resolve({contacts:[]}),'ringing');f.call.outgoing=false;let attempts=0;
 f.imports['../../modules/messaging'].localAccountCalls=()=>({confirmRinging:async()=>++attempts>1});
 const cleanups=f.effects.map(fn=>fn());await new Promise(r=>setImmediate(r));assert.equal(attempts,1);
 f.timeouts.at(-1).fn();await new Promise(r=>setImmediate(r));assert.equal(attempts,2);
 f.timeouts.at(-1).fn();await new Promise(r=>setImmediate(r));assert.equal(attempts,2);
 for(const cleanup of cleanups)cleanup?.();
});
test('call nickname effect tolerates a synchronously locked inbox and a later lock',async()=>{
 let locked=true;const f=fixture(()=>{if(locked)throw Error('Unlock your account first');return Promise.resolve({contacts:[{account:'axonic:1:'+'a'.repeat(64),alias:'Test emulator'}]});});
 const cleanups=f.effects.map(effect=>effect());await new Promise(r=>setImmediate(r));assert(f.updates.includes('axon'+'a'.repeat(64)));
 locked=false;f.timers[0]();await new Promise(r=>setImmediate(r));assert(f.updates.includes('Test emulator'));
 locked=true;f.timers[0]();await new Promise(r=>setImmediate(r));for(const cleanup of cleanups)cleanup?.();
});
test('nickname resolution completing after unmount cannot change the call screen',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const cleanups=f.effects.map(effect=>effect());for(const cleanup of cleanups)cleanup?.();const before=f.updates.length;resolve({contacts:[{account:f.call.peerUser,alias:'Late result'}]});await new Promise(r=>setImmediate(r));assert.equal(f.updates.length,before);
});

test('ended-call screen closes after three seconds without dismissing a newer call',()=>{
 const f=fixture(()=>Promise.resolve({contacts:[]}));
 const cleanups=f.effects.map(effect=>effect());
 assert.equal(f.timeouts.length,1);assert.equal(f.timeouts[0].delay,3000);
 f.timeouts[0].fn();const dismiss=f.updates.at(-1);
 assert.equal(dismiss(f.call),null);
 const next={...f.call,id:'next-call',status:'ringing'};
 assert.equal(dismiss(next),next);
 const ringing={...f.call,status:'ringing'};assert.equal(dismiss(ringing),ringing);
 for(const cleanup of cleanups)cleanup?.();assert.ok(f.cleared.includes(1));
});

test('ringing and connected calls do not start the dismissal timeout',()=>{
 for(const status of ['ringing','connecting','ready']){
  const f=fixture(()=>Promise.resolve({contacts:[]}),status);
  // Only run the dismissal effect; the ringing effect owns separate audio mocks.
  f.effects.at(-1)();assert.equal(f.timeouts.length,0,status);
 }
});
test('backgrounding stops the foreground ringtone and delayed preferences cannot restart it',async()=>{
 const f=fixture(()=>Promise.resolve({contacts:[]}),'ringing'),listeners=[],sounds=[];let resolve;
 f.imports['../../modules/identity'].localAccount.status=()=>({account:'owner'});
 f.imports['../../modules/messaging/notifications'].readRootNotificationPreferences=()=>new Promise(r=>resolve=r);
 Object.assign(f.imports['../../services/soundService'],{playLooping:kind=>sounds.push(kind),stopLooping:()=>sounds.push('stop')});
 const state=f.imports['react-native'].AppState;state.addEventListener=(_,fn)=>{listeners.push(fn);return {remove(){}}};
 const cleanups=f.effects.map(fn=>fn());state.currentState='background';for(const fn of listeners)fn('background');resolve({sound:true});await new Promise(r=>setImmediate(r));assert.ok(sounds.includes('stop'));assert.ok(!sounds.includes('caller_ringback'));for(const cleanup of cleanups)cleanup?.();
});
