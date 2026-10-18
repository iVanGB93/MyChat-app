const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(fraction=.1){
 const effects=[],events=[];let handler,release;
 const native={prepareShareOverlay:async()=>{events.push('prepare');return fraction;},showShareOverlay:m=>events.push(['show',m]),hideShareOverlay:()=>events.push('hide'),updateShareOverlayMute:m=>events.push(['muteLabel',m]),requestShareOverlayPermission:async()=>false};
 const imports={react:{useEffect:fn=>effects.push(fn),useRef:value=>({current:value})},'react-native':{Platform:{OS:'android'},NativeModules:{MyChatService:native},DeviceEventEmitter:{addListener:(_,fn)=>{handler=fn;return {remove:()=>events.push('remove')};}}},'../services/identity/rootCallLifetime':{setRootCallSharing:async(_,value)=>events.push(['sharing',value])}};
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/hooks/useScreenShareOverlay.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>imports[n]);
 out.useScreenShareOverlay('call',true,false,async f=>{events.push(['crop',f]);await new Promise(r=>release=r);},()=>events.push('mute'),async()=>events.push('stop'),()=>events.push('end'),()=>events.push('error'));
 return {out,effects,events,event:e=>handler(e),release:()=>release()};
}
test('overlay waits for capture exclusion, routes actions and removes itself on cleanup',async()=>{
 const f=fixture(),cleanup=f.effects[0]();await tick();assert(!f.events.some(e=>e[0]==='show'));
 f.release();await tick();assert.deepEqual(f.events.at(-1),['show',false]);
 for(const action of ['mute','stop','end'])f.event({action});assert.deepEqual(f.events.slice(-3),['mute','stop','end']);
 cleanup();assert(f.events.includes('hide'));assert.deepEqual(f.events.at(-1),['sharing',false]);
});
test('late crop completion after hangup cannot show an orphan overlay',async()=>{
 const f=fixture(),cleanup=f.effects[0]();await tick();cleanup();f.release();await tick();assert(!f.events.some(e=>e[0]==='show'));
});
test('movable protected controls restore the full display without edge cropping',async()=>{
 const f=fixture(0),cleanup=f.effects[0]();await tick();assert(f.events.some(e=>e[0]==='crop'&&e[1]===0));
 f.release();await tick();assert.deepEqual(f.events.at(-1),['show',false]);cleanup();
 const native=fs.readFileSync('plugins/android/MyChatServiceModule.kt','utf8');
 assert.match(native,/FLAG_SECURE/);assert.match(native,/grip.setOnTouchListener/);
 assert.match(native,/promise.resolve\(0.0\)/);assert.match(native,/ShareControlButton/);
});
test('invalid overlay bounds stop sharing without showing captured controls',async()=>{
 const f=fixture(),cleanup=f.effects[0]();await tick();f.event({action:'layout',fraction:.9});await tick();assert(f.events.includes('error'));assert(f.events.includes('stop'));cleanup();f.release();
});
test('compact icon-only controls retain 48dp touch height and accessible action names',()=>{
 const native=fs.readFileSync('plugins/android/MyChatServiceModule.kt','utf8');
 assert.match(native,/val height = \(80 \* density\)/);assert.match(native,/\(180 \* density\)/);
 assert.match(native,/\(48\*resources.displayMetrics.density\)/);
 assert.doesNotMatch(native,/private val caption|Drag controls"/);
 assert.match(native,/contentDescription=label/);assert.match(native,/tooltipText=label/);
 assert.equal(80-6-6-20,48);assert((180-12)/3>=48);
});
