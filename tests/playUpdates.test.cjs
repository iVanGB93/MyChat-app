const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/playUpdates.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
function fixture(){let now=1000000000,foreground=true,safe=true,saved=null,starts=[],completed=0,info={availability:'available',availableVersionCode:100,flexibleAllowed:true,installStatus:0};const api=mod.createPlayUpdates({now:()=>now,foreground:()=>foreground,safeToRestart:async()=>safe,info:async()=>info,start:async immediate=>{starts.push(immediate);return 'accepted';},complete:async()=>{completed++;},read:async()=>saved,write:async v=>{saved=v;}});return {api,starts,completed:()=>completed,advance:n=>now+=n,foreground:v=>foreground=v,safe:v=>safe=v,info:v=>info=v,saved:()=>saved};}
test('Play checks are foreground-only, protect calls and transfers, and persist prompt cooldown',async()=>{const f=fixture();f.foreground(false);await f.api.check();assert.equal(f.api.snapshot().status,'idle');f.foreground(true);f.safe(false);await f.api.check();assert.equal(f.starts.length,0);f.safe(true);await f.api.check(true);assert.deepEqual(f.starts,[false]);assert.equal(JSON.parse(f.saved()).version,100);await f.api.check(true);assert.equal(f.starts.length,1);f.advance(86400000);await f.api.check(true);assert.equal(f.starts.length,2);});
test('a downloaded update installs only explicitly and once under concurrent taps',async()=>{const f=fixture();f.info({availability:'available',availableVersionCode:100,installStatus:11});await f.api.check();assert.equal(f.api.snapshot().status,'ready');assert.equal(f.completed(),0);f.safe(false);assert.equal(await f.api.install(),false);f.safe(true);await Promise.all([f.api.install(),f.api.install()]);assert.equal(f.completed(),1);});
test('in-progress immediate update resumes despite flexible prompt cooldown',async()=>{const f=fixture();await f.api.check();f.info({availability:'in_progress',availableVersionCode:100,installStatus:0});await f.api.check(true);assert.deepEqual(f.starts,[false,true]);});
test('missing native support and stopped controller remain harmless',async()=>{const f=fixture();f.info(null);await f.api.check();assert.equal(f.api.snapshot().status,'unavailable');f.api.stop();await f.api.check(true);assert.equal(f.starts.length,0);});

test('Play query timeout fails nonblockingly and permits a later retry',async()=>{let hang=true,starts=0;const api=mod.createPlayUpdates({queryTimeoutMs:5,now:Date.now,foreground:()=>true,safeToRestart:async()=>true,info:()=>hang?new Promise(()=>{}):Promise.resolve(null),start:async()=>{starts++;return 'accepted';},complete:async()=>{},read:async()=>null,write:async()=>{}});await api.check();assert.equal(api.snapshot().status,'error');hang=false;await api.check(true);assert.equal(api.snapshot().status,'unavailable');assert.equal(starts,0);});

test('an interrupted or failed prompt does not consume the daily prompt allowance',async()=>{
 let foreground=true,interrupt=true,fail=true,starts=0,saves=0;
 const api=mod.createPlayUpdates({now:Date.now,foreground:()=>foreground,safeToRestart:async()=>true,info:async()=>({availability:'available',availableVersionCode:101,flexibleAllowed:true}),read:async()=>{if(interrupt)foreground=false;return null;},write:async()=>{saves++;},start:async()=>{starts++;return fail?'failed':'accepted';},complete:async()=>{}});
 await api.check();assert.equal(starts,0);assert.equal(saves,0);
 interrupt=false;foreground=true;await api.check(true);assert.equal(starts,1);assert.equal(saves,0);
 fail=false;await api.check();assert.equal(starts,2);assert.equal(saves,1);
});
test('cancelled prompts keep an in-memory cooldown when storage is unavailable',async()=>{
 let starts=0;const api=mod.createPlayUpdates({now:Date.now,foreground:()=>true,safeToRestart:async()=>true,info:async()=>({availability:'available',availableVersionCode:101,flexibleAllowed:true}),read:async()=>{throw Error('storage unavailable');},write:async()=>{throw Error('storage unavailable');},start:async()=>{starts++;return 'cancelled';},complete:async()=>{}});
 await api.check();await api.check(true);assert.equal(starts,1);assert.equal(api.snapshot().status,'available');
});

test('manual checks publish checking and can reopen a cancelled daily prompt while polling cannot',async()=>{
 const f=fixture(),states=[];f.api.subscribe(()=>states.push(f.api.snapshot().status));
 await f.api.check();await f.api.check(true);assert.equal(f.starts.length,1);
 await f.api.check(true,true);assert.equal(f.starts.length,2);assert(states.includes('checking'));
 await f.api.check(true);assert.equal(f.starts.length,2);
});
test('manual checks can start a Play-permitted immediate update when flexible is unavailable',async()=>{
 const f=fixture();f.info({availability:'available',availableVersionCode:100,flexibleAllowed:false,immediateAllowed:true});
 await f.api.check();assert.equal(f.starts.length,0);await f.api.check(true,true);assert.deepEqual(f.starts,[true]);
});

test('backgrounding during a check clears checking and allows a fresh foreground query',async()=>{
 let foreground=true,queries=0;
 const api=mod.createPlayUpdates({now:Date.now,foreground:()=>foreground,safeToRestart:async()=>true,info:async()=>{queries++;if(queries===1)foreground=false;return {availability:'not_available',availableVersionCode:100};},start:async()=>{throw Error('should not prompt');},complete:async()=>{},read:async()=>null,write:async()=>{}});
 await api.check();assert.equal(api.snapshot().status,'idle');foreground=true;await api.check();assert.equal(queries,2);assert.equal(api.snapshot().status,'current');
});
