const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){const app={currentState:'active'},events=[];let start=async()=>{events.push('start');};const mod={};const imports={
 'react-native':{AppState:app,Platform:{OS:'android'},NativeModules:{MyChatService:{start:()=>start(),stop:async()=>events.push('stop'),update:async()=>{}}}},
 '../../../modules/axonic-nearby':{default:{axonConnectedCall:v=>events.push(v)}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootCallLifetime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>imports[n]);return {mod,app,events,delay:fn=>{start=fn;}};}
test('background protection requires a foreground-started service and connected media',async()=>{
 const f=fixture();assert.equal(f.mod.rootCallMayRunBackground(),false);await f.mod.startRootCallLease('one','voice');assert.equal(f.mod.rootCallMayRunBackground(),false);
 f.mod.markRootCallConnected('wrong');assert.equal(f.mod.rootCallMayRunBackground(),false);f.mod.markRootCallConnected('one');assert.equal(f.mod.rootCallMayRunBackground(),true);
 f.mod.stopRootCallLease('wrong');assert.equal(f.mod.rootCallMayRunBackground(),true);f.mod.stopRootCallLease('one');assert.equal(f.mod.rootCallMayRunBackground(),false);
});
test('background start or failed native service cannot keep keys unlocked',async()=>{
 const f=fixture();f.app.currentState='background';assert.equal(await f.mod.startRootCallLease('one','voice'),false);f.mod.markRootCallConnected('one');assert.equal(f.mod.rootCallMayRunBackground(),false);assert.ok(!f.events.includes('start')&&!f.events.includes(true));
 f.app.currentState='active';f.delay(async()=>{throw Error('permission');});assert.equal(await f.mod.startRootCallLease('two','video'),false);f.mod.markRootCallConnected('two');assert.equal(f.mod.rootCallMayRunBackground(),false);
});
test('late native startup after hangup cannot resurrect background authorization',async()=>{
 const f=fixture();let release;f.delay(()=>new Promise(r=>release=r));const starting=f.mod.startRootCallLease('one','voice');await Promise.resolve();f.mod.stopRootCallLease('one');release();assert.equal(await starting,false);assert.equal(f.mod.rootCallMayRunBackground(),false);assert.ok(f.events.includes('stop'));
});
