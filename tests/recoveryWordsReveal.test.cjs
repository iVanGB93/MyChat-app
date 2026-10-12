const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const phrase='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function fixture(){
 const slots=[],effects=[],deps=[];let index=0,appListener,accountListener,resolve,revealCalls=0,status={state:'unlocked',account:'owner'},visible=true;
 const app={currentState:'active',addEventListener:(_,fn)=>{appListener=fn;return {remove(){}};}};
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef:initial=>{const i=index++;return slots[i]??={current:initial};},useEffect:(fn,next)=>{const i=index++;if(!deps[i]||next.some((v,n)=>v!==deps[i][n])){deps[i]=next;effects.push(fn);}}};
 const identity={status:()=>status,subscribe:fn=>{accountListener=fn;return ()=>{};},revealRecoveryWords:async(password,owner)=>{revealCalls++;assert.equal(owner,'owner');assert.equal(password,'test password');return new Promise(r=>resolve=r);}};
 const imports={react:{default:react,...react},'react-native':{AppState:app,Modal:'Modal',Pressable:'Pressable',Text:'Text',View:'View'},'@expo/vector-icons':{Ionicons:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'../../modules/identity':{localAccount:identity,localAccountBiometrics:{available:()=>false}},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../components/ui/KeyboardForm':{KeyboardFormScrollView:'Scroll'},'../../components/ui/Input':{default:'Input'},'../../components/ui/Button':{default:'Button'}};
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/screens/profile/RecoveryWordsReveal.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,n=>imports[n]);
 const render=()=>{index=0;let tree=out.default({account:'owner',visible});while(effects.length)effects.shift()();index=0;return out.default({account:'owner',visible});};
 const begin=()=>{find(render(),n=>n.props.title==='SHOW RECOVERY WORDS').props.onPress();const tree=render();find(tree,n=>n.type==='Input').props.onChangeText('test password');find(render(),n=>n.props.title==='SHOW WITH PASSWORD').props.onPress();};
 return {render,begin,finish:()=>resolve(phrase),calls:()=>revealCalls,background:()=>{app.currentState='background';appListener('background');},lock:()=>{status={state:'locked',account:'owner'};accountListener();},hideSecurity:()=>{visible=false;render();}};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return; if(predicate(tree))return tree;for(const c of tree.props?.children??[]){const result=Array.isArray(c)?c.map(x=>find(x,predicate)).find(Boolean):find(c,predicate);if(result)return result;}}
const tick=()=>new Promise(r=>setImmediate(r));
test('words display only after fresh password authentication, then clear on Hide',async()=>{
 const f=fixture();assert(!find(f.render(),n=>n.props.title==='HIDE WORDS'));f.begin();assert.equal(f.calls(),1);assert(!find(f.render(),n=>n.props.title==='HIDE WORDS'));
 f.finish();await tick();const tree=f.render();assert(find(tree,n=>n.props.title==='HIDE WORDS'));find(tree,n=>n.props.title==='HIDE WORDS').props.onPress();assert(!find(f.render(),n=>n.props.title==='HIDE WORDS'));
});
test('backgrounding, locking or closing Security rejects a pending reveal',async()=>{
 for(const action of ['background','lock','hideSecurity']){const f=fixture();f.begin();f[action]();f.finish();await tick();assert(!find(f.render(),n=>n.props.title==='HIDE WORDS'),action);assert.equal(find(f.render(),n=>n.type==='Modal').props.visible,false);}
});
test('already-revealed words clear when the app backgrounds or Security closes',async()=>{
 for(const action of ['background','hideSecurity']){const f=fixture();f.begin();f.finish();await tick();assert(find(f.render(),n=>n.props.title==='HIDE WORDS'));f[action]();assert(!find(f.render(),n=>n.props.title==='HIDE WORDS'));}
});
