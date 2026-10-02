const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}

const {createPushRegistration}=load('pushRegistration');
test('registration refreshes on rotation, backs off failures, and never sends while inactive',async()=>{
 let now=100000,active=true,token='first-token',sent=[];
 const worker=createPushRegistration({now:()=>now,current:()=>active,token:async()=>token,request:async raw=>{sent.push(JSON.parse(raw));return JSON.stringify({status:'registered',until:now+86400000});}});
 await worker.tick();await worker.tick();assert.equal(sent.length,1);token='rotated-token';worker.invalidate();await worker.tick();assert.equal(sent[1].token,token);
 active=false;worker.invalidate();await worker.tick();assert.equal(sent.length,2);worker.stop();active=true;await worker.tick();assert.equal(sent.length,2);
});
test('late token acquisition cannot register after logout and revocation contains no token',async()=>{
 let release,sent=[];const worker=createPushRegistration({now:()=>100000,current:()=>true,token:()=>new Promise(r=>release=r),request:async raw=>{sent.push(JSON.parse(raw));return '{"status":"removed"}';}});
 const pending=worker.tick();assert.equal(await worker.revoke(),true);release('must-not-send');await pending;
 assert.deepEqual(sent,[{version:1,operation:'unregister'}]);
});
test('a failed request is bounded to one retry every thirty seconds',async()=>{
 let now=100000,calls=0;const worker=createPushRegistration({now:()=>now,current:()=>true,token:async()=> 'fixture-token',request:async()=>{calls++;return null;}});
 await worker.tick();await worker.tick();assert.equal(calls,1);now+=30000;await worker.tick();assert.equal(calls,2);
});
test('binding acquired after logout cannot be submitted',async()=>{
 let release,sent=[];const worker=createPushRegistration({now:()=>100000,current:()=>true,token:async()=> 'fixture-token',binding:()=>new Promise(r=>release=r),request:async raw=>{sent.push(JSON.parse(raw));return '{"status":"removed"}';}});
 const pending=worker.tick();await Promise.resolve();await worker.revoke();release({payload:'late-ticket'});await pending;
 assert.deepEqual(sent,[{version:1,operation:'unregister'}]);
});
test('older backend keeps registration working and binding is retried until confirmed',async()=>{
 let now=100000,attempts=0,sent=[];const worker=createPushRegistration({now:()=>now,current:()=>true,token:async()=> 'fixture-token',binding:async()=>{if(++attempts===1)throw Error('not deployed');return {payload:'fixture-ticket'};},request:async raw=>{const input=JSON.parse(raw);sent.push(input);return JSON.stringify({status:'registered',until:now+86400000,bound:!!input.binding});}});
 await worker.tick();assert.equal(sent[0].binding,undefined);now+=30000;await worker.tick();assert.equal(sent[1].binding.payload,'fixture-ticket');now+=30000;await worker.tick();assert.equal(sent.length,2);
});
