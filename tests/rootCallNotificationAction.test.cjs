const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){const saved=new Map(),mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootCallNotificationAction.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>n.includes('async-storage')?{default:{getItem:async k=>saved.get(k)??null,setItem:async(k,v)=>saved.set(k,v),removeItem:async k=>saved.delete(k)}}:{validAccountId:a=>typeof a==='string'&&/^axonic:1:[a-f0-9]{64}$/.test(a)});return mod;}
const account='axonic:1:'+'a'.repeat(64),callId='b'.repeat(64),data={type:'root_neuron_call',account,callId};
test('call actions apply once and only to the matching account and call',async()=>{const f=fixture();assert(await f.queueRootCallNotificationAction('root-call-answer',data));assert.equal(await f.takeRootCallNotificationAction('axonic:1:'+'c'.repeat(64),callId),null);assert.equal(await f.takeRootCallNotificationAction(account,'d'.repeat(64)),null);assert.equal(await f.takeRootCallNotificationAction(account,callId),'root-call-answer');assert.equal(await f.takeRootCallNotificationAction(account,callId),null);});
test('invalid or unrelated notification actions cannot request call acceptance',async()=>{const f=fixture();for(const [action,value] of [['root-reply',data],['root-call-answer',{...data,type:'root_neuron_message'}],['root-call-answer',{...data,callId:'invalid'}]])assert.equal(await f.queueRootCallNotificationAction(action,value),false);assert.equal(await f.takeRootCallNotificationAction(account,callId),null);});


test('opening a call never replaces a queued answer or implies acceptance',async()=>{
 const f=fixture();await f.queueRootCallNotificationAction('root-call-answer',data);await f.queueRootCallNotificationAction('root-call-open',data);
 assert.equal(await f.takeRootCallNotificationAction(account,callId),'root-call-answer');
 await f.queueRootCallNotificationAction('root-call-open',data);assert.equal(await f.takeRootCallNotificationAction(account,callId),'root-call-open');
});
test('simultaneous foreground and background consumers apply an action only once',async()=>{
 const f=fixture();await f.queueRootCallNotificationAction('root-call-answer',data);
 const actions=await Promise.all([f.takeRootCallNotificationAction(account,callId),f.takeRootCallNotificationAction(account,callId)]);
 assert.deepEqual(actions,['root-call-answer',null]);
});
test('a new action cannot be erased by an earlier asynchronous consume',async()=>{
 const f=fixture();await f.queueRootCallNotificationAction('root-call-open',data);
 const first=f.takeRootCallNotificationAction(account,callId),second=f.queueRootCallNotificationAction('root-call-answer',data);
 assert.equal(await first,'root-call-open');await second;assert.equal(await f.takeRootCallNotificationAction(account,callId),'root-call-answer');
});
test('a notification answer waits for the matching foreground call',async()=>{
 const f=fixture();
 assert(await f.queueRootCallNotificationAction('root-call-answer',data));
 assert.equal(await f.takeRootCallNotificationAction(account,callId,()=>false),null);
 assert.equal(await f.takeRootCallNotificationAction(account,callId,()=>true),'root-call-answer');
});
test('an expired invite cannot queue or apply its notification answer',async(t)=>{
 let now=10000;
 t.mock.method(Date,'now',()=>now);
 const f=fixture(),expiring={...data,expiresAt:'10500'};
 assert(await f.queueRootCallNotificationAction('root-call-answer',expiring));
 now=10500;
 assert.equal(await f.takeRootCallNotificationAction(account,callId),null);
 assert.equal(await f.queueRootCallNotificationAction('root-call-answer',expiring),false);
});
