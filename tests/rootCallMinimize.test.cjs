const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(status='ready'){
 const effects=[];let appListener,routeListener,preview=null;const chosen=[];const routes={automatic:true,selectedId:'bt',devices:[{id:'phone',kind:'phone',label:'Phone',name:''},{id:'speaker',kind:'speaker',label:'Speaker',name:''},{id:'bt',kind:'bluetooth',label:'Bluetooth',name:'Test headset'}]};const app={currentState:'active',addEventListener:(_,fn)=>{appListener=fn;return {remove(){}};}};
 const call={id:'one',peerUser:'peer',outgoing:true,media:'video',status,transport:{}},slots=new Map();let current,index,ended=0;
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState:initial=>{const i=index++;if(!(i in current))current[i]=initial;return [current[i],value=>current[i]=typeof value==='function'?value(current[i]):value];},
  useRef:initial=>{const i=index++;return current[i]??=( {current:initial});},useEffect:fn=>effects.push(fn),useCallback:fn=>fn};
 // Setters capture their component's hook storage, as React does.
 react.useState=initial=>{const own=current,i=index++;if(!(i in own))own[i]=initial;return [own[i],value=>own[i]=typeof value==='function'?value(own[i]):value];};
 const rtc={remoteStream:{toURL:()=> 'remote'},localStream:{toURL:()=> 'local'},callQuality:{level:'unknown'}};
 const imports={'../../services/call-screen-capture':{callScreenCaptureAvailable:true},'../../hooks/useRingingCameraPreview':{default:(_id,enabled)=>enabled?preview:null},react:{default:react,...react},'react-native':{Modal:'Modal',View:'View',Pressable:'Pressable',Text:'Text',AppState:app,Platform:{OS:'android'},StyleSheet:{absoluteFill:{}}},
  '../../modules/identity':{shortIdentity:()=> 'Peer'},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},
  '../../modules/messaging':{localAccountCalls:()=>({end:()=>{ended++;return Promise.resolve();}})},
  './CallStage':{CallLayout:'CallLayout',EndButton:'EndButton'},'./CallAppearance':{makeStyles:()=>({}),ActionButton:'ActionButton'},
  'expo-keep-awake':{useKeepAwake:()=>{}},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,right:0,bottom:0,left:0})},
  '../../hooks/useWebRTCCore':{default:()=>rtc},
  '@expo/vector-icons':{Ionicons:'Icon'},'react-native-webrtc':{RTCView:'RTCView'}};
 imports['../../services/call-audio-route']={startCallAudio:async()=>routes,getCallAudioRoutes:async()=>routes,
  observeCallAudioRoutes:fn=>{routeListener=fn;return {remove(){}};},selectCallAudioRoute:async id=>{chosen.push(id);return {...routes,automatic:id==='automatic',selectedId:id==='automatic'?'bt':id};}};
 let permission=async()=>true;
 imports['../../hooks/useScreenShareOverlay']={hasScreenShareOverlay:()=>false,allowScreenShareOverlay:()=>permission(),useScreenShareOverlay:()=>{}};
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/screens/calls/RootAccountCallScreen.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,n=>imports[n]??{});
 function render(type,props={}){effects.length=0;current=slots.get(type)??[];slots.set(type,current);index=0;if(type===out.default&&!current.length)current[0]=call;return type(props);}
 const screen=()=>render(out.default);
 return {call,rtc,render,screen,setPermission:fn=>permission=fn,setPreview:url=>preview=url,ended:()=>ended,chosen,audioListen:()=>effects.find(fn=>fn.toString().includes('startCallAudio'))(),routeUpdate:next=>routeListener(next),listen:()=>effects[0](),appState:state=>{app.currentState=state;appListener?.(state);}};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return; if(predicate(tree))return tree;for(const child of tree.props?.children??[]){const result=Array.isArray(child)?child.map(x=>find(x,predicate)).find(Boolean):find(child,predicate);if(result)return result;}}
test('camera fills the call stage while shared screens remain uncropped',()=>{
 const f=fixture(),owner=f.screen();
 const video=()=>{const tree=f.render(owner.type,owner.props);return find(find(tree,n=>n.type==='CallLayout')?.props.background??find(tree,n=>n.props.testID==='axonic-screen-share-stage'),n=>n.type==='RTCView');};
 assert.equal(video().props.objectFit,'cover');
 f.rtc.remoteScreenSharing=true;assert.equal(video().props.objectFit,'contain');
 f.rtc.remoteScreenSharing=false;assert.equal(video().props.objectFit,'cover');
 f.rtc.remoteStream=null;f.rtc.isScreenSharing=true;assert.equal(video().props.objectFit,'contain');
});

