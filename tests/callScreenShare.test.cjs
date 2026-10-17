const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/callScreenShare.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
function setup(){
 const camera={id:'camera',kind:'video',enabled:true},screen={id:'screen',kind:'video',readyState:'live',stopped:0,stop(){this.stopped++;}},mic={kind:'audio',enabled:true};
 const calls=[],states=[],previews=[],errors=[];let released=0,acquired=0;
 const stream={getTracks:()=>[screen],getVideoTracks:()=>[screen],release(){released++;}};
 const sender={track:camera,async replaceTrack(track){calls.push(track);this.track=track;}};
 const d={acquire:async()=>{acquired++;return stream;},camera:()=>camera,sender:()=>sender,preview:t=>previews.push(t),changed:(...s)=>states.push(s),error:e=>errors.push(e)};
 const controller=out.createCallScreenShare(d);
 return {camera,screen,stream,mic,sender,d,calls,states,previews,errors,controller,counts:()=>({released,acquired})};
}
test('sharing swaps only the video sender and restores the camera without changing microphone state',async()=>{
 const f=setup();await f.controller.start();assert.equal(f.sender.track,f.screen);assert.equal(f.camera.enabled,false);assert(f.mic.enabled);assert.equal(f.previews.at(-1),f.stream);
 await f.controller.stop();assert.equal(f.sender.track,f.camera);assert(f.camera.enabled);assert.equal(f.previews.at(-1),null);assert.equal(f.screen.stopped,1);assert.equal(f.counts().released,1);assert(f.mic.enabled);assert(!f.controller.active());
});
test('a camera that was off remains off after sharing',async()=>{const f=setup();f.camera.enabled=false;await f.controller.start();await f.controller.stop();assert.equal(f.camera.enabled,false);});
test('capture permission rejection leaves camera and sender unchanged and permits retry',async()=>{
 const f=setup(),acquire=f.d.acquire;f.d.acquire=async()=>{throw Error('denied');};await assert.rejects(f.controller.start(),/denied/);assert(f.camera.enabled);assert.equal(f.calls.length,0);assert(!f.controller.active());f.d.acquire=acquire;await f.controller.start();await f.controller.stop();
});
test('hangup while permission is pending discards late capture without attaching it',async()=>{
 const f=setup();let resolve;f.d.acquire=()=>new Promise(r=>resolve=r);const start=f.controller.start();await Promise.resolve();f.controller.close();resolve({getTracks:()=>[f.screen],getVideoTracks:()=>[f.screen],release(){}});await start;assert.equal(f.screen.stopped,1);assert.equal(f.calls.length,0);
});
test('stop during permission cancels the pending switch and repeated start opens one prompt',async()=>{
 const f=setup();let resolve;f.d.acquire=()=>new Promise(r=>resolve=r);const start=f.controller.start();await f.controller.start();await Promise.resolve();const stop=f.controller.stop();resolve({getTracks:()=>[f.screen],getVideoTracks:()=>[f.screen],release(){}});await start;await stop;assert.equal(f.calls.length,0);assert.equal(f.screen.stopped,1);
});
test('Android stopping capture restores the camera and removes its event handler',async()=>{
 const f=setup();await f.controller.start();f.screen.readyState='ended';f.screen.onended();await new Promise(r=>setImmediate(r));assert.equal(f.sender.track,f.camera);assert.equal(f.screen.onended,null);assert(!f.controller.active());
});
test('sender failure releases capture without disabling the camera',async()=>{
 const f=setup();f.sender.replaceTrack=async()=>{throw Error('swap failed');};await assert.rejects(f.controller.start(),/swap failed/);assert(f.camera.enabled);assert.equal(f.screen.stopped,1);assert(!f.controller.active());
});
test('a swallowed native replacement failure must not report sharing as active',async()=>{
 const f=setup();f.sender.replaceTrack=async()=>{};await assert.rejects(f.controller.start(),/not attached/);assert(f.camera.enabled);assert.equal(f.screen.stopped,1);assert(!f.controller.active());assert.equal(f.previews.length,0);
});
test('stop always releases screen capture even if restoring the camera fails',async()=>{
 const f=setup();await f.controller.start();f.sender.replaceTrack=async()=>{throw Error('closed');};await assert.rejects(f.controller.stop(),/closed/);assert.equal(f.screen.stopped,1);assert.equal(f.previews.at(-1),null);assert(!f.controller.active());
});
test('hangup during sharing stops capture and never resumes the camera',async()=>{
 const f=setup();await f.controller.start();f.controller.close();await f.controller.stop();assert.equal(f.screen.stopped,1);assert.equal(f.calls.length,1);assert.equal(f.camera.enabled,false);
});
