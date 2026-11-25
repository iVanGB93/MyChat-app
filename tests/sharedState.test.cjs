const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(request=>request.startsWith('.')?load(path.resolve(path.dirname(file),request.replace(/\.ts$/,'')+'.ts')):require(request),exports);return exports;}
const {retainEqual,createObservedState}=load('src/services/identity/sharedState.ts');
const {createPreferenceState}=load('src/services/identity/preferenceState.ts');
const {callMediaState,beginCallMediaState,clearCallMediaState}=load('src/services/identity/callMediaState.ts');
test('equal branches retain identity without mutating input or comparing through JSON strings',()=>{
 const old={list:[{a:1},{a:2}],missing:undefined};const next={list:[{a:1},{a:3}],missing:undefined};const result=retainEqual(old,next);
 assert.equal(result.list[0],old.list[0]);assert.notEqual(result.list[1],old.list[1]);assert.equal(old.list[1].a,2);assert.equal(next.list[1].a,3);
 assert.equal(retainEqual(old,structuredClone(old)),old);assert.notEqual(retainEqual({x:undefined},{}),old);
});
test('native objects are not traversed or converted to plain objects',()=>{const a=new Date(0),b=new Date(1);assert.equal(retainEqual(a,b),b);});
test('multiple observers attach one source and equal updates notify nobody',()=>{
 let value={count:1},starts=0,stops=0,changed,notifications=0;
 const state=createObservedState(()=>value,fn=>{starts++;changed=fn;return()=>stops++;});
 const a=state.subscribe(()=>notifications++),b=state.subscribe(()=>notifications++);
 assert.equal(starts,1);value={count:1};changed();assert.equal(notifications,0);
 value={count:2};changed();assert.equal(notifications,2);a();assert.equal(stops,0);b();assert.equal(stops,1);
 value={count:3};const c=state.subscribe(()=>{});assert.equal(state.getState().value.count,3);assert.equal(starts,2);c();
});
test('preferences coalesce concurrent reads and a late read cannot undo a saved choice',async()=>{
 let resolve,reads=0;const prefs=createPreferenceState(()=>{reads++;return new Promise(r=>resolve=r);},async()=>{});
 const a=prefs.read('owner'),b=prefs.read('owner');assert.equal(a,b);assert.equal(reads,1);
 await prefs.write('owner',{sound:false});resolve({sound:true});assert.deepEqual(await a,{sound:false});assert.equal(prefs.getState().values.owner.sound,false);
});
test('failed preference writes preserve the last committed value',async()=>{
 const prefs=createPreferenceState(async()=>({sound:true}),async()=>{throw Error('disk');});await prefs.read('owner');
 await assert.rejects(prefs.write('owner',{sound:false}),/disk/);assert.equal(prefs.getState().values.owner.sound,true);
});
test('old call cleanup and events cannot overwrite a newer media owner',()=>{
 const value={connection:'p2p',recovering:false,muted:false,cameraOff:false,sharing:false,remoteSharing:false,sharingBusy:false,quality:'good'};
 const a=beginCallMediaState('a');a.update(value);const b=beginCallMediaState('b');b.update({...value,muted:true});a.update(value);a.stop();assert.equal(callMediaState.getState().value.id,'b');assert.equal(callMediaState.getState().value.muted,true);
 clearCallMediaState();b.update(value);assert.equal(callMediaState.getState().value,null);
});
