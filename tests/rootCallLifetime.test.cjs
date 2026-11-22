const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){const app={currentState:'active'},events=[];let start=async()=>{events.push('start');};const mod={},service={start:()=>start(),stop:async()=>events.push('stop'),setPictureInPictureEnabled:async enabled=>events.push(['pip',enabled])};const imports={
 'react-native':{AppState:app,Platform:{OS:'android'},NativeModules:{MyChatService:service}},
 '../../../modules/axonic-nearby':{default:{axonConnectedCall:v=>events.push(v)}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootCallLifetime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>imports[n]);return {mod,app,events,service,delay:fn=>{start=fn;}};}
test('ongoing notification actions are bound to the current call ID',async()=>{
 const f=fixture();f.service.startWithHangUp=async(kind,id)=>f.events.push([kind,id]);
 assert.equal(await f.mod.startRootCallLease('current-call','video'),true);
 assert.deepEqual(f.events.find(event=>event[0]==='video'),['video','current-call']);
});
test('ongoing notification avatar waits for native startup and ignores the previous call',async()=>{
 const f=fixture(),uri='data:image/jpeg;base64,/9j/2Q==';let release;
 f.service.setCallNotificationAvatar=async(id,image)=>f.events.push(['avatar',id,image]);
 f.delay(()=>new Promise(resolve=>release=resolve));
 const starting=f.mod.startRootCallLease('current','voice');
 while(!release)await Promise.resolve();
 f.mod.setRootCallNotificationAvatar('previous',uri);
 f.mod.setRootCallNotificationAvatar('current',uri);
 assert(!f.events.some(event=>event[0]==='avatar'));
 release();await starting;await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.events.filter(event=>event[0]==='avatar'),[['avatar','current','/9j/2Q==']]);
 f.mod.stopRootCallLease('current');
 f.mod.setRootCallNotificationAvatar('current',uri);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.events.filter(event=>event[0]==='avatar').length,1);
});
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
 const f=fixture();let release;f.delay(()=>new Promise(r=>release=r));const starting=f.mod.startRootCallLease('one','voice');while(!release)await Promise.resolve();f.mod.stopRootCallLease('one');release();assert.equal(await starting,false);assert.equal(f.mod.rootCallMayRunBackground(),false);assert.ok(f.events.includes('stop'));
});
test('Home picture-in-picture is armed only after media and the service are ready, then cleared on hangup',async()=>{
 for(const kind of ['voice','video']){
  const f=fixture();await f.mod.startRootCallLease('one',kind);assert(!f.events.some(e=>Array.isArray(e)&&e[0]==='pip'&&e[1]));
  f.mod.markRootCallConnected('one');await new Promise(r=>setImmediate(r));assert.deepEqual(f.events.at(-1),['pip',true]);
  f.mod.stopRootCallLease('one');await new Promise(r=>setImmediate(r));assert.equal(f.events.at(-1),'stop');assert.deepEqual(f.events.at(-2),['pip',false]);
 }
});
test('a connection during delayed service startup cannot arm PiP until startup completes',async()=>{
 const f=fixture();let release;f.delay(()=>new Promise(r=>release=r));const work=f.mod.startRootCallLease('one','video');while(!release)await Promise.resolve();f.mod.markRootCallConnected('one');assert(!f.events.some(e=>Array.isArray(e)&&e[0]==='pip'&&e[1]));release();await work;await new Promise(r=>setImmediate(r));assert.deepEqual(f.events.at(-1),['pip',true]);
});
test('screen sharing suppresses Home PiP without losing the call lease and restores it on stop',async()=>{
 const f=fixture();await f.mod.startRootCallLease('one','video');f.mod.markRootCallConnected('one');
 await f.mod.setRootCallSharing('one',true);assert.deepEqual(f.events.at(-1),['pip',false]);assert(f.mod.rootCallMayRunBackground());
 f.mod.markRootCallConnected('one');await new Promise(r=>setImmediate(r));assert.deepEqual(f.events.at(-1),['pip',false]);
 await f.mod.setRootCallSharing('wrong',false);assert.deepEqual(f.events.at(-1),['pip',false]);
 await f.mod.setRootCallSharing('one',false);assert.deepEqual(f.events.at(-1),['pip',true]);
});
