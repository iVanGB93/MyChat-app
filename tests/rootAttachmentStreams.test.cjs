const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {load}=require('./helpers/attachment.cjs');
const digest='a'.repeat(64),owner='sender',recipient='receiver',checksum=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t,options={}){
 const data=new Map(),dirs=new Set(),credits=[],source=crypto.randomBytes(524287),handlers=[],managers=[];let serial=0,valid=true,requests=0,checks=0;
 const live=async()=>{checks++;return valid;};
 function file(user,id,name='content'){
  const dir=user+'/'+id,key=dir+'/'+name;
  return {get exists(){return data.has(key);},parentDirectory:{get exists(){return dirs.has(dir);},create(){dirs.add(dir);},delete(){dirs.delete(dir);for(const k of data.keys())if(k.startsWith(dir+'/'))data.delete(k);}},
   create(){data.set(key,Buffer.alloc(0));},delete(){data.delete(key);},move(target){data.set(target.key,data.get(key));data.delete(key);},key,
   open(){let offset=0,closed=false;return {readBytes(n){assert(!closed);const b=data.get(key).subarray(offset,offset+n);offset+=n;return new Uint8Array(b);},writeBytes(bytes){assert(!closed);data.set(key,Buffer.concat([data.get(key),Buffer.from(bytes)]));},close(){closed=true;}};}};
 }
 const manifest={sender:owner,senderDevice:'s',recipient,recipientDevice:'r',bytes:source.length,expires:Date.now()+60000};
 const jobs=[owner,recipient].map((user,i)=>({owner:user,digest,descriptor:{manifest,checksum:checksum(source)},direction:i?'incoming':'outgoing'}));
 dirs.add(owner+'/'+digest);data.set(owner+'/'+digest+'/content',source);
 function lanes(){
  let closed=false;const listeners=[],pair=[0,1].map(i=>({live:()=>!closed,ready:async()=>{},
   send(value){if(options.silent)return;const deliver=()=>{if(!closed){listeners[1-i]?.[0](typeof value==='string'?value:value.slice().buffer);if(options.disconnect&&value instanceof Uint8Array)pair[i].close();}};if(options.delay)setTimeout(deliver,options.delay);else queueMicrotask(deliver);},
   async credit(value,authorize){credits.push({value,authorize});},listen(message,end){listeners[i]=[message,end];},
   close(){if(closed)return;closed=true;for(const l of listeners)l?.[1]();}}));return pair;
 }
 for(let i=0;i<2;i++){
  const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentStreams.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
   if(name.includes('axonic-nearby'))return {default:{identityRandomBytes:async()=>String(++serial).padStart(64,'0'),attachmentFileSha256:async(user,id)=>checksum(data.get(user+'/'+id+'/content')),
    ...(options.legacyNative?{}:{attachmentStageStream(user,temporary,id,bytes){
     if(options.stageFails)throw Error('Atomic rename failed');
     const source=user+'/'+temporary+'/content',target=user+'/'+id+'/partial';assert.equal(data.get(source).length,bytes);
     data.set(target,data.get(source));data.delete(source);return true;
    }})}};
   if(name==='./localAccount')return {localAccount:{status:()=>({state:'unlocked',account:i?recipient:owner})}};
   if(name==='./rootAttachmentFiles')return {hashRootAttachmentFile:async(user,id)=>checksum(data.get(user+'/'+id+'/content')),rootAttachmentFile:file,rootAttachmentPartial:(user,id)=>file(user,id,'partial'),sweepRootStreamTemporaries(){},createRootStreamTemporary(user,id){const f=file(user,id);f.parentDirectory.create();f.create();return f;}};
   if(name==='./directAttachmentStream')return load('directAttachmentStream');throw Error(name);
  },out);
  const network={available:()=>options.available!==false,...(options.requestUpgrade?{request:(...args)=>options.requestUpgrade(i,...args)}:{}),listen(h){handlers[i]=h;return ()=>handlers[i]=null;},open(){const pair=lanes();queueMicrotask(()=>{if(!handlers[1]?.(owner,options.wrongDevice?'wrong':'s',pair[1]))pair[1].close();});return pair[0];}};
  managers[i]=out.createRootAttachmentStreams(network,async()=>{requests++;if(options.requestThrows)throw Error('Route changed before stream startup');return JSON.stringify({status:await managers[0].serve(jobs[0],live)?'streaming':'unavailable'});});
 }
 t.after(()=>managers.forEach(m=>m.stop()));
 return {managers,jobs,data,dirs,source,credits,get checks(){return checks;},run:()=>managers[1].pull(jobs[1],live),revoke:()=>valid=false};
}

test('delayed stream acknowledgements do not require continuous journal polling',async t=>{
 const f=fixture(t,{delay:30});assert.equal(await f.run(),true);
 t.diagnostic(`journal validations: ${f.checks}`);
 assert(f.checks<80,'waiting for frames must not continuously poll the durable journal');
 assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),f.source);
});

