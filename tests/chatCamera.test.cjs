const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function setup(mode='picture'){
 let stateIndex=0,background,resolve,limit;
 const refs=[],captures=[],effects=[],deleted=[];
 let cancelled=0,stopped=0;
 const React={
  createElement:(type,props,...children)=>({type,props:props??{},children}),
  useRef:value=>{const ref={current:value};refs.push(ref);return ref;},
  useState:value=>[stateIndex++===1?true:value,()=>{}],
  useEffect:fn=>effects.push(fn),
 };
 const rn={
  ActivityIndicator:'spinner',Modal:'modal',Pressable:'button',Text:'text',View:'view',StyleSheet:{absoluteFill:{}},
  AppState:{addEventListener:(_event,fn)=>{background=fn;return{remove(){}};}},
  Easing:{linear:x=>x},
  Animated:{Value:class{setValue(){}},createAnimatedComponent:component=>component,timing:()=>({start(){},stop(){}})},
 };
 const modules={
  react:React,'react-native':rn,'expo-camera':{CameraView:'camera'},'expo-image-picker':{},'expo-image':{},
  'expo-file-system':{Paths:{cache:{uri:'file:///cache/'}},File:class{constructor(uri){this.uri=uri;}size=1024;exists=true;delete(){deleted.push(this.uri);}}},
  'react-native-svg':{Rect:'rect'},'@expo/vector-icons':{Ionicons:'icon'},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},
  '../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../modules/storage':{recentRootPhotos:()=>undefined},
 };
 const output={};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/components/chat/ChatCamera.tsx','utf8'),{
  compilerOptions:{module:1,target:9,jsx:2,esModuleInterop:true},
 }).outputText)(name=>require('./helpers/localization.cjs')(name)??modules[name],output);
 const tree=output.default({mode,onCancel:()=>cancelled++,onCapture:asset=>captures.push(asset)});
 const pending=()=>new Promise(resolveCapture=>{resolve=resolveCapture;});
 refs[0].current={
  takePictureAsync:pending,
  recordAsync:options=>{limit=options.maxDuration;return pending();},
  stopRecording:()=>{stopped++;},
 };
 effects.forEach(effect=>effect());
 function find(node,label){
  if(node.props?.accessibilityLabel===label)return node;
  for(const child of node.children??[]){
   if(child&&typeof child==='object'){const result=find(child,label);if(result)return result;}
  }
 }
 return {
  start:()=>find(tree,'Take picture').props.onPress(),
  close:()=>tree.props.onRequestClose(),
  background:()=>background('background'),
  finish:async()=>{resolve({uri:'file:///cache/test',width:800,height:600});await new Promise(r=>setImmediate(r));},
  captures,deleted,limit:()=>limit,cancelled:()=>cancelled,stopped:()=>stopped,
 };
}

test('closing camera immediately rejects a capture finishing before unmount',async()=>{
 const fixture=setup();fixture.start();fixture.close();await fixture.finish();
 assert.equal(fixture.captures.length,0);assert.equal(fixture.cancelled(),1);
});
test('background cancellation rejects a late capture',async()=>{
 const fixture=setup();fixture.start();fixture.background();await fixture.finish();assert.equal(fixture.captures.length,0);
});
test('active camera delivers one successful capture',async()=>{
 const fixture=setup();fixture.start();fixture.start();await fixture.finish();
 assert.equal(fixture.captures.length,1);assert.equal(fixture.captures[0].mimeType,'image/jpeg');
});
test('video mode starts when ready and uses the camera native five-second cap',async()=>{
 const fixture=setup('video');assert.equal(fixture.limit(),5);await fixture.finish();
 assert.equal(fixture.captures.length,1);assert.equal(fixture.captures[0].mimeType,'video/mp4');
});
test('closing a recording stops capture and discards its result',async()=>{
 const fixture=setup('video');fixture.close();await fixture.finish();
 assert.equal(fixture.stopped(),1);assert.equal(fixture.captures.length,0);
 assert.deepEqual(fixture.deleted,['file:///cache/test']);
});
