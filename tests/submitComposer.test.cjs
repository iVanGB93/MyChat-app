const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/components/chat/submitComposer.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
test('composer clears before durable send finishes and retains the next draft',async()=>{
 let text='sent',release;const pending=new Promise(r=>release=r),update=f=>text=f(text);
 const work=out.submitComposer(text,update,()=>pending);assert.equal(text,'');text='next';release();await work;assert.equal(text,'next');
});
test('failed send restores its draft only when no newer draft occupies the composer',async()=>{
 for(const next of ['', 'new text']){let text='original',reject;const pending=new Promise((_,r)=>reject=r),update=f=>text=f(text);
 const work=out.submitComposer(text,update,()=>pending);text=next;reject(Error('disk'));await assert.rejects(work,/disk/);assert.equal(text,next||'original');}
});
test('a stale send value never clears different current input',async()=>{
 let text='corrected';await out.submitComposer('old',f=>text=f(text),async()=>{});assert.equal(text,'corrected');
});