test('outgoing Finding and its failure stay out of the global ringing modal',()=>{
 const f=fixture('finding');assert.equal(f.screen(),null);f.call.status='ended';assert.equal(f.screen(),null);
 f.call.status='ringing';assert.equal(f.screen().type,'Modal');
 const incoming=fixture('ringing');incoming.call.outgoing=false;assert.equal(incoming.screen().type,'Modal');
});
test('caller and recipient video ringing use a mirrored local preview, but voice ringing does not',()=>{
 const caller=fixture('ringing');caller.setPreview('local-preview');let tree=caller.screen();
 const layout=find(tree,n=>n.type==='CallLayout');assert.equal(layout.props.background.props.streamURL,'local-preview');assert.equal(layout.props.background.props.mirror,true);assert.equal(layout.props.avatar,false);
 caller.call.media='voice';tree=caller.screen();assert.equal(find(tree,n=>n.type==='CallLayout').props.background,undefined);
 const recipient=fixture('ringing');recipient.call.outgoing=false;recipient.setPreview('local-preview');
 assert(find(recipient.screen(),n=>n.props.localPreviewUrl==='local-preview'));
});

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

test('voice and video options select connected audio outputs and remove disconnected devices',async()=>{
 for(const media of ['voice','video']){
  const f=fixture();f.call.media=media;const owner=f.screen();let tree=f.render(owner.type,owner.props);
  f.audioListen();await Promise.resolve();await Promise.resolve();tree=f.render(owner.type,owner.props);
  const button=find(tree,n=>n.props.label===(media==='voice'?'Audio':'Options'));assert(button);button.props.onPress();
  tree=f.render(owner.type,owner.props);assert(find(tree,n=>n.type==='Modal'&&n.props.visible&&n.props.transparent));
  const bluetooth=find(tree,n=>n.props.accessibilityLabel==='Bluetooth: Test headset');assert(bluetooth);
  await bluetooth.props.onPress();await Promise.resolve();await Promise.resolve();tree=f.render(owner.type,owner.props);
  assert.deepEqual(f.chosen,['bt']);assert.equal(find(tree,n=>n.props.accessibilityLabel==='Bluetooth: Test headset').props.accessibilityState.checked,true);
  f.routeUpdate({automatic:true,selectedId:'phone',devices:[{id:'phone',kind:'phone',label:'Phone',name:''},{id:'speaker',kind:'speaker',label:'Speaker',name:''}]});
  tree=f.render(owner.type,owner.props);assert(!find(tree,n=>n.props.accessibilityLabel==='Bluetooth: Test headset'));
  assert.equal(find(tree,n=>n.props.accessibilityLabel==='Automatic').props.accessibilityState.checked,true);assert.equal(f.ended(),0);
 }
});


test('connection quality sits beneath self-view and never above video call buttons',()=>{
 const f=fixture();f.rtc.callQuality={level:'good',roundTripTimeMs:25,packetLossPercent:0};const owner=f.screen();
 let tree=f.render(owner.type,owner.props),layout=find(tree,n=>n.type==='CallLayout');
 const self=find(layout.props.background,n=>n.props.testID==='axonic-call-self-view');assert(self);
 const quality=find(self,n=>n.props.testID==='axonic-call-connection-quality');assert(quality);
 assert(find(quality,n=>n.props.children?.includes('GOOD')));
 assert(!find(layout,n=>n.props.testID==='axonic-call-connection-quality'),'call actions contain no duplicate quality indicator');
 assert.equal(find(find(tree,n=>n.props.testID==='axonic-minimize-call'),n=>n.type==='Icon').props.name,'chevron-forward');
 find(layout.props.background,n=>n.props.accessibilityLabel==='Hide call controls').props.onPress();
 tree=f.render(owner.type,owner.props);layout=find(tree,n=>n.type==='CallLayout');
 assert.equal(layout.props.show,false);assert(!find(tree,n=>n.props.testID==='axonic-minimize-call'));
 assert(!find(layout.props.background,n=>n.props.testID==='axonic-call-connection-quality'));
 assert(find(layout.props.background,n=>n.props.testID==='axonic-call-self-view'),'self-view remains visible');
 find(layout.props.background,n=>n.props.accessibilityLabel==='Show call controls').props.onPress();
 tree=f.render(owner.type,owner.props);layout=find(tree,n=>n.type==='CallLayout');
 assert.equal(layout.props.show,true);assert(find(tree,n=>n.props.testID==='axonic-minimize-call'));
 assert(find(layout.props.background,n=>n.props.testID==='axonic-call-connection-quality'));
 f.call.media='voice';tree=f.render(owner.type,owner.props);assert(!find(find(tree,n=>n.type==='CallLayout').props.background,n=>n.props.testID==='axonic-call-self-view'));
});

