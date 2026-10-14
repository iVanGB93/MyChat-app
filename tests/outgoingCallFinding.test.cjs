const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(startStatus='finding'){
 const source=fs.readFileSync('src/navigation/RootAccountNavigator.tsx','utf8'),start=source.indexOf('function OutgoingCall('),end=source.indexOf('export default function RootAccountNavigator',start);
 const slots=[],effects=[],deps=[];let index=0,current=null,listener,beforeRemove,backs=0,starts=0,ended=[];
 const hooks={useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef:initial=>{const i=index++;return slots[i]??={current:initial};},useCallback:fn=>fn,useEffect:(fn,next)=>{const i=index++;if(!deps[i]||next.some((value,n)=>value!==deps[i][n])){deps[i]=next;effects.push(fn);}}};
 const emit=status=>{current={id:'one',status,outgoing:true,reason:status==='ended'?'Peer unavailable':undefined};listener?.(current);};
 const calls={snapshot:()=>current,end:async id=>{ended.push(id);emit('ended');}};
 const navigation={goBack:()=>backs++,addListener:(_,fn)=>{beforeRemove=fn;return ()=>{};}};
 const exports={},react={createElement:(type,props)=>({type,props})};
 const code=ts.transpileModule('export '+source.slice(start,end),{compilerOptions:{module:1,target:9,jsx:2}}).outputText;
 new Function('exports','useOwnChat','useState','useRef','useEffect','useCallback','localAccountCalls','subscribeLocalAccountCalls','startCall','OutgoingCallAppearance','nickname','React',code)(exports,()=>({state:{contacts:[]}}),hooks.useState,hooks.useRef,hooks.useEffect,hooks.useCallback,()=>calls,fn=>{listener=fn;fn(current);return()=>{};},async()=>{starts++;emit(startStatus);return 'one';},'Appearance',()=> 'Test peer',react);
 const render=()=>{index=0;const tree=exports.OutgoingCall({route:{params:{peer:'peer',kind:'video'}},navigation});while(effects.length)effects.shift()();return tree;};
 return {render,emit,backs:()=>backs,starts:()=>starts,ended:()=>ended,back:()=>{let prevented=false;beforeRemove({preventDefault:()=>prevented=true});return prevented;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('finding stays on confirmation and confirmed ringing dismisses it once',async()=>{
 const f=fixture();f.render().props.start();await tick();assert.equal(f.render().props.finding,true);assert.equal(f.backs(),0);
 f.render().props.start();await tick();assert.equal(f.starts(),1);
 f.emit('ringing');f.emit('connecting');assert.equal(f.backs(),1);
});
test('fast acceptance before start resolves also transitions to the active call',async()=>{
 const f=fixture('ready');f.render().props.start();await tick();assert.equal(f.backs(),1);assert.equal(f.ended().length,0);
});
test('finding failure stays on confirmation with feedback and allows retry',async()=>{
 const f=fixture();f.render().props.start();await tick();f.emit('ended');let tree=f.render();assert.equal(tree.props.finding,false);assert.equal(tree.props.error,'Peer unavailable');assert.equal(f.backs(),0);
 tree.props.start();await tick();assert.equal(f.starts(),2);assert.equal(f.render().props.finding,true);
});
test('Cancel and Android Back end the owned finding call before leaving',async()=>{
 for(const hardware of [false,true]){
  const f=fixture();f.render().props.start();await tick();f.render();
  if(hardware)assert.equal(f.back(),true);else f.render().props.cancel();
  await tick();assert.deepEqual(f.ended(),['one']);assert.equal(f.backs(),1);
 }
});
