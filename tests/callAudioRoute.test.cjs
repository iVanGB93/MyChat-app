const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(native) {
  const s = { exports: {}, require: () => ({ requireOptionalNativeModule: () => native }) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/call-audio-route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, s);
  return s.exports;
}
test('speaker requests and restoration stay ordered across delayed native calls', async () => {
  const actions = [];
  const audio = load({ setCallSpeaker: async (value) => { await Promise.resolve(); actions.push(value); return value; }, restoreCallAudio: async () => { actions.push('restore'); } });
  const first = audio.setCallSpeaker(true);
  audio.restoreCallAudio();
  const next = audio.setCallSpeaker(false);
  assert.equal(await first, true);
  assert.equal(await next, false);
  assert.deepEqual(actions, [true, 'restore', false]);
});
test('old development clients get an explanatory error instead of a fake toggle', async () => {
  const audio = load({});
  await assert.rejects(audio.setCallSpeaker(true), /updated Android build/);
  audio.restoreCallAudio();
});

test('automatic startup, explicit output and cleanup remain ordered across native delays',async()=>{
 const actions=[];let release;
 const routes={automatic:true,selectedId:'headset',devices:[{id:'headset',kind:'bluetooth',label:'Bluetooth',name:'Test headset'}]};
 const audio=load({startCallAudio:async video=>{actions.push(['start',video]);await new Promise(r=>release=r);return routes;},
  selectCallAudioRoute:async id=>{actions.push(['select',id]);return {...routes,automatic:false};},restoreCallAudio:async()=>actions.push(['restore'])});
 const starting=audio.startCallAudio(true);await Promise.resolve();
 const switching=audio.selectCallAudioRoute('headset');audio.restoreCallAudio();
 assert.equal(actions.length,1);release();assert.equal((await starting).selectedId,'headset');await switching;
 await new Promise(r=>setImmediate(r));assert.deepEqual(actions,[['start',true],['select','headset'],['restore']]);
});

test('route observation reports actual native changes and can unsubscribe',()=>{
 let listener,removed=false;const audio=load({addListener:(event,fn)=>{assert.equal(event,'onCallAudioRoute');listener=fn;return {remove(){removed=true;}};}});
 const seen=[],subscription=audio.observeCallAudioRoutes(routes=>seen.push(routes));
 listener({automatic:false,selectedId:'speaker',devices:[]});listener({automatic:true,selectedId:'phone',devices:[]});
 assert.deepEqual(seen.map(x=>x.selectedId),['speaker','phone']);subscription.remove();assert(removed);
});

test('unavailable route errors do not prevent restoration or a later route selection',async()=>{
 let restored=false;const audio=load({selectCallAudioRoute:async id=>{if(id==='gone')throw Error('disconnected');return {selectedId:id};},restoreCallAudio:async()=>{restored=true;}});
 await assert.rejects(audio.selectCallAudioRoute('gone'),/disconnected/);audio.restoreCallAudio();
 assert.equal((await audio.selectCallAudioRoute('automatic')).selectedId,'automatic');assert(restored);
 const old=load({});await assert.rejects(old.startCallAudio(false),/updated Android build/);
 await assert.rejects(old.selectCallAudioRoute('speaker'),/updated Android build/);assert.equal(await old.getCallAudioRoutes(),null);
});
