const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(file,extra={}){
 const slots=[];let index=0;const effects=[];
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
  useRef:initial=>{const i=index++;return slots[i]??={current:initial};},useEffect:fn=>effects.push(fn)};
 const keyboard={};
 const imports={react:{default:react,...react},'react-native':{View:'View',Text:'Text',Pressable:'Pressable',FlatList:'FlatList',Modal:'Modal',ActivityIndicator:'Spinner',StyleSheet:{create:x=>x},Keyboard:{addListener:(event,fn)=>{keyboard[event]=fn;return {remove(){}};}}},
  '@expo/vector-icons':{Ionicons:'Icon'},'expo-status-bar':{StatusBar:'StatusBar'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:24,bottom:20,left:0,right:0})},
  '../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../modules/identity':{localAccount:{status:()=>({account:'owner',state:'unlocked'})},shortIdentity:x=>x},
  '../../modules/storage':{readSharedAvatar:async()=>null,subscribeSharedAvatars:()=>()=>{}},'../ui/Avatar':{default:'Avatar'},'../ui/KeyboardForm':{KeyboardAvoidingScreen:'KeyboardScreen',KeyboardAwareTextInput:'Input'},'./ConversationRecipientPicker':{default:'Picker'},...extra};
 const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(exports,name=>imports[name]??{});
 return {render:props=>{index=0;effects.length=0;return exports.default(props);},effects,keyboard};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return;if(predicate(tree))return tree;for(const child of tree.props?.children??[]){const found=Array.isArray(child)?child.map(x=>find(x,predicate)).find(Boolean):find(child,predicate);if(found)return found;}}
test('recipient search filters names and codes while selection keeps confirmation explicit',()=>{
 const f=fixture('src/components/chat/ConversationRecipientPicker.tsx'),selected=[];
 const props={title:'Forward message',description:'Choose a conversation',choices:[{id:'axon:abc',name:'Alice'},{id:'group:1',name:'Test group',group:true}],selected:'',busy:false,submitLabel:'Forward',onSelect:id=>selected.push(id),onSubmit(){},onClose(){}};
 let tree=f.render(props),list=find(tree,n=>n.type==='FlatList');assert.equal(list.props.data.length,2);
 assert.equal(find(tree,n=>n.props.accessibilityLabel==='Forward').props.disabled,true);
 list.props.renderItem({item:props.choices[0]}).props.onPress();assert.deepEqual(selected,['axon:abc']);
 find(tree,n=>n.type==='Input').props.onChangeText(' ALICE ');tree=f.render({...props,selected:'axon:abc'});
 assert.equal(find(tree,n=>n.type==='FlatList').props.data.length,1);assert.equal(find(tree,n=>n.props.accessibilityLabel==='Forward').props.disabled,false);
 find(tree,n=>n.type==='Input').props.onChangeText('group:1');tree=f.render(props);assert.equal(find(tree,n=>n.type==='FlatList').props.data[0].group,true);
 tree=f.render({...props,selected:'unavailable'});assert.equal(find(tree,n=>n.props.accessibilityLabel==='Forward').props.disabled,true);
});
test('busy and partially shared batches lock recipient selection; keyboard leaves list and footer mounted',()=>{
 const f=fixture('src/components/chat/ConversationRecipientPicker.tsx'),props={title:'Share',description:'Description',preview:{type:'Preview',props:{}},choices:[{id:'one',name:'One'}],selected:'one',busy:true,locked:true,submitLabel:'Send',onSelect(){},onSubmit(){},onClose(){}};
 let tree=f.render(props);f.effects[0]();assert.equal(find(tree,n=>n.type==='Input').props.editable,false);
 assert.equal(find(tree,n=>n.type==='FlatList').props.renderItem({item:props.choices[0]}).props.disabled,true);
 assert.equal(find(tree,n=>n.props.accessibilityLabel==='Send').props.disabled,true);
 f.keyboard.keyboardDidShow();tree=f.render(props);assert(!find(tree,n=>n.type==='Preview'));assert(find(tree,n=>n.type==='FlatList'));assert(find(tree,n=>n.props.accessibilityLabel==='Send'));
 f.keyboard.keyboardDidHide();assert(find(f.render(props),n=>n.type==='Preview'));
});
test('forwarding selects first, confirms once, excludes blocked destinations and retries errors',async()=>{
 const sent=[];let fail=true,release,closed=0;
 const f=fixture('src/components/chat/RootForwardPicker.tsx',{'../../modules/messaging':{forwardRootMessage:async(message,target)=>{sent.push(target);if(fail)throw Error('offline');await new Promise(r=>release=r);}}});
 const props={message:{text:'Hello'},contacts:[{account:'peer',alias:'Peer',blocked:false},{account:'blocked',blocked:true}],groups:[{id:'g',name:'Group',accepted:true,blocked:false},{id:'pending',accepted:false,blocked:false}],onClose:()=>closed++};
 let picker=f.render(props);assert.deepEqual(picker.props.choices.map(c=>c.id),['peer','group:g']);picker.props.onSelect('peer');assert.equal(sent.length,0);
 picker=f.render(props);picker.props.onSubmit();await new Promise(r=>setImmediate(r));picker=f.render(props);assert.equal(picker.props.error,'offline');assert.equal(closed,0);
 fail=false;picker.props.onSubmit();picker.props.onSubmit();await new Promise(r=>setImmediate(r));assert.deepEqual(sent,['peer','peer']);assert.equal(f.render(props).props.busy,true);release();await new Promise(r=>setImmediate(r));assert.equal(closed,1);
});
