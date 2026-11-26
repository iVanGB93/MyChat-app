const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function menu(attachment,saved=false,name='custom'){
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}})},noop=()=>{};
 const mocks={react,'react-native':{Modal:'Modal',Pressable:'Pressable',Text:'Text',TouchableOpacity:'Action',View:'View',ScrollView:'ScrollView',useWindowDimensions:()=>({height:800})},'@expo/vector-icons':{Ionicons:'Icon'},'expo-clipboard':{},'../SmartMessageText':{getFirstMessageUrl:()=>null},'../../services/stickers':{parseSticker:text=>text==='builtin'?{id:'hello'}:undefined},'../../services/imported-stickers':{},'../../services/sticker-file-format':{IMPORTED_STICKER_CONTENT:'custom'},'../ui/ThemedAlert':{ThemedAlert:{}},'../../modules/identity':{localAccount:{status:()=>({account:'owner'})}},'../../modules/storage':{chatMediaPresentation:m=>m.attachment&&{...m.attachment,fileKey:'digest'}},'./useAttachmentFile':{useAttachmentFile:(_owner,key)=>key?{exists:true,...(saved?{contentUri:"content://media/external/images/1"}:{})}:null},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../modules/messaging':{ROOT_REACTIONS:[]},'./chat-room-styles':{chatRoomStyles:{}},'../../localization/language':{t:x=>x}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/components/chat/RootMessageMenu.tsx','utf8'),{compilerOptions:{module:1,jsx:2,esModuleInterop:true}}).outputText)(n=>{if(!(n in mocks))throw Error(n);return mocks[n];},out);
 const events=[];const tree=out.default({message:{direction:'outgoing',text:'builtin',...(attachment?{text:name,attachment:{name,manifest:{},mime:'image/png'}}:{})},close:()=>events.push('close'),copy:noop,reply:()=>events.push('reply'),forward:noop,edit:noop,remove:noop,react:noop,info:noop,createSticker:noop});
 const actions=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type==='Action')actions.push(n);for(const c of (n.props?.children??[]).flat(Infinity))walk(c);}walk(tree);return {actions,events};
}
test('built-in and image stickers share message actions without raw text copy/edit',()=>{
 for(const image of [false,true]){const f=menu(image),labels=f.actions.map(a=>a.props.accessibilityLabel);
  for(const label of ['Info','Add to favorites','Reply','Forward','Delete message'])assert(labels.includes(label));
  assert(!labels.includes('Copy message'));assert(!labels.includes('Edit message'));
  assert(!labels.includes('Create sticker'));
  f.actions.find(a=>a.props.accessibilityLabel==='Reply').props.onPress();assert.deepEqual(f.events,['close','reply']);
 }
 assert(menu(true,false,'photo.png').actions.some(a=>a.props.accessibilityLabel==='Create sticker'));
});

test('Save attachment is hidden for existing Gallery media and available for unsaved files',()=>{
 assert(!menu(true,true).actions.some(a=>a.props.accessibilityLabel==='Save attachment'));
 assert(menu(true,false).actions.some(a=>a.props.accessibilityLabel==='Save attachment'));
});
