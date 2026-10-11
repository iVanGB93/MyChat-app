const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let mode='normal',finish,gate=null,current=true;const players=[],vibrations=[],mod={};
 const deps={'react-native':{Vibration:{vibrate:n=>vibrations.push(n)}},'./ringerService':{getRingerMode:()=>gate??Promise.resolve(mode)},'expo-audio':{setAudioModeAsync:async()=>{},createAudioPlayer:clip=>{const p={clip,played:0,removed:0,callback:null,play(){this.played++;},pause(){},remove(){this.removed++;},addListener:(name,fn)=>{p.callback=fn;return {remove(){p.callback=null;}};}};players.push(p);return p;}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/soundService.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>n.startsWith('../../assets/')?n:deps[n]);
 return {mod,players,vibrations,mode:m=>mode=m,current:()=>current,hide:()=>current=false,wait:()=>{gate=new Promise(r=>finish=r);return ()=>finish('normal');}};
}
test('message clips play once, release on completion, and do not retain the previous player',async()=>{
 const f=fixture();await f.mod.playMessageSound('message_sent',f.current);assert(f.players[0].clip.endsWith('message_sent.wav'));assert.equal(f.players[0].played,1);
 await f.mod.playMessageSound('message_received',f.current);assert.equal(f.players[0].removed,1);assert(f.players[1].clip.endsWith('message_received.wav'));
 f.players[1].callback({didJustFinish:true});assert.equal(f.players[1].removed,1);f.mod.stopMessageSounds();assert.equal(f.players[1].removed,1);
});
test('message feedback respects silent and vibrate modes',async()=>{
 const silent=fixture();silent.mode('silent');await silent.mod.playMessageSound('message_received',silent.current);assert.equal(silent.players.length,0);
 const vibrate=fixture();vibrate.mode('vibrate');await vibrate.mod.playMessageSound('message_received',vibrate.current);assert.equal(vibrate.players.length,0);assert.deepEqual(vibrate.vibrations,[40]);
});
test('backgrounding or stopping while checking the ringer prevents a late sound',async()=>{
 for(const stop of [false,true]){const f=fixture(),finish=f.wait(),pending=f.mod.playMessageSound('message_sent',f.current);if(stop)f.mod.stopMessageSounds();else f.hide();finish();await pending;assert.equal(f.players.length,0);}
});
