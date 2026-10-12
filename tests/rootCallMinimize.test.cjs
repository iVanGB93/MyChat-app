const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(status='ready'){
 const effects=[];let appListener;const app={currentState:'active',addEventListener:(_,fn)=>{appListener=fn;return {remove(){}};}};
 const call={id:'one',peerUser:'peer',outgoing:true,media:'video',status,transport:{}},slots=new Map();let current,index,ended=0;
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState:initial=>{const i=index++;if(!(i in current))current[i]=initial;return [current[i],value=>current[i]=typeof value==='function'?value(current[i]):value];},
  useRef:initial=>{const i=index++;return current[i]??=( {current:initial});},useEffect:fn=>effects.push(fn),useCallback:fn=>fn};
 // Setters capture their component's hook storage, as React does.
 react.useState=initial=>{const own=current,i=index++;if(!(i in own))own[i]=initial;return [own[i],value=>own[i]=typeof value==='function'?value(own[i]):value];};
 const imports={react:{default:react,...react},'react-native':{Modal:'Modal',View:'View',Pressable:'Pressable',Text:'Text',AppState:app,Platform:{OS:'android'},StyleSheet:{absoluteFill:{}}},
  '../../modules/identity':{shortIdentity:()=> 'Peer'},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},
  '../../modules/messaging':{localAccountCalls:()=>({end:()=>{ended++;return Promise.resolve();}})},
  './CallStage':{CallLayout:'CallLayout',EndButton:'EndButton'},'./CallAppearance':{makeStyles:()=>({}),ActionButton:'ActionButton'},
  'expo-keep-awake':{useKeepAwake:()=>{}},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,right:0,bottom:0,left:0})},
  '../../hooks/useWebRTCCore':{default:()=>({remoteStream:{toURL:()=> 'remote'},localStream:{toURL:()=> 'local'},callQuality:{level:'unknown'}})},
  '@expo/vector-icons':{Ionicons:'Icon'},'react-native-webrtc':{RTCView:'RTCView'}};
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/screens/calls/RootAccountCallScreen.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,n=>imports[n]??{});
 function render(type,props={}){effects.length=0;current=slots.get(type)??[];slots.set(type,current);index=0;if(type===out.default&&!current.length)current[0]=call;return type(props);}
 const screen=()=>render(out.default);
 return {call,render,screen,ended:()=>ended,listen:()=>effects[0](),appState:state=>{app.currentState=state;appListener?.(state);}};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return; if(predicate(tree))return tree;for(const child of tree.props?.children??[]){const result=Array.isArray(child)?child.map(x=>find(x,predicate)).find(Boolean):find(child,predicate);if(result)return result;}}

test('Back minimizes a live video call and restoring retains the same mounted media owner',()=>{
 const f=fixture(),first=f.screen(),full=f.render(first.type,first.props);
 const modal=find(full,n=>n.type==='Modal'&&n.props.visible===true);modal.props.onRequestClose();
 const minimized=f.screen();assert.equal(minimized.type,first.type);assert.equal(minimized.props.key,first.props.key);assert.equal(minimized.props.call.transport,first.props.call.transport);
 const small=f.render(minimized.type,minimized.props);assert.equal(find(small,n=>n.type==='Modal').props.visible,false);assert.equal(f.ended(),0);
 const window=find(small,n=>typeof n.type==='function'&&n.props.restore);window.props.restore();
 const restored=f.screen();assert.equal(restored.type,first.type);assert.equal(restored.props.key,first.props.key);assert.equal(restored.props.minimized,false);assert.equal(f.ended(),0);
 minimized.props.end();assert.equal(f.ended(),1);
});
test('Back minimizes ringing and connecting calls; only Close dismisses an ended call',()=>{
 for(const status of ['ringing','connecting']){const f=fixture(status),screen=f.screen();screen.props.onRequestClose();const small=f.screen();assert.equal(typeof small.type,'function');assert.equal(f.ended(),0);small.props.restore();assert.equal(f.screen().type,'Modal');}
 const f=fixture('ended');f.screen().props.onRequestClose();assert.equal(f.screen(),null);assert.equal(f.ended(),0);
});
test('minimized state is scoped to the call id and ended minimized calls disappear',()=>{
 const f=fixture('connecting');f.screen().props.onRequestClose();f.call.status='ended';assert.equal(f.screen(),null);
 f.call.id='two';f.call.status='connecting';assert.equal(f.screen().type,'Modal');
});
test('Home puts video on the Activity surface, hides call dialogs and retains the media owner on return',()=>{
 const f=fixture(),owner=f.screen();f.render(owner.type,owner.props);f.listen();f.appState('background');
 const homeOwner=f.screen();assert.equal(homeOwner.type,owner.type);assert.equal(homeOwner.props.key,owner.props.key);
 const home=f.render(homeOwner.type,homeOwner.props),surface=find(home,n=>n.props.testID==='axonic-system-call-window');assert(surface);assert.equal(find(surface,n=>n.type==='RTCView').props.streamURL,'remote');assert.equal(find(home,n=>n.type==='Modal').props.visible,false);assert.equal(f.ended(),0);
 f.appState('active');const restored=f.render(owner.type,owner.props);assert(!find(restored,n=>n.props.testID==='axonic-system-call-window'));assert.equal(find(restored,n=>n.type==='Modal').props.visible,true);assert.equal(f.ended(),0);
});
