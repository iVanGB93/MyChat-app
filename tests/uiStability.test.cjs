const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText;
test('render boundary hides exception text, reports failure and retries without deleting data',()=>{
 const reports=[],React={Component:class {constructor(props){this.props=props;}setState(next){Object.assign(this.state,next);}},createElement:(type,props,...children)=>({type,props,children})},out={};
 new Function('require','exports',compile('src/components/ui/RenderBoundary.tsx'))(n=>n==='react'?{default:React,...React}:n==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable'}:{reportRenderFailure:(...a)=>reports.push(a)},out);
 const B=out.default,b=new B({children:'screen',scope:'screens'});assert.equal(b.render(),'screen');b.state=B.getDerivedStateFromError();const error=Error('private chat content');b.componentDidCatch(error);const fallback=b.render();assert(!JSON.stringify(fallback).includes(error.message));assert.equal(reports.length,1);const retry=fallback.children.find(c=>c?.type==='Pressable');retry.props.onPress();assert.equal(b.render(),'screen');
});