test('silent stream still checks revocation without waiting for a remote frame',async t=>{
 const f=fixture(t,{silent:true}),pending=f.run();await new Promise(setImmediate);f.revoke();
 const started=Date.now();assert.equal(await pending,false);
 assert(Date.now()-started<1500,'silence must not suppress periodic lease checks');
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
});
test('normal stream adapter verifies, stages for worker commit, and cleans its temporary directory',async t=>{
 const f=fixture(t);assert.equal(await f.run(),true);
 assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),f.source);
 assert.equal([...f.data.keys()].filter(k=>k.endsWith('/content')).length,1,'only sender source remains');
 assert.equal(f.credits[0].authorize,true);assert.equal(f.credits[0].value,f.source.length);
 assert.deepEqual(f.credits.slice(1).map(c=>c.value),[131072,262144,393216]);
});
test('interrupted normal stream adapter returns fallback without publishing partial bytes',async t=>{
 const f=fixture(t,{disconnect:true});assert.equal(await f.run(),false);
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
 assert.deepEqual(f.data.get('sender/'+digest+'/content'),f.source);
});
test('stopping the runtime cancels its receiver and leaves no partial content',async t=>{
 const f=fixture(t);const pending=f.run();await new Promise(setImmediate);f.managers[1].stop();
 assert.equal(await pending,false);assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
});
test('revoked journal or permission lease cannot publish a stream',async t=>{
 const f=fixture(t);const pending=f.run();await new Promise(setImmediate);f.revoke();
 assert.equal(await pending,false);assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
});

test('an unavailable media lane is not a failed stream and can become ready',async t=>{
 const options={available:false},f=fixture(t,options);
 assert.equal(await f.run(),'unavailable');assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
 options.available=true;assert.equal(await f.run(),true);
});

test('eligible unavailable stream requests promotion on both endpoints then upgrades a partial file',async t=>{
 const requested=[],options={available:false,requestUpgrade:(...args)=>{requested.push(args);return true;}},f=fixture(t,options);
 const partial=Buffer.from('previously verified prefix');f.data.set('receiver/'+digest+'/partial',partial);
 assert.equal(await f.run(),'unavailable');assert.deepEqual(requested,[[1,'sender','s'],[0,'receiver','r']]);
 assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),partial);
 options.available=true;assert.equal(await f.run(),true);assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),f.source);
});
test('eligible cold route gets a bounded chance to become a direct stream',async t=>{
 const options={available:false,requestUpgrade:()=>true},f=fixture(t,options);
 const ready=setTimeout(()=>{options.available=true;},150);t.after(()=>clearTimeout(ready));
 assert.equal(await f.run(),true);
 assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),f.source);
});

test('revocation during route promotion stops before opening a stream',async t=>{
 const f=fixture(t,{available:false,requestUpgrade:()=>true});
 const revoke=setTimeout(()=>f.revoke(),50);t.after(()=>clearTimeout(revoke));
 assert.equal(await f.run(),'unavailable');
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
});

test('revoked transfer cannot request a connection upgrade',async t=>{
 let requests=0;const f=fixture(t,{available:false,requestUpgrade:()=>{requests++;return true;}});f.revoke();
 assert.equal(await f.run(),'unavailable');assert.equal(requests,0);
});
test('failed upgrade preserves the previously verified chunk prefix',async t=>{
 const f=fixture(t,{disconnect:true}),partial=Buffer.from('previously verified prefix');f.data.set('receiver/'+digest+'/partial',partial);
 assert.equal(await f.run(),false);assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),partial);
 assert.deepEqual(f.data.get('sender/'+digest+'/content'),f.source);
});

test('failed final stream handoff preserves the durable prefix and permits retry',async t=>{
 const options={stageFails:true},f=fixture(t,options),prefix=Buffer.from('verified prefix');
 f.data.set('receiver/'+digest+'/partial',prefix);
 assert.equal(await f.run(),false);assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),prefix);
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,1,'attempt file cleaned, prefix retained');
 options.stageFails=false;assert.equal(await f.run(),true);assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),f.source);
});

test('older native binary falls back to chunks without unsafe stream staging',async t=>{
 const f=fixture(t,{legacyNative:true}),prefix=Buffer.from('verified prefix');
 f.data.set('receiver/'+digest+'/partial',prefix);
 assert.equal(await f.run(),'unavailable');assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),prefix);
});

test('API 24/25 do not expose the API 26 atomic handoff capability',()=>{
 const native=fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AxonicNearbyModule.kt','utf8');
 assert.match(native,/if \(android\.os\.Build\.VERSION\.SDK_INT >= 26\) \{\s*Function\("attachmentStageStream"\)/);
 const composition=fs.readFileSync('src/composition/neuronRuntime.ts','utf8');
 assert.match(composition,/streams:Platform\.OS==='android'&&!!Native\?\.attachmentStageStream/);
});

test('a request failure before a lane opens is retryable readiness and releases the incoming slot',async t=>{
 const options={requestThrows:true},f=fixture(t,options);
 assert.equal(await f.run(),'unavailable');assert.equal([...f.data.keys()].filter(k=>k.startsWith('receiver/')).length,0);
 options.requestThrows=false;assert.equal(await f.run(),true);
 assert.deepEqual(f.data.get('receiver/'+digest+'/partial'),f.source);
});
