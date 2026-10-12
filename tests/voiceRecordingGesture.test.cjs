const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/utils/voice-recording-gesture.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);const events=[];let timer,start=async()=>{events.push('start');},feedback=()=>events.push('haptic');
 const gesture=out.createVoiceRecordingGesture({start:()=>start(),send:async()=>events.push('send'),cancel:async()=>events.push('cancel'),error:e=>events.push(['error',e.message]),held:()=>feedback(),changed:(held,cancel)=>events.push(['ui',held,cancel]),schedule:(fn,delay)=>{assert.equal(delay,100);timer=fn;return 1;},clear:()=>{timer=null;}});
 return {gesture,events,hold:()=>{const work=timer;timer=null;work?.();},pending:()=>{let resolve;start=()=>new Promise(r=>{events.push('start');resolve=r;});return ()=>resolve();},fail:()=>{start=async()=>{throw Error('permission denied');};},failFeedback:()=>{feedback=()=>{throw Error('no vibration hardware');};}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('quick tap starts latched recording without automatically sending',async()=>{const f=fixture();f.gesture.press(300);f.gesture.release(300);f.hold();await tick();assert.equal(f.events.filter(e=>e==='start').length,1);assert(!f.events.includes('send'));});
test('short hold sends once on release and suppresses repeated release',async()=>{const f=fixture();f.gesture.press(300);f.hold();assert(f.events.includes('start'));assert(!f.events.includes('send'));f.gesture.release(300);f.gesture.release(300);await tick();assert.equal(f.events.filter(e=>e==='send').length,1);});
test('release waits for microphone startup before sending',async()=>{const f=fixture(),finish=f.pending();f.gesture.press(300);f.hold();f.gesture.release(300);await tick();assert(!f.events.includes('send'));finish();await tick();assert(f.events.includes('send'));});
test('slide left arms the bin and releasing cancels instead of sending',async()=>{const f=fixture();f.gesture.press(300);f.hold();f.gesture.move(228);assert.deepEqual(f.events.at(-1),['ui',true,true]);f.gesture.release(228);await tick();assert(f.events.includes('cancel'));assert(!f.events.includes('send'));});
test('sliding back out of cancellation restores release-to-send',async()=>{const f=fixture();f.gesture.press(300);f.hold();f.gesture.move(200);f.gesture.move(280);assert.deepEqual(f.events.at(-1),['ui',true,false]);f.gesture.release(280);await tick();assert(f.events.includes('send'));assert(!f.events.includes('cancel'));});
test('cancel during startup and a background interruption never auto-send later',async()=>{for(const cancel of [f=>f.gesture.release(200),f=>{f.gesture.release(300);f.gesture.terminate();}]){const f=fixture(),finish=f.pending();f.gesture.press(300);f.hold();cancel(f);finish();await tick();assert(f.events.includes('cancel'));assert(!f.events.includes('send'));}});
test('permission failure, disposal or a quick drag cannot become an accidental send',async()=>{
 const denied=fixture();denied.fail();denied.gesture.press(300);denied.hold();denied.gesture.release(300);await tick();assert(!denied.events.includes('send'));assert(denied.events.some(e=>Array.isArray(e)&&e[0]==='error'));
 const f=fixture(),finish=f.pending();f.gesture.press(300);f.hold();f.gesture.release(300);f.gesture.dispose();finish();await tick();assert(!f.events.includes('send'));
 const quick=fixture();quick.gesture.press(300);quick.gesture.release(200);quick.hold();assert(!quick.events.includes('start'));
});
test('hold feedback fires once at activation, never for quick taps or cancelled pending holds',async()=>{
 const f=fixture();f.gesture.press(300);assert(!f.events.includes('haptic'));f.hold();f.gesture.move(200);f.gesture.move(280);f.gesture.release(280);await tick();assert.equal(f.events.filter(e=>e==='haptic').length,1);
 const tap=fixture();tap.gesture.press(300);tap.gesture.release(300);tap.hold();assert(!tap.events.includes('haptic'));
 const interrupted=fixture();interrupted.gesture.press(300);interrupted.gesture.terminate();interrupted.hold();assert(!interrupted.events.includes('haptic'));
});
test('unavailable haptic feedback cannot interrupt recording or release-to-send',async()=>{
 const f=fixture();f.failFeedback();f.gesture.press(300);f.hold();f.gesture.release(300);await tick();assert(f.events.includes('start'));assert(f.events.includes('send'));assert(!f.events.some(e=>Array.isArray(e)&&e[0]==='error'));
});
