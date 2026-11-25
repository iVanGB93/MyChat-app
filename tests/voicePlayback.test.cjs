const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {createVoicePlayback,nextVoiceMessage,voiceMessageKey}=(()=>{
 const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/voicePlayback.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);return out;
})();
const status=(patch={})=>({isLoaded:true,playing:false,isBuffering:false,playbackState:'ready',timeControlStatus:'paused',currentTime:0,duration:3,...patch});
const tick=()=>new Promise(setImmediate);
function fixture({next,loaded=true,prepare=async()=>{}}={}){
 let allowed=true,observe,plans=0,plays=0,pauses=0;const rewinds=[],errors=[],preparing=[];
 const player={currentStatus:status({isLoaded:loaded}),play(){plays++;},pause(){pauses++;},seekTo:async at=>rewinds.push(at)};
 const playback=createVoicePlayback({player,prepare(){plans++;return prepare();},allowed:()=>allowed,observe(fn){observe=fn;return()=>{observe=undefined;};},preparing:value=>preparing.push(value),error:reason=>errors.push(reason),next:()=>next});
 return {playback,player,rewinds,errors,preparing,
  report(patch){player.currentStatus=status(patch);playback.status(player.currentStatus);},
  block(){allowed=false;observe?.();},plans:()=>plans,plays:()=>plays,pauses:()=>pauses};
}
test('the first tap waits for readiness and a second tap cancels a pending startup',async t=>{
 const f=fixture({loaded:false});t.after(f.playback.stop);
 f.playback.toggle();assert.deepEqual(f.preparing,[true]);assert.equal(f.plans(),0);
 f.report({isLoaded:true});await tick();assert.equal(f.plays(),1);
 f.report({playing:true});assert.deepEqual(f.preparing,[true,false]);f.playback.toggle();assert.equal(f.pauses(),1);
 f.report({isLoaded:false});f.playback.toggle();f.playback.toggle();f.report({isLoaded:true});await tick();assert.equal(f.plays(),1);
});
test('natural finish advances exactly once and restarts the next voice clip from the beginning',async t=>{
 const b=fixture(),a=fixture({next:{owner:'owner',key:'b'}}),unbind=b.playback.bind('owner','b');
 t.after(()=>{a.playback.stop();b.playback.stop();unbind();});
 b.report({currentTime:1});a.playback.toggle();await tick();a.report({playing:true});
 a.report({playbackState:'ended',didJustFinish:true});a.report({playbackState:'ended',didJustFinish:true});await tick();
 assert.deepEqual(b.rewinds,[0]);assert.equal(b.plans(),0);assert.equal(b.plays(),1);assert.equal(a.pauses(),0);
});
test('pause, interruption, seeking to the end, and a detached next clip cannot autoplay',async t=>{
 for(const reason of ['pause','focus','seek-to-end','detached']){
  const b=fixture(),a=fixture({next:{owner:'owner',key:'b'}}),unbind=b.playback.bind('owner','b');
  t.after(()=>{a.playback.stop();b.playback.stop();unbind();});
  a.playback.toggle();await tick();a.report({playing:true});
  if(reason==='pause')a.playback.toggle();
  if(reason==='focus')a.block();
  if(reason==='seek-to-end')a.playback.seek(3,3);
  if(reason==='detached')unbind();
  a.report({playbackState:'ended',didJustFinish:true});await tick();assert.equal(b.plays(),0,reason);
 }
});
test('a new clip or call cancels a pending audio-mode change before it starts playing',async t=>{
 let unlock;const a=fixture({prepare:()=>new Promise(resolve=>unlock=resolve)}),b=fixture();
 t.after(()=>{a.playback.stop();b.playback.stop();});
 a.playback.toggle();b.playback.toggle();unlock();await tick();
 assert.equal(a.plays(),0);assert.equal(b.plays(),1);
 b.report({playing:true});b.block();assert.equal(b.pauses(),1);
 b.playback.toggle();assert.deepEqual(b.errors,['blocked']);
});
test('only the immediate playable message from the same author and conversation is a candidate',()=>{
 const first={id:'a',peer:'one',direction:'incoming',group:{id:'g',messageId:'first'},attachment:{mime:'audio/mp4'}};
 const next={...first,id:'b',group:{id:'g',messageId:'second'}};
 assert.equal(nextVoiceMessage(first,next),voiceMessageKey(next));
 for(const row of [undefined,{...next,peer:'other'},{...next,direction:'outgoing'},{...next,attachment:undefined},{...next,deleted:true},{...next,localPending:true},{...next,group:{id:'other',messageId:'second'}}]){
  assert.equal(nextVoiceMessage(first,row),undefined);
 }
});
