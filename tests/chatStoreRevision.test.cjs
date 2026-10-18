const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('chat permission change token advances only after a successful write and stays owner scoped',async()=>{
 let release,fail=false;const gate=new Promise(r=>release=r),out={};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/storage/chatStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='./storageReadSafety'?require('./helpers/storageSafety.cjs'):name.includes('async-storage')?{default:{getItem:async()=>null,setItem:async()=>{await gate;if(fail)throw Error('disk');}}}:{checkNativeChatWrite:async()=>{}},out);
 const events=[];const off=out.subscribeOwnChatWrites(owner=>events.push([owner,out.ownChatRevision(owner)]));
 out.subscribeOwnChatWrites(()=>{throw Error('broken consumer');});
 const a=out.ownChatStore('one'),b=out.ownChatStore('two'),pending=a.write('{}');
 assert.equal(events.length,0);
 assert.equal(out.ownChatRevision('one'),0);release();await pending;
 assert.equal(out.ownChatRevision('one'),1);assert.equal(out.ownChatRevision('two'),0);
 await b.write('{}');assert.equal(out.ownChatRevision('two'),1);
 fail=true;await assert.rejects(a.write('{}'));assert.equal(out.ownChatRevision('one'),1);
 assert.deepEqual(events,[['one',1],['two',1]]);off();fail=false;await a.write('{}');assert.equal(events.length,2);
});
