const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/messageSounds.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
function fixture(){let active=true,visible=true,sound=true,owner='owner',resolve;const played=[];const api=mod.createMessageSounds({current:o=>active&&o===owner,visible:()=>visible,preferences:async()=>({sound}),play:async kind=>played.push(kind)});return {api,played,active:v=>active=v,visible:v=>visible=v,sound:v=>sound=v,owner:v=>owner=v,event:{owner:'owner',peer:'friend',id:'id',direction:'incoming'}};}
test('fresh current-chat messages play once; group fan-out and duplicate events do not repeat sent effects',async()=>{
 const f=fixture();await f.api.receive(f.event);await f.api.receive(f.event);assert.deepEqual(f.played,['message_received']);
 const sent={...f.event,direction:'outgoing',group:'group'};await f.api.receive(sent);await f.api.receive({...sent,peer:'other'});assert.deepEqual(f.played,['message_received','message_sent']);
});
test('muted, background, other-conversation, other-owner and disabled-sound events remain quiet',async()=>{
 for(const change of [f=>f.active(false),f=>f.visible(false),f=>f.owner('other'),f=>f.sound(false)]){const f=fixture();change(f);await f.api.receive(f.event);assert.equal(f.played.length,0);}
 const f=fixture();await f.api.receive({...f.event,muted:true});assert.equal(f.played.length,0);f.visible(false);await f.api.receive({...f.event,direction:'outgoing'});assert.deepEqual(f.played,['message_sent']);
});
test('a stop or account change during preference lookup cancels pending feedback',async()=>{
 for(const stop of [false,true]){let current=true,finish;const played=[];const api=mod.createMessageSounds({current:()=>current,visible:()=>true,preferences:()=>new Promise(r=>finish=r),play:async k=>played.push(k)});
 const wait=api.receive({owner:'owner',peer:'peer',id:'id',direction:'incoming'});if(stop)api.stop();else current=false;finish({sound:true});await wait;assert.deepEqual(played,[]);}
});
