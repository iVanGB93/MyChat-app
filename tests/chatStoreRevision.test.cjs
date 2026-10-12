const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('chat permission change token advances only after a successful write and stays owner scoped',async()=>{
 let release,fail=false;const gate=new Promise(r=>release=r),out={};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/storage/chatStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(()=>({default:{getItem:async()=>null,setItem:async()=>{await gate;if(fail)throw Error('disk');}}}),out);
 const a=out.ownChatStore('one'),b=out.ownChatStore('two'),pending=a.write('{}');
 assert.equal(out.ownChatRevision('one'),0);release();await pending;
 assert.equal(out.ownChatRevision('one'),1);assert.equal(out.ownChatRevision('two'),0);
 await b.write('{}');assert.equal(out.ownChatRevision('two'),1);
 fail=true;await assert.rejects(a.write('{}'));assert.equal(out.ownChatRevision('one'),1);
});
