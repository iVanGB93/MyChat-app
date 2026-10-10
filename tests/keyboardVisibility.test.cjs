const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/utils/keyboard-visibility.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
const delta=mod.keyboardScrollDelta;
test('covered fields move above the keyboard with room for their nearby action',()=>{
 const movement=delta(640,48,80,800,500);
 assert.equal(640+48-movement,500-96);
});
test('already visible fields keep their scroll position',()=>assert.equal(delta(200,48,80,800,500),0));
test('a resized form or fixed footer limits visibility before the keyboard edge',()=>{
 const movement=delta(330,48,80,320,500);
 assert.equal(330+48-movement,400-96);
});
test('fields above the viewport scroll back into view',()=>{
 const movement=delta(50,48,80,800,500);
 assert.equal(50-movement,80+12);
});
test('a tall multiline editor keeps its top visible instead of scrolling past it',()=>{
 const movement=delta(200,500,80,420,500);
 assert.equal(200-movement,80+12);
});
test('live resized viewport remains authoritative when the cached keyboard event is missing',()=>{
 const movement=delta(640,48,80,420,Infinity);
 assert.equal(640+48-movement,500-96);
});

function nativeBridge(native){
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('modules/axonic-app-update/src/index.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,()=>({requireOptionalNativeModule:()=>native}));return out;
}
test('older clients without native keyboard measurement keep the fallback available',async()=>{
 const api=nativeBridge({});assert.equal(api.supportsKeyboardOverlap(),false);assert.equal(await api.getKeyboardOverlap(10),null);
});
test('native keyboard reads return live overlap and tolerate unavailable views',async()=>{
 let value={visible:true,overlap:240};const api=nativeBridge({getKeyboardOverlap:async tag=>{assert.equal(tag,10);return value;}});
 assert.equal(api.supportsKeyboardOverlap(),true);assert.equal(await api.getKeyboardOverlap(10),value);
 value=null;assert.equal(await api.getKeyboardOverlap(10),null);
 const failing=nativeBridge({getKeyboardOverlap:async()=>{throw Error('detached');}});assert.equal(await failing.getKeyboardOverlap(10),null);
});
