const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/callEndHandshake.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
test('explicit end is acknowledged on the current call and duplicate delivery ends once',async()=>{
 let ended=0,left,right;left=out.createCallEndHandshake('call',{send:raw=>{right.receive(raw);return true;},ended:()=>{}});
 right=out.createCallEndHandshake('call',{send:raw=>{left.receive(raw);return true;},ended:()=>ended++});
 await left.end();assert.equal(ended,1);
 right.receive(JSON.stringify({version:1,call:'call',kind:'call-end'}));assert.equal(ended,1);left.close();right.close();
});
test('wrong call, presentation, malformed and oversized packets cannot end a call',()=>{
 let ended=0;const h=out.createCallEndHandshake('call',{send:()=>true,ended:()=>ended++});
 for(const raw of ['bad','x'.repeat(513),JSON.stringify({version:1,call:'other',kind:'call-end'}),JSON.stringify({version:1,sharing:true})])assert.equal(h.receive(raw),false);
 assert.equal(ended,0);h.close();
});
test('missing channel falls back immediately; missing acknowledgement is bounded',async()=>{
 const unavailable=out.createCallEndHandshake('a',{send:()=>false,ended:()=>{}});await unavailable.end();
 const h=out.createCallEndHandshake('a',{send:()=>true,ended:()=>{}});const start=Date.now();await h.end();assert(Date.now()-start<1500);h.close();
});
test('cleanup resolves an outstanding hangup without receiving a late terminal event',async()=>{
 let ended=0;const h=out.createCallEndHandshake('a',{send:()=>true,ended:()=>ended++});const p=h.end();h.close();await p;
 assert.equal(h.receive(JSON.stringify({version:1,call:'a',kind:'call-end'})),false);assert.equal(ended,0);
});
