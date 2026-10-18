const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('camera preview follows a bounded drag and springs home on release or interruption',()=>{
 let handlers,springs=0,position;
 class Value {constructor(){position=this;}setValue(v){this.value=v;}stopAnimation(){}getTranslateTransform(){return [];} }
 const react={createElement:(type,props)=>({type,props}),useRef:v=>({current:v}),useMemo:fn=>fn()};
 const native={Animated:{ValueXY:Value,View:'AnimatedView',spring:(_p,c)=>{assert.deepEqual(c.toValue,{x:0,y:0});return {start:()=>springs++};}},PanResponder:{create:h=>{handlers=h;return {panHandlers:{}};}},useWindowDimensions:()=>({width:400,height:800})};
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/screens/calls/DraggableCallPreview.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(out,n=>n==='react'?{default:react,...react}:native);
 out.default({children:null});handlers.onPanResponderMove(null,{dx:-100,dy:150});assert.deepEqual(position.value,{x:-100,y:150});
 handlers.onPanResponderMove(null,{dx:-9999,dy:9999});assert.deepEqual(position.value,{x:-260,y:580});
 handlers.onPanResponderRelease();handlers.onPanResponderTerminate();assert.equal(springs,2);
});
