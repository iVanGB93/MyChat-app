const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {load}=require('./helpers/attachment.cjs');
function evaluate(file,requireMock){
 const out={};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9,jsx:2,esModuleInterop:true}}).outputText;
 new Function('exports','require',js)(out,requireMock);return out;
}
test('message rows skip equivalent projections but repaint changed receipts, highlights or reply targets',()=>{
 const {default:compare}=evaluate('src/components/chat/ChatMessageRow.tsx',name=>name==='react'?{memo:(_row,equal)=>equal}:name.endsWith('/useChatSnapshot')?{retainEqualChatProps:load('sharedState').retainEqual}:{});
 const callback=()=>{};
 const previous={message:{id:'one',status:'pending',attachment:{manifest:{id:'file'}}},quoted:{id:'two',text:'hello'},highlighted:false,onJump:callback};
 assert.equal(compare(previous,{...previous,message:structuredClone(previous.message),quoted:{...previous.quoted}}),true);
 for(const next of [{...previous,message:{...previous.message,status:'delivered'}},{...previous,highlighted:true},{...previous,quoted:{...previous.quoted,text:'edited'}},{...previous,onJump:()=>{}}])assert.equal(compare(previous,next),false);
});
test('wide video previews fit the bubble border in both directions',()=>{
 const native={StyleSheet:{create:styles=>styles},View:'View',Text:'Text',Pressable:'Pressable'};
 const layout=evaluate('src/components/chat/message-bubble-styles.ts',name=>name==='react-native'?native:require('./helpers/theme.cjs'));
 const react={createElement:(type,props,...children)=>({type,props,children}),memo:component=>component,useMemo:fn=>fn(),useState:()=>[undefined,()=>{}]};
 const {default:render}=evaluate('src/components/chat/ChatMessageRow.tsx',name=>({
  react,'react-native':native,'./message-bubble-styles':layout,'../../localization/useLanguage':{useLanguage(){}},
  '../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../modules/storage':{chatMediaPresentation:m=>m.localMedia},
  '../../modules/messaging':{pendingMessages:{layoutCallback:()=>undefined}},
 }[name]??{}));
 function bubble(tree){if(tree?.type==='Pressable')return tree;for(const child of tree?.children??[]){const match=bubble(child);if(match)return match;}}
 const preview={width:1920,height:1080};
 for(const direction of ['incoming','outgoing']){
  const row=render({message:{id:'video',direction,localMedia:{mime:'video/mp4',name:'video.mp4',preview}},time:'6:03'});
  const style=Object.assign({},...bubble(row).props.style.filter(Boolean));
  assert.equal(style.width-2*(style.paddingHorizontal+style.borderWidth),layout.mediaPreviewWidth(preview));
  assert.equal(layout.messageBubbleStyles.videoBubble.maxWidth,'100%');
  assert.equal(layout.messageBubbleStyles.videoBubble.borderTopRightRadius,style.borderRadius-style.paddingHorizontal-style.borderWidth);
 }
});
test('an identical measured time/status footer is available on the next row’s first render',()=>{
 let scale=1,updates=0;
 const react={createElement:(type,props,...children)=>({type,props,children}),useState:()=>[undefined,()=>updates++]};
 const {default:render}=evaluate('src/components/chat/MessageTextWithFooter.tsx',name=>name==='react'?react:name==='react-native'?{View:'View',PixelRatio:{getFontScale:()=>scale}}:{default:'SmartText',__esModule:true});
 const props={text:'a',footer:'meta',footerKey:'same'},footer=tree=>tree.children[1],spacer=tree=>tree.children[0].props.trailing;
 const first=render(props);assert.equal(spacer(first),undefined);
 footer(first).props.onLayout({nativeEvent:{layout:{width:30.1,height:12.2}}});
 const second=render({...props,text:'b'});
 assert.deepEqual(spacer(second).props.style,{width:39,height:13});
 footer(second).props.onLayout({nativeEvent:{layout:{width:30.1,height:12.2}}});
 assert.equal(updates,1);
 scale=1.25;assert.equal(spacer(render(props)),undefined);
});
test('attachment file observation publishes only changes to the observed file',()=>{
 let fileListener,foreground,changes=0,read,detach;
 const paths={one:'file://original',two:'file://other'};
 const {useAttachmentFile}=evaluate('src/components/chat/useAttachmentFile.ts',name=>{
  if(name==='react')return {useMemo:fn=>fn(),useSyncExternalStore:(subscribe,snapshot)=>{read=snapshot;detach=subscribe(()=>changes++);return snapshot();}};
  if(name==='react-native')return {AppState:{addEventListener:(_event,fn)=>{foreground=fn;return {remove(){foreground=null;}};}}};
  if(name.endsWith('/media'))return {subscribeAttachmentContentChanges:fn=>{fileListener=fn;return ()=>fileListener=null;}};
  return {rootAttachmentFile:(_owner,digest)=>({uri:paths[digest],exists:!!paths[digest]})};
 });
 useAttachmentFile('owner','one','delivered');
 paths.two=undefined;fileListener();assert.equal(changes,0);
 paths.one='content://adopted';fileListener();assert.equal(read().uri,'content://adopted');assert.equal(changes,1);
 paths.one=undefined;foreground('active');assert.equal(read(),null);assert.equal(changes,2);
 detach();assert.equal(fileListener,null);assert.equal(foreground,null);
});
