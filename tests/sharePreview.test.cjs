const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText;
const code=compile('src/components/chat/MediaViewer.tsx');
function fixture(items,thumbnail=async()=>null,options={}){
 const states=new Map(),refs=new Map(),effects=[],scrolls=[],updates=[];
 let key='viewer',cursor=0;
 const react={
  createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState(initial){const name=key+':'+cursor++;if(!states.has(name))states.set(name,typeof initial==='function'?initial():initial);return [states.get(name),value=>states.set(name,typeof value==='function'?value(states.get(name)):value)];},
  useRef(initial){const name=key+':'+cursor++;if(!refs.has(name))refs.set(name,{current:initial===null?{scrollToOffset:x=>scrolls.push(x)}:initial});return refs.get(name);},
  useMemo:fn=>fn(),useEffect(fn){effects.push(fn);},
 };
 const imports={
  '../../modules/storage':{selectedVideoThumbnail:thumbnail},'./ZoomablePhotoPreview':{default:'ZoomPhoto'},react:{default:react,...react},
  'react-native':{ActivityIndicator:'Spinner',FlatList:'List',Modal:'Modal',Pressable:'Button',Text:'Text',View:'View',useWindowDimensions:()=>({width:400,height:800})},
  'expo-image':{Image:'Image'},'expo-file-system':{File:class{}},'@expo/vector-icons':{Ionicons:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:24,bottom:16,left:0,right:0})},
  '../../theme':require('./helpers/theme.cjs'),'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../modules/ui/openAttachmentPreview':{},
  '../../modules/identity':{localAccount:{status:()=>({account:'owner',state:'unlocked'})}},'../../modules/media':{attachmentDigest:m=>m.id,attachmentContentDigest:m=>m.id},
  './useAttachmentFile':{useAttachmentFile:options.readFile??(()=>null),useAttachmentPreview:options.readPreview??(()=>null)},'../ui/ScreenHeader':{default:'Header'},
  '../ui/KeyboardForm':{KeyboardAvoidingScreen:'Screen',KeyboardAwareTextInput:'Caption'},'../ui/StatusBarFade':{default:'StatusFade'},'./photo-editor':{default:'Editor'},
 };
 const api={};new Function('exports','require',code)(api,n=>{const localized=require('./helpers/localization.cjs')(n);if(localized)return localized;assert(n in imports,n);return imports[n];});
 const props={items,visible:true,busy:false,onClose(){},...options.props};
 if(options.review!==false)props.review={
  onRemove:id=>props.items=props.items.filter(i=>i.id!==id),onSend(){throw Error('must not send');},
  onUpdate:(id,change)=>{updates.push({id,change});props.items=props.items.map(i=>i.id===id?{...i,...change}:i);},
 };
 function renderComponent(scope,type,p){key=scope;cursor=0;return type(p);}
 return {props,updates,scrolls,effects,render:()=>renderComponent('viewer',api.default,props),
  child:node=>renderComponent(node.type.name+':'+node.props.item.id,node.type,node.props)};
}
function all(n){return !n||typeof n!=='object'?[]:[n,...(n.props?.children??[]).flat(Infinity).flatMap(all)];}
const pager=nodes=>nodes.find(n=>n.props.testID==='axonic-media-pages');
const thumbs=nodes=>nodes.find(n=>n.props.testID==='axonic-media-thumbnails');
const button=(nodes,label)=>nodes.find(n=>n.props.accessibilityLabel===label);
const photos=()=>[{id:'a',uri:'file:///a.jpg',name:'secret-name.jpg',kind:'image',size:2048},{id:'b',uri:'file:///b.jpg',name:'other.jpg',kind:'image',size:4096}];
function thumbnailButton(f,nodes,index){
 const list=thumbs(nodes);return f.child(list.props.renderItem({item:list.props.data[index],index}));
}
function slide(f,nodes,item){
 const page=all(pager(nodes).props.renderItem({item}));
 return all(f.child(page.find(n=>n.type.name==='MediaSlide')));
}
test('single image is a preview, with no editor, thumbnail strip or filename',()=>{
 const f=fixture(photos().slice(0,1)),nodes=all(f.render());
 assert(nodes.some(n=>n.type==='Header'&&n.props.title==='Review photo'));
 assert(!nodes.some(n=>n.type==='Editor'||n.props.testID==='axonic-media-thumbnails'));
 assert(!nodes.some(n=>n.type==='Text'&&n.props.children.includes('secret-name.jpg')));
 assert(nodes.some(n=>n.type==='Text'&&n.props.children.includes('2.0 KB')));
 assert.equal(pager(nodes).props.scrollEnabled,false);
});
test('thumbnail jump and swipe keep captions attached to their own photo',()=>{
 const f=fixture(photos());let nodes=all(f.render());
 nodes.find(n=>n.type==='Caption').props.onChangeText('first');nodes=all(f.render());
 thumbnailButton(f,nodes,1).props.onPress();nodes=all(f.render());nodes.find(n=>n.type==='Caption').props.onChangeText('second');
 pager(nodes).props.onMomentumScrollEnd({nativeEvent:{contentOffset:{x:0}}});
 assert.equal(all(f.render()).find(n=>n.type==='Caption').props.value,'first');
 assert.deepEqual(f.updates.map(x=>x.id),['a','b']);assert.equal(f.scrolls[0].offset,400);
});
test('edit is opt-in and saves changes only to the edited item',()=>{
 const f=fixture(photos());let nodes=all(f.render());
 button(nodes,'Edit photo').props.onPress();const editor=all(f.render()).find(n=>n.type==='Editor');
 assert.equal(editor.props.floatingTools,true);editor.props.onClose();assert.equal(f.updates.length,0);
 button(all(f.render()),'Edit photo').props.onPress();
 all(f.render()).find(n=>n.type==='Editor').props.onSave({uri:'file:///edited.jpg',width:800,height:600});
 assert.equal(f.updates[0].id,'a');assert.equal(f.props.items[1].uri,'file:///b.jpg');assert.equal(f.props.items[0].size,undefined);
 assert(!all(f.render()).some(n=>n.type==='Editor'));
});
test('removing the selected last photo leaves the remaining review usable',()=>{
 const f=fixture(photos());thumbnailButton(f,all(f.render()),1).props.onPress();
 button(all(f.render()),'Remove attachment').props.onPress();const nodes=all(f.render());
 assert(!thumbs(nodes));assert.equal(pager(nodes).props.data[0].id,'a');
});
test('zoom locks horizontal paging until the current photo resets',()=>{
 const f=fixture(photos());const page=slide(f,all(f.render()),f.props.items[0]).find(n=>n.type==='ZoomPhoto');
 page.props.onZoomChange(true);assert.equal(pager(all(f.render())).props.scrollEnabled,false);
 page.props.onZoomChange(false);assert.equal(pager(all(f.render())).props.scrollEnabled,true);
});
test('video frame is reused by the active slide and thumbnail',async()=>{
 const video={id:'v',uri:'content://media/video/1',name:'movie.mp4',kind:'video',mimeType:'video/mp4'};
 const calls=[],f=fixture([video,...photos()],async uri=>{calls.push(uri);return 'data:image/jpeg;base64,frame';});
 const nodes=all(f.render());slide(f,nodes,video);thumbnailButton(f,nodes,0);
 f.effects.forEach(start=>start());await new Promise(setImmediate);
 assert(slide(f,nodes,video).some(n=>n.type==='Image'&&n.props.source.uri==='data:image/jpeg;base64,frame'));
 assert(all(thumbnailButton(f,nodes,0)).some(n=>n.type==='Image'&&n.props.source.uri==='data:image/jpeg;base64,frame'));
 assert(slide(f,nodes,video).some(n=>n.props.accessibilityLabel==='Play video'));
 assert.deepEqual(calls,[video.uri]);
});
test('chat mode opens the tapped item, keeps it selected across older pages, and offers no editing or sending',()=>{
 let loads=0;const f=fixture(photos(),undefined,{review:false,props:{initialId:'b',older:{loading:false,load:()=>loads++}}});
 let nodes=all(f.render());assert.equal(pager(nodes).props.initialScrollIndex,1);
 assert(!nodes.some(n=>n.type==='Header'));
 assert(nodes.some(n=>n.type==='StatusFade'));
 const back=button(nodes,'Close media viewer');
 assert(nodes.some(n=>n.props.style?.position==='absolute'&&n.props.style.top===32&&all(n).includes(back)));
 assert(nodes.some(n=>Array.isArray(n.props.style)&&n.props.style.some(s=>s?.position==='absolute'&&s.bottom===22)&&all(n).includes(thumbs(nodes))));
 assert.equal(thumbnailButton(f,nodes,1).props.accessibilityState.selected,true);
 assert(!button(nodes,'Edit photo'));assert(!button(nodes,'Send attachments'));
 nodes.find(n=>n.type==='Button'&&all(n).some(child=>child.props.children.includes('Load older media'))).props.onPress();
 assert.equal(loads,1);f.props.items=[{...photos()[0],id:'older'},...f.props.items];nodes=all(f.render());
 assert.equal(thumbnailButton(f,nodes,2).props.accessibilityState.selected,true);
 assert(slide(f,nodes,f.props.items[2]).find(n=>n.type==='ZoomPhoto').props.active);
});
test('chat media files resolve only when a slide or thumbnail mounts',()=>{
 const local={owner:'owner',fileKey:'digest',delivery:'pending'};
 const readCalls=[],f=fixture([{id:'remote',kind:'image',name:'Remote photo',local}],undefined,{review:false,readFile:(...args)=>{readCalls.push(args);return null;}});
 const nodes=all(f.render());assert.deepEqual(readCalls,[]);
 assert(slide(f,nodes,f.props.items[0]).some(n=>n.props.children.includes('Not available on this device')));
 assert.deepEqual(readCalls,[['owner','digest','pending']]);
});

