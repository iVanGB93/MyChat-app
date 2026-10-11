const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let mode='normal',gate=null;const players=[],out={};const deps={'react-native':{Vibration:{vibrate(){}}},'expo-audio':{setAudioModeAsync:async()=>{},createAudioPlayer:()=>{const p={played:0,removed:0,paused:0,play(){this.played++;},pause(){this.paused++;},remove(){this.removed++;}};players.push(p);return p;}},'./ringerService':{getRingerMode:async()=>gate?await gate:mode}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/soundService.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.startsWith('../../assets/')?1:deps[n]);return {out,players,mode:v=>mode=v,wait:()=>new Promise(resolve=>{gate=new Promise(r=>resolve(r));}),gate:p=>gate=p};}
test('normal mode plays a looping call tone and stop releases it',async()=>{
 const f=fixture();await f.out.playLooping('ringtone');assert.equal(f.players.length,1);assert.equal(f.players[0].played,1);assert.equal(f.players[0].loop,true);await f.out.stopLooping();assert.equal(f.players[0].removed,1);
});
test('silent and vibrate modes suppress call audio',async()=>{
 for(const mode of ['silent','vibrate']){const f=fixture();f.mode(mode);await f.out.playLooping('ringtone');assert.equal(f.players.length,0);}
});
test('cancellation while querying the ringer cannot resurrect a tone',async()=>{
 const f=fixture();let finish;f.gate(new Promise(r=>finish=r));const start=f.out.playLooping('ringtone');await f.out.stopLooping();finish('normal');await start;assert.equal(f.players.length,0);
});
test('a new call tone replaces and releases the previous player',async()=>{
 const f=fixture();await f.out.playLooping('ringtone');await f.out.playLooping('caller_ringback');assert.equal(f.players.length,2);assert.equal(f.players[0].removed,1);assert.equal(f.players[1].played,1);await f.out.stopLooping();
});
