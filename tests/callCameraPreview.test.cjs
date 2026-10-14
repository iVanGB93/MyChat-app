const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(acquire){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/callCameraPreview.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,()=>({mediaDevices:{getUserMedia:acquire}}));return out;}
function stream(events){return {toURL:()=> 'preview',getTracks:()=>[{stop:()=>events.push('stop')}],release:()=>events.push('release')};}
const tick=()=>new Promise(r=>setImmediate(r));
test('ringing preview captures only the front camera, without a microphone or peer transport',async()=>{
 const events=[],constraints=[],m=load(async options=>{constraints.push(options);return stream(events);});
 assert.equal((await m.callCameraPreview.start('one',()=>true)).toURL(),'preview');
 assert.equal(constraints[0].audio,false);assert.equal(constraints[0].video.facingMode,'user');
 await m.callCameraPreview.stop('one');assert.deepEqual(events,['stop','release']);
});
test('a late acquisition after cancellation or backgrounding is disposed instead of displayed',async()=>{
 for(const cancelled of [true,false]){
  const events=[];let resolve,active=true;const m=load(),preview=m.createCallCameraPreview(()=>new Promise(r=>resolve=r));
  const starting=preview.start('one',()=>active);await tick();
  const stopping=cancelled?preview.stop('one'):(active=false,Promise.resolve());
  resolve(stream(events));assert.equal(await starting,null);await stopping;assert.deepEqual(events,['stop','release']);
 }
});
test('camera handoff waits for pending preview acquisition and releases it before call media starts',async()=>{
 const events=[];let resolve;const m=load(),preview=m.createCallCameraPreview(()=>new Promise(r=>resolve=r));
 const starting=preview.start('one',()=>true);await tick();
 const handoff=preview.stop().then(()=>events.push('call media'));assert.deepEqual(events,[]);
 resolve(stream(events));await Promise.all([starting,handoff]);assert.deepEqual(events,['stop','release','call media']);
 const source=fs.readFileSync('src/hooks/useWebRTCCore.ts','utf8');assert(source.indexOf('await callCameraPreview.stop()')<source.indexOf('return await mediaDevices.getUserMedia(constraints)'));
});
test('stopping an old call does not stop a newer preview, and acquisition failures permit retry',async()=>{
 const events=[];let fail=true;const m=load(),preview=m.createCallCameraPreview(async()=>{if(fail)throw Error('camera unavailable');return stream(events);});
 await assert.rejects(preview.start('old',()=>true),/camera unavailable/);fail=false;
 await preview.start('new',()=>true);await preview.stop('old');assert.deepEqual(events,[]);await preview.stop('new');assert.deepEqual(events,['stop','release']);
});

function hookFixture(granted=true){
 const effects=[],slots=[];let index=0,state='active',account='owner',resolve,starts=0,stops=0;
 const app={get currentState(){return state;},addEventListener:()=>({remove(){}})};
 const out={},imports={react:{useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value];},useEffect:fn=>effects.push(fn)},'react-native':{AppState:app},'expo-image-picker':{getCameraPermissionsAsync:()=>new Promise(r=>resolve=r)},'../modules/identity':{localAccount:{status:()=>({state:account?'unlocked':'locked',account})}},'../services/callCameraPreview':{callCameraPreview:{start:async()=>{starts++;return {toURL:()=> 'preview'};},stop:async()=>{stops++;}}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/hooks/useRingingCameraPreview.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>imports[n]);
 const render=()=>{index=0;return out.default('one',true);};render();const cleanups=effects.splice(0).map(fn=>fn());
 return {render,finish:()=>resolve({granted}),background:()=>state='background',lock:()=>account=null,close:()=>cleanups.forEach(fn=>fn?.()),starts:()=>starts,stops:()=>stops};
}
test('camera permission denial, late permissions after backgrounding and lock never acquire a preview',async()=>{
 for(const action of ['denied','background','lock','close']){
  const f=hookFixture(action!=='denied');if(action!=='denied')f[action]();f.finish();await tick();assert.equal(f.starts(),0,action);assert.equal(f.render(),null);f.close();
 }
});
test('authorized preview appears locally and cleanup stops its camera lease',async()=>{
 const f=hookFixture();f.finish();await tick();assert.equal(f.starts(),1);assert.equal(f.render(),'preview');f.close();assert(f.stops()>0);
});
