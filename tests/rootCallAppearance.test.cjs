const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(read){
 const effects=[],timers=[],updates=[],call={id:'call',peerUser:'axonic:1:'+'a'.repeat(64),peerName:'peer',status:'ended',outgoing:true,media:'voice'};let count=0;
 const react={useState:initial=>[count++===0?call:initial,value=>updates.push(value)],useRef:value=>({current:value}),useEffect:effect=>effects.push(effect),useCallback:fn=>fn,createElement:()=>null};
 const imports={react:{default:react,...react},'react-native':{},'./CallStage':{},'./IncomingCallAppearance':{},'../../modules/messaging':{conversations:()=>({snapshot:read}),subscribeLocalAccountCalls:()=>()=>{}},'../../modules/identity':{shortIdentity:peer=>peer.replace('axonic:1:','axon')},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../services/identity/localAccountNetwork':{subscribeLocalAccountCalls:()=>()=>{}}};
 const out={};new Function('exports','require','setInterval','clearInterval',ts.transpileModule(fs.readFileSync('src/screens/calls/RootAccountCallScreen.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,name=>imports[name]??{},fn=>{timers.push(fn);return timers.length;},()=>{});
 out.default();return {effects,timers,updates,call};
}
test('call nickname effect tolerates a synchronously locked inbox and a later lock',async()=>{
 let locked=true;const f=fixture(()=>{if(locked)throw Error('Unlock your account first');return Promise.resolve({contacts:[{account:'axonic:1:'+'a'.repeat(64),alias:'Test emulator'}]});});
 const cleanups=f.effects.map(effect=>effect());await new Promise(r=>setImmediate(r));assert(f.updates.includes('axon'+'a'.repeat(64)));
 locked=false;f.timers[0]();await new Promise(r=>setImmediate(r));assert(f.updates.includes('Test emulator'));
 locked=true;f.timers[0]();await new Promise(r=>setImmediate(r));for(const cleanup of cleanups)cleanup?.();
});
test('nickname resolution completing after unmount cannot change the call screen',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const cleanups=f.effects.map(effect=>effect());for(const cleanup of cleanups)cleanup?.();const before=f.updates.length;resolve({contacts:[{account:f.call.peerUser,alias:'Late result'}]});await new Promise(r=>setImmediate(r));assert.equal(f.updates.length,before);
});