test('chat gallery includes saved v4 media and keeps group order while excluding stickers and deleted media',()=>{
 const api={};
 const modules={
  react:{},'../../modules/messaging':{hasConfirmedDelivery:m=>m.status==='delivered'},
  '../../modules/storage':{chatMediaPresentation:m=>m.localMedia??(m.attachment&&{...m.attachment,bytes:100,fileKey:m.id})},
  '../../modules/media':{attachmentTransferPresentation:m=>m.status==='pending'?{expires:12345}:undefined},
  '../../modules/ui/liveState':{},'../../services/group-avatar-file':{isGroupAvatarFile:a=>a.name==='avatar'},
  '../../services/sticker-file-format':{IMPORTED_STICKER_CONTENT:'sticker'},'./MediaViewer':{},
 };
 new Function('exports','require',compile('src/components/chat/useChatMediaViewer.tsx'))(api,n=>modules[n]);
 const make=(id,at,peer='peer')=>({id,at,peer,direction:'incoming',status:'delivered',attachment:{mime:'image/jpeg',name:id,manifest:{bytes:100}}});
 const older=make('first',1),photo=make('photo',2),movie=make('movie',3);
 movie.attachment.mime='video/mp4';movie.status='pending';
 photo.group={id:'group',messageId:'same'};movie.group=photo.group;movie.peer='other';
 const sticker=make('sticker',4),avatar=make('avatar',5),removed=make('removed',6);
 avatar.group={id:'group',messageId:'avatar'};removed.deleted=true;
 const retired=make('retired',7);delete retired.attachment;retired.localMedia={name:'saved.jpg',mime:'image/jpeg',bytes:4200,fileKey:'saved-file-key'};
 const items=api.conversationMediaItems([retired,removed,avatar,sticker,movie,photo,older],'owner');
 assert.deepEqual(items.map(item=>item.name),['first','photo','movie','saved.jpg']);
 assert.deepEqual(items[3].local,{owner:'owner',fileKey:'saved-file-key',previewKey:undefined,downloadUntil:undefined,delivery:'delivered'});
 assert.notEqual(items[1].id,items[2].id);
 assert.equal(items[2].kind,'video');assert.equal(items[2].local.downloadUntil,12345);
 assert(items.every(item=>item.local.owner==='owner'&&!('uri' in item)));
});

test('saved v4 viewer loads the local file key and shows a missing file without a download spinner',()=>{
 const item={id:'saved',name:'saved.jpg',kind:'image',local:{owner:'owner',fileKey:'saved-file-key',delivery:'pending',downloadUntil:Date.now()+60000}};
 const reads=[],present=fixture([item],undefined,{review:false,readFile:(...args)=>{reads.push(args);return {uri:'content://media/1'};}});
 assert(slide(present,all(present.render()),item).some(n=>n.type==='ZoomPhoto'&&n.props.uri==='content://media/1'));
 assert.deepEqual(reads,[['owner','saved-file-key','pending']]);
 const expired={...item,local:{...item.local,downloadUntil:undefined}};
 const missing=fixture([expired],undefined,{review:false});
 const nodes=slide(missing,all(missing.render()),expired);
 assert(nodes.some(n=>n.props.children.includes('Not available on this device')));
 assert(!nodes.some(n=>n.type==='Spinner'));
});
