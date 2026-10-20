const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const exports_={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/receivedMediaExport.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p==='./attachmentProtocol'?{attachmentDigest:m=>m.id}:{IMPORTED_STICKER_CONTENT:'sticker'},exports_);
function fixture(){
 let active=true,enabled=true,rows={},saved=[],removed=[],fail=false;
 const photo={id:'one',peer:'peer',direction:'incoming',status:'delivered',attachment:{name:'Photo',mime:'image/jpeg',manifest:{id:'a'.repeat(64)}}};
 const state={contacts:[{account:'peer',accepted:true}],messages:[photo]};
 const worker=exports_.createReceivedMediaExporter({current:()=>active,enabled:async()=>enabled,snapshot:async()=>state,
  read:async()=>structuredClone(rows),write:async r=>{rows=structuredClone(r);},source:()=> 'file://private/content',
  save:async(...args)=>{if(fail)throw Error('Disk full');saved.push(args);return 'content://media/1';},remove:async(digest,uri)=>{removed.push([digest,uri]);return !fail;}});
 return {worker,state,photo,saved,removed,disable:()=>enabled=false,fail:v=>fail=v,lock:()=>active=false};
}
test('received media exports once with stable identity and MIME extension',async()=>{
 const f=fixture();await f.worker.run();await f.worker.run();assert.equal(f.saved.length,1);assert.deepEqual(f.saved[0],['file://private/content','AXN_'+'a'.repeat(64)+'__Photo.jpg','image/jpeg','image']);
});
test('pending, sent, deleted, sticker and unaccepted media never exports',async()=>{
 for(const change of [{status:'pending'},{direction:'outgoing'},{deleted:true},{attachment:{name:'sticker',mime:'image/png',manifest:{id:'b'}}}]){
  const f=fixture();Object.assign(f.photo,change);await f.worker.run();assert.equal(f.saved.length,0);
 }
 const f=fixture();f.state.contacts[0].accepted=false;await f.worker.run();assert.equal(f.saved.length,0);
});
test('export failure retries separately, preference and locked account suppress exports',async()=>{
 const f=fixture();f.fail(true);await f.worker.run();assert.equal(f.worker.nextDelay(),15000);f.fail(false);await f.worker.run();assert.equal(f.saved.length,1);assert.equal(f.worker.nextDelay(),Infinity);
 for(const method of ['disable','lock']){const f=fixture();f[method]();await f.worker.run();assert.equal(f.saved.length,0);}
});
test('concurrent wakes cannot duplicate an export',async()=>{
 const f=fixture();await Promise.all([f.worker.run(),f.worker.run(),f.worker.run()]);assert.equal(f.saved.length,1);
});

test('explicit message removal cleans only recorded exports even when auto-save is off',async()=>{
 const f=fixture();await f.worker.run();f.disable();f.state.removedMessages=[{peer:'peer',id:'one',direction:'incoming'}];f.state.messages=[];
 await f.worker.run();await f.worker.run();assert.equal(f.removed.length,1);assert.deepEqual(f.removed[0],['a'.repeat(64),'content://media/1']);
});
test('cleanup needing consent remains pending and retries without another export',async()=>{
 const f=fixture();await f.worker.run();f.photo.deleted=true;f.fail(true);await f.worker.run();f.fail(false);await f.worker.run();await f.worker.run();
 assert.equal(f.removed.length,2);assert.equal(f.saved.length,1);
});
