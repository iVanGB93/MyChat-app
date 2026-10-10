const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('src/components/ui/RecoveryWordsInput.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
function editor(initial=''){
 let value=initial,cursor=0;const hooks=[];
 const react={createElement:(type,props,...children)=>({type,props,children}),useState:init=>{const i=cursor++;if(!(i in hooks))hooks[i]=init;return [hooks[i],v=>hooks[i]=v];},useRef:init=>{const i=cursor++;return hooks[i]??=( {current:init});}};
 const native={Pressable:'Pressable',TextInput:'TextInput',Text:'Text',View:'View',StyleSheet:{create:x=>x}};
 const c={exports:{},require:name=>name==='react'?react:name==='react-native'?native:name==='./KeyboardForm'?{KeyboardAwareTextInput:'TextInput'}:{useTheme:()=>({colors:{}})}};vm.runInNewContext(source,c);
 const nodes=tree=>[tree,...tree.children.flat(Infinity).filter(x=>x&&typeof x==='object').flatMap(nodes)];
 return {get value(){return value;},render(){cursor=0;return nodes(c.exports.default({value,onChangeText:v=>value=v}));}};
}
test('spaces create numbered boxes without adding numbers to the phrase; paste retains order',()=>{const e=editor();e.render().find(n=>n.props?.accessibilityLabel==='Next recovery word').props.onChangeText('apple banana ');assert.equal(e.value,'apple banana ');assert.equal(e.render().filter(n=>n.type==='Pressable').length,2);e.render().find(n=>n.props?.accessibilityLabel==='Next recovery word').props.onChangeText('cherry');assert.equal(e.value,'apple banana cherry');});
test('editing a completed word preserves the remaining words and their order',()=>{const e=editor('apple banana cherry');e.render().find(n=>n.type==='Pressable').props.onPress();e.render().find(n=>n.props?.accessibilityLabel==='Edit recovery word 1').props.onChangeText('apricot');assert.equal(e.value,'apricot banana cherry');});
test('backspace on empty input selects the last boxed word; deleting it does not reorder others',()=>{const e=editor('apple banana ');e.render().find(n=>n.props?.accessibilityLabel==='Next recovery word').props.onKeyPress({nativeEvent:{key:'Backspace'}});e.render().find(n=>n.props?.accessibilityLabel==='Edit recovery word 2').props.onChangeText('');assert.equal(e.value,'apple ');});
