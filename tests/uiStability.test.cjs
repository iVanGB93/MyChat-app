const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText;
test('foreground poll stops background timers, rejects stale work, and does not overlap',async()=>{
 let effect,change,cleanup,resolve,current,calls=0;const timers=new Set(),app={currentState:'active',addEventListener:(_,fn)=>{change=fn;return {remove(){change=null;}};}};
 const out={};new Function('require','exports','setInterval','clearInterval',compile('src/hooks/useForegroundPoll.ts'))(n=>n==='react'?{useEffect:f=>effect=f,useRef:v=>({current:v})}:{AppState:app},out,fn=>{timers.add(fn);return fn;},fn=>timers.delete(fn));
 out.useForegroundPoll(c=>{calls++;current=c;return new Promise(r=>resolve=r);},1000);cleanup=effect();assert.equal(calls,1);[...timers][0]();assert.equal(calls,1);
 app.currentState='background';change();assert.equal(timers.size,0);assert.equal(current(),false);
 app.currentState='active';change();assert.equal(calls,1);resolve();await Promise.resolve();[...timers][0]();assert.equal(calls,2);assert.equal(current(),true);cleanup();assert.equal(current(),false);assert.equal(timers.size,0);resolve();
});
test('render boundary hides exception text, reports failure and retries without deleting data',()=>{
 const reports=[],React={Component:class {constructor(props){this.props=props;}setState(next){Object.assign(this.state,next);}},createElement:(type,props,...children)=>({type,props,children})},out={};
 new Function('require','exports',compile('src/components/ui/RenderBoundary.tsx'))(n=>n==='react'?{default:React,...React}:n==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable'}:{reportRenderFailure:(...a)=>reports.push(a)},out);
 const B=out.default,b=new B({children:'screen',scope:'screens'});assert.equal(b.render(),'screen');b.state=B.getDerivedStateFromError();const error=Error('private chat content');b.componentDidCatch(error);const fallback=b.render();assert(!JSON.stringify(fallback).includes(error.message));assert.equal(reports.length,1);const retry=fallback.children.find(c=>c?.type==='Pressable');retry.props.onPress();assert.equal(b.render(),'screen');
});
