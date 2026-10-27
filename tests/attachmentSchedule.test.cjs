const test=require('node:test'),assert=require('node:assert/strict');
const {attachmentWorkDelay}=require('./helpers/attachment.cjs').load('attachmentSchedule');
const {createAttachmentReconcileGate}=require('./helpers/attachment.cjs').load('attachmentSchedule');
const {createAttachmentWorkSelection}=require('./helpers/attachment.cjs').load('attachmentSchedule');
test('new transfers precede old receipt lookups without starving either lane',()=>{
 const pick=createAttachmentWorkSelection(),active=['uploading','downloading'].map(phase=>({phase,direction:'outgoing'}));
 const waiting=Array.from({length:8},()=>({phase:'confirming',direction:'outgoing',receipt:null}));
 const jobs=[...waiting,...active],seen=Array.from({length:32},()=>pick(jobs));
 assert.equal(seen.filter(j=>active.includes(j)).length,24);
 for(const j of waiting)assert.equal(seen.filter(v=>v===j).length,1);
 assert.equal(seen[0],active[0]);assert.equal(seen[1],active[1]);
});
test('verified receipts and incoming completion stay active; either lone lane keeps progressing',()=>{
 const pick=createAttachmentWorkSelection(),receipt={phase:'confirming',direction:'outgoing',receipt:{}},incoming={phase:'confirming',direction:'incoming'},waiting={phase:'confirming',direction:'outgoing'};
 assert.equal(pick([]),undefined);assert.equal(pick([waiting]),waiting);
 assert.equal(pick([receipt,incoming,waiting]),receipt);assert.equal(pick([receipt,incoming,waiting]),incoming);
 assert.equal(pick([incoming]),incoming);
});
test('reconciliation is event-driven, retains mid-walk events, and retries incomplete walks',()=>{
 const g=createAttachmentReconcileGate();assert(g.needed(0,0));
 assert(g.needed(0,1),'failed walks are not marked');g.complete(0,2);
 assert.equal(g.needed(0,3),false);assert(g.needed(1,3));
 g.complete(0,4);assert(g.needed(1,5),'new event is not consumed by old walk');
 g.complete(1,5);assert.equal(g.needed(1,30004),false);assert(g.needed(1,30005));
 g.clear();assert(g.needed(1,5));
});
const job=(phase='queued',next=15000)=>({phase,next,descriptor:{manifest:{expires:60000}}});
test('empty and terminal transfer queues sleep without scheduled reads',()=>{
 assert.equal(attachmentWorkDelay([],10000,()=>true),Infinity);
 assert.equal(attachmentWorkDelay(['complete','expired','cancelled'].map(p=>job(p)),10000,()=>true),Infinity);
});
test('disconnected or blocked transfers wait for connection/policy events or expiry',()=>{
 assert.equal(attachmentWorkDelay([job()],10000,()=>false),50000);
 assert.equal(attachmentWorkDelay([job()],10000,()=>true),5000);
});
test('due retries yield rather than spin and future retries cannot postpone expiry',()=>{
 assert.equal(attachmentWorkDelay([job('queued',0)],10000,()=>true),500);
 assert.equal(attachmentWorkDelay([job('queued',90000)],10000,()=>true),50000);
});

const {createAttachmentReadinessProbe}=require('./helpers/attachment.cjs').load('attachmentSchedule');
test('optional direct hint times out, coalesces pending work, and ignores late answers',async()=>{
 const p=createAttachmentReadinessProbe(10);let finish,calls=0;
 const work=()=>{calls++;return new Promise(r=>finish=r);};
 assert.equal(await p.read('peer',work),undefined);
 assert.equal(await p.read('peer',work),undefined);assert.equal(calls,1);
 finish({status:'ready'});await new Promise(r=>setImmediate(r));
 assert.deepEqual(await p.read('peer',async()=>({status:'ready'})),{status:'ready'});
});
test('stopping a readiness wait releases it and rejection cannot escape',async()=>{
 const p=createAttachmentReadinessProbe(10000);let reject;
 const result=p.read('peer',()=>new Promise((_,r)=>reject=r));
 await Promise.resolve();p.clear();assert.equal(await result,undefined);
 reject(Error('disconnected'));await new Promise(r=>setImmediate(r));
 assert.equal(await p.read('peer',async()=>{throw Error('offline')}),undefined);
});
