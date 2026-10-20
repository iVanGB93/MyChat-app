const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(work){
 const effects=[],timers=new Map();let seq=0,change,wake;
 const app={currentState:'active',addEventListener:(_,fn)=>{change=fn;return {remove(){change=undefined;}};}};
 const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:1,target:9}}).outputText;
 const task={};new Function('exports','setTimeout','clearTimeout',compile('src/services/identity/eventDeadlineTask.ts'))(task,(fn,delay)=>{timers.set(++seq,{fn,delay});return seq;},id=>timers.delete(id));
 const hook={};new Function('exports','require',compile('src/hooks/useForegroundEvents.ts'))(hook,n=>n==='react'?{useRef:current=>({current}),useEffect:fn=>effects.push(fn)}:n==='react-native'?{AppState:app}:task);
 hook.useForegroundEvents(work,fn=>{wake=fn;return ()=>{wake=undefined;};});const stop=effects[0]();
 return {timers,stop,event:()=>wake?.(),state(value){app.currentState=value;change?.();},async flush(){for(const [id,t]of [...timers]){timers.delete(id);t.fn();}await new Promise(setImmediate);}};
}
test('foreground event reads coalesce, sleep when unchanged, and refresh on resume',async()=>{
 let reads=0;const f=fixture(async()=>{reads++;});await f.flush();assert.equal(reads,1);assert.equal(f.timers.size,0);
 for(let i=0;i<100;i++)f.event();await f.flush();assert.equal(reads,2);assert.equal(f.timers.size,0);
 f.state('background');f.event();await f.flush();assert.equal(reads,2);f.state('active');await f.flush();assert.equal(reads,3);f.stop();
});
test('event during a read is replayed; background and stopped results are stale',async()=>{
 let release,reads=0,valid;const f=fixture(async current=>{reads++;valid=current;if(reads===1)await new Promise(r=>release=r);});await f.flush();f.event();f.state('background');assert.equal(valid(),false);release();await new Promise(setImmediate);await f.flush();assert.equal(reads,1);
 f.state('active');await f.flush();assert.equal(reads,2);assert.equal(valid(),true);f.stop();assert.equal(valid(),false);assert.equal(f.timers.size,0);
});
test('a failed read has a bounded retry; unmount cancels it',async()=>{
 const f=fixture(async()=>{throw Error('temporary storage failure');});await f.flush();assert.equal(f.timers.size,1);assert([...f.timers.values()][0].delay<=5000);f.stop();assert.equal(f.timers.size,0);
});
