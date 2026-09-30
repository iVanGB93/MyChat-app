const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), ts=require('typescript');
const modules=new Map();
function load(name) { if(modules.has(name))return modules.get(name);const out={};
const code=ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','exports',code)(n=>n==='./persistentAxon'?{AXON_FRAME_BYTES:20000}:load(n.slice(2)),out);modules.set(name,out);return out; }
const {FIRST_NEURON,createInternetAxonConnector}=load('internetAxonTransport');
const own='axonic:1:'+'ac'.repeat(32), candidate={...FIRST_NEURON,route:'internet',expiresAt:Date.now()+60000};
test('internet connector limits destinations and passes local identity to native upgrade',async()=>{
 let calls=0;const native={axonWssConnect:async(host,account)=>{calls++;assert.equal(host,'143.198.121.2');assert.equal(account,own);return 'wss';},axonClose(){}};
 const dial=createInternetAxonConnector(native,()=>own), context={signal:new AbortController().signal,onClosed(){}};
 for(const change of [{endpoint:'ws://143.198.121.2/v2/axon'},{endpoint:FIRST_NEURON.endpoint+'?url=evil'},{account:own},{route:'lan'}]) await assert.rejects(dial({...candidate,...change},context));
 assert.equal(calls,0);const wire=await dial(candidate,context);assert.equal(calls,1);wire.close();
});
test('cancellation closes late TLS connections before creating an identity session',async()=>{
 let finish,closed=0;const dial=createInternetAxonConnector({axonWssConnect:()=>new Promise(r=>finish=r),axonClose(){closed++;}},()=>own);
 const controller=new AbortController(), pending=dial(candidate,{signal:controller.signal,onClosed(){}});
 controller.abort();finish('late');await assert.rejects(pending);assert.equal(closed,1);
});