test('native video rectangle stays within the rounded self-view frame even without surface clipping',()=>{
 const out={},theme={Radius:{lg:16},Spacing:{md:16,lg:24},Font:{size:{xs:12}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/screens/calls/CallAppearance.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,n=>n==='react-native'?{Platform:{OS:'android'},StyleSheet:{create:x=>x,absoluteFillObject:{}}}:n==='../../theme'?theme:{});
 const styles=out.makeStyles({}),frame=styles.pipWrap,inset=frame.padding+frame.borderWidth,radius=frame.borderRadius;
 assert(2*(radius-inset)**2<=radius**2,'each rectangular video corner is inside the rounded border');
 assert.equal(styles.pip.overflow,'hidden');assert.equal(frame.overflow,'hidden');assert.equal(frame.position,undefined,'only the whole self-view group is positioned');
});

test('screen sharing uses an unmirrored preview, offers Stop share, and hides camera flip',async()=>{
 const f=fixture();let started=0,stopped=0;f.rtc.startScreenSharing=()=>started++;f.rtc.stopScreenSharing=()=>stopped++;
 const owner=f.screen();let tree=f.render(owner.type,owner.props);
 find(tree,n=>n.props.accessibilityLabel==='Share screen').props.onPress();await Promise.resolve();assert.equal(started,1);
 f.rtc.isScreenSharing=true;f.rtc.isCameraOff=true;tree=f.render(owner.type,owner.props);
 assert(!find(tree,n=>n.props.label==='Flip'));find(tree,n=>n.props.label==='Stop sharing').props.onPress();assert.equal(stopped,1);
 const stage=find(tree,n=>n.props.testID==='axonic-screen-share-stage');assert(stage);
 const preview=find(stage,n=>n.type==='RTCView');assert.equal(preview.props.mirror,false);assert.equal(preview.props.objectFit,'contain');
 assert(find(stage,n=>n.props.testID==='axonic-screen-share-controls'));assert(!find(stage,n=>n.props.testID==='axonic-call-self-view'));
 find(tree,n=>n.props.accessibilityLabel==='Stop sharing screen').props.onPress();assert.equal(stopped,2);
});

test('remote screen retains normal call controls and camera preview without sender controls',()=>{
 const f=fixture();f.rtc.remoteScreenSharing=true;const owner=f.screen(),tree=f.render(owner.type,owner.props);
 const layout=find(tree,n=>n.type==='CallLayout');assert(layout);
 assert(!find(tree,n=>n.props.testID==='axonic-screen-share-stage'));
 assert(!find(tree,n=>n.props.testID==='axonic-screen-share-controls'));
 const screen=find(layout.props.background,n=>n.type==='RTCView');assert.equal(screen.props.streamURL,'remote');assert.equal(screen.props.objectFit,'contain');
 assert(find(layout.props.background,n=>n.props.testID==='axonic-call-self-view'));
 assert(find(tree,n=>n.props.label==='Mute'));assert(find(tree,n=>n.props.label==='Options'));
});
test('sharing waits for permission settings and resumes once after approval',async()=>{
 const f=fixture();let resolve,started=0,requests=0;
 f.setPermission(()=>{requests++;return new Promise(r=>resolve=r);});f.rtc.startScreenSharing=async()=>{started++;};
 const owner=f.screen(),tree=f.render(owner.type,owner.props),share=find(tree,n=>n.props.accessibilityLabel==='Share screen');
 share.props.onPress();share.props.onPress();assert.equal(requests,1);assert.equal(started,0);
 resolve(true);await Promise.resolve();await Promise.resolve();assert.equal(started,1);
});
test('denied overlay permission does not start capture',async()=>{
 const f=fixture();let started=0;f.setPermission(async()=>false);f.rtc.startScreenSharing=async()=>{started++;};
 const owner=f.screen(),tree=f.render(owner.type,owner.props);find(tree,n=>n.props.accessibilityLabel==='Share screen').props.onPress();
 await Promise.resolve();await Promise.resolve();assert.equal(started,0);
});
