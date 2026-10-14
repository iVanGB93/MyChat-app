const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('src/components/chat/ChatComposer.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
function composer(){
 let text='';const sends=[];
 const react={createElement:(type,props,...children)=>({type,props,children}),forwardRef:f=>f,useState:v=>[v&&typeof v==='object'&&'empty' in v?{empty:text.length===0,sendable:!!text.trim()}:v,()=>{}],useRef:v=>({current:v}),useImperativeHandle:()=>{}};
 const c={exports:{},require:n=>n==='react'?react:n==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable',TouchableOpacity:'TouchableOpacity'}:n.includes('safe-area')?{useSafeAreaInsets:()=>({bottom:0})}:n.includes('ThemeContext')?{useTheme:()=>({colors:{}})}:n.includes('use-chat-draft')?{useChatDraft:()=>[text,v=>text=v]}:n.includes('KeyboardForm')?{KeyboardAwareTextInput:'Input'}:n.includes('chat-room-styles')?{chatRoomStyles:{}}:n.includes('vector-icons')?{Ionicons:'Icon'}:{__esModule:true,default:'Voice'}};
 vm.runInNewContext(source,c);
 const nodes=(n,path='')=>[{...n,path},...(n?.children??[]).flat(Infinity).flatMap((x,i)=>x&&typeof x==='object'?nodes(x,path+'.'+i):[])];
 return {sends,type:v=>text=v,render:()=>{const tree=nodes(c.exports.ChatComposer({owner:'owner',peer:'peer',onSend:v=>sends.push(v)},null));tree.find(n=>typeof n.type==='function').props.ref.current={getText:()=>text};return tree;}};
}
test('typing hides and disables the recorder without changing its mounted position',()=>{const c=composer(),first=c.render().find(n=>n.type==='Voice');c.type('message');const typed=c.render().find(n=>n.type==='Voice');assert.equal(typed.path,first.path);assert.equal(typed.props.disabled,true);c.type('');const cleared=c.render().find(n=>n.type==='Voice');assert.equal(cleared.path,first.path);assert.equal(cleared.props.disabled,false);});
test('send uses the current draft and clearing restores the voice control',()=>{const c=composer();c.type('new draft');let tree=c.render();tree.find(n=>n.props?.testID==='axonic-send-message').props.onPress();assert.deepEqual(c.sends,['new draft']);c.type('');tree=c.render();assert.ok(!tree.some(n=>n.props?.testID==='axonic-send-message'));assert.ok(tree.some(n=>n.type==='Voice'));});

const editorSource=source+'\nexports.testDraftEditor=DraftEditor;';
function draftEditor(platform='android'){
 let text='',cursor=0;const hooks=[],flags=[],nativeCalls=[],ref={current:null},native={focus(){},blur(){},clear:()=>nativeCalls.push('clear'),setNativeProps:p=>nativeCalls.push(p)};
 const react={createElement:(type,props)=>({type,props}),forwardRef:f=>f,useRef:v=>{const i=cursor++;return hooks[i]??={current:v};},useLayoutEffect:(f,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old[j])){hooks[i]=deps;f();}},useImperativeHandle:(r,f)=>r.current=f()};
 const update=v=>text=typeof v==='function'?v(text):v;
 const imports={react,'react-native':{Platform:{OS:platform}},'../../hooks/use-chat-draft':{useChatDraft:()=>[text,update]},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../ui/KeyboardForm':{KeyboardAwareTextInput:'Input'},'./chat-room-styles':{chatRoomStyles:{}}};
 const c={exports:{},require:n=>imports[n]??{}};vm.runInNewContext(editorSource,c);
 const props={owner:'test',scope:'peer',onState:s=>flags.push({...s}),onTyping:()=>{}};
 return {flags,nativeCalls,ref,render(){cursor=0;const tree=c.exports.testDraftEditor(props,ref);tree.props.ref.current=native;return tree;}};
}
test('normal keystrokes update only editor state; control flags change at empty/whitespace boundaries',()=>{const d=draftEditor();let field=d.render();for(const text of ['a','ab','abc']){field.props.onChangeText(text);field=d.render();}assert.equal(d.flags.length,2);assert.equal(d.ref.current.getText(),'abc');d.ref.current.setText(' ');d.render();assert.deepEqual(d.flags.at(-1),{empty:false,sendable:false});d.ref.current.setText('');d.render();assert.deepEqual(d.flags.at(-1),{empty:true,sendable:false});});
test('Android clearing updates text and cursor together; other platforms keep native clear',()=>{const android=draftEditor();android.render();android.ref.current.clear();assert.equal(JSON.stringify(android.nativeCalls),JSON.stringify([{text:'',selection:{start:0,end:0}}]));const ios=draftEditor('ios');ios.render();ios.ref.current.clear();assert.deepEqual(ios.nativeCalls,['clear']);});
