const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(native){const out={},calls=[];new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/storage/chatStore.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='./storageReadSafety'?require('./helpers/storageSafety.cjs'):name.includes('async-storage')?{default:{getItem:async k=>{calls.push(k);return 'legacy';},setItem:async()=>{calls.push('write');}}}:native,out);return {out,calls};}
test('capacity refusal cannot write or advance the revision',async()=>{
 const f=fixture({checkNativeChatWrite:async()=>{throw Error('AXONIC_STORAGE_FULL');}});await assert.rejects(f.out.ownChatStore('owner').write('data'),/AXONIC_STORAGE_FULL/);assert.deepEqual(f.calls,[]);assert.equal(f.out.ownChatRevision('owner'),0);
});
test('updated Android chat reads use native recovery, including null for a missing account',async()=>{
 const f=fixture({supportsChatStorageRecovery:()=>true,readNativeChatStorage:async owner=>owner==='missing'?null:'large unicode 🧠'});
 assert.equal(await f.out.ownChatStore('owner').read(),'large unicode 🧠');assert.equal(await f.out.ownChatStore('missing').read(),null);assert.deepEqual(f.calls,[]);
});
test('failed recovery is propagated; no empty-history fallback or old cursor retry',async()=>{
 const f=fixture({supportsChatStorageRecovery:()=>true,readNativeChatStorage:async()=>{throw Error('snapshot failed');}});
 await assert.rejects(f.out.ownChatStore('owner').read(),/snapshot failed/);assert.deepEqual(f.calls,[]);
});
test('older native builds retain their existing reader',async()=>{
 const f=fixture({supportsChatStorageRecovery:()=>false});assert.equal(await f.out.ownChatStore('owner').read(),'legacy');
});
test('background chat readers share the same recovery path',()=>{
 for(const name of ['rootCallWake','rootMessageWake','rootNotificationRoute']){const source=fs.readFileSync('src/services/identity/'+name+'.ts','utf8');assert(source.includes('ownChatStore'));assert(!source.includes("AsyncStorage.getItem('@axonic_root_chat_v1:'"));}
});
