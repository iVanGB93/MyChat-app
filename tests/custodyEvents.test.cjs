const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');
const {createRelayPollSchedule}=load('relayPollSchedule');
const {createCustodyEvents}=load('custodyEvents');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('event peer drains once and remains silent until an actual event',()=>{
 let now=0;const s=createRelayPollSchedule(()=>now,10,()=>true);
 s.begin('peer').finish({empty:true,item:false});
 for(let i=0;i<1000;i++){now+=15000;assert.equal(s.begin('peer'),null);}
 assert.equal(s.diagnostics().startedPasses,1);
 s.resume('peer');assert.ok(s.begin('peer'));
});
test('events racing an empty response remain eligible; partial failures do not become idle',()=>{
 let now=0;const s=createRelayPollSchedule(()=>now,10,()=>true);
 const old=s.begin('peer');s.resume('peer');old.finish({empty:true,item:false});
 const next=s.begin('peer');assert.ok(next);
 next.finish({empty:true,item:true,settled:false});
 now+=5000;assert.ok(s.begin('peer'));
});
test('old peers retain bounded polling and reconnect prunes empty event sessions',()=>{
 let now=0;const s=createRelayPollSchedule(()=>now,10,p=>p==='new');
 s.begin('old').finish({empty:true,item:false});s.begin('new').finish({empty:true,item:false});
 now=5000;assert.ok(s.begin('old'));assert.equal(s.begin('new'),null);
 s.prune([]);assert.ok(s.begin('new'));
});
test('notice ACK requires matching revision and retries only unfinished notices',async()=>{
 let now=0,requests=0,match=false;const worker=createCustodyEvents({current:()=>true,now:()=>now,peers:()=>['peer'],reconcile(){},
 request:async(_,raw)=>{requests++;const q=JSON.parse(raw);return JSON.stringify({status:'accepted',revision:match?q.revision:q.revision+1});}});
 worker.tick();assert.equal(requests,0);
 worker.changed('peer');await settle();assert.equal(requests,1);assert.equal(worker.diagnostics().pending,1);
 now=1999;worker.tick();await settle();assert.equal(requests,1);
 now=2000;match=true;worker.tick();await settle();assert.equal(worker.diagnostics().pending,0);
 now+=100000;worker.tick();await settle();assert.equal(requests,2);worker.stop();
});
test('commit during an in-flight notice cannot be lost behind its old ACK',async()=>{
 const calls=[];let release;
 const worker=createCustodyEvents({current:()=>true,now:()=>0,peers:()=>['peer'],reconcile(){},request:async(_,raw)=>{
  const q=JSON.parse(raw);calls.push(q.revision);if(calls.length===1)await new Promise(r=>release=r);
  return JSON.stringify({status:'accepted',revision:q.revision});
 }});
 worker.changed('peer');worker.changed('peer');assert.equal(calls.length,1);release();await settle();
 assert.deepEqual(calls,[1,2]);assert.equal(worker.diagnostics().pending,0);worker.stop();
});
test('ACK follows local reconciliation request, and unsupported peers cannot trigger work',()=>{
 let reconciled=0;const worker=createCustodyEvents({current:()=>true,now:()=>0,peers:()=>['peer'],request:async()=>null,reconcile(){reconciled++;}});
 const raw=JSON.stringify({version:1,operation:'inbox-changed',revision:1});
 assert.equal(JSON.parse(worker.receive('unknown',raw)).status,'rejected');assert.equal(reconciled,0);
 assert.deepEqual(JSON.parse(worker.receive('peer',raw)),{status:'accepted',revision:1});assert.equal(reconciled,1);
 worker.stop();assert.equal(JSON.parse(worker.receive('peer',raw)).status,'rejected');
});
test('disconnected peers do not accumulate notices or idle traffic',async()=>{
 let connected=true,calls=0;
 const worker=createCustodyEvents({current:()=>true,now:()=>10000,peers:()=>connected?['peer']:[],reconcile(){},request:async()=>{calls++;return null;}});
 worker.changed('peer');await settle();connected=false;worker.disconnected('peer');
 for(let i=0;i<20;i++){worker.changed('peer');worker.tick();}
 assert.equal(calls,1);assert.equal(worker.diagnostics().pending,0);worker.stop();
});
test('call-inbox events are distinct from message-inbox events',()=>{
 let calls=0;const q=createCustodyEvents({operation:'call-inbox-changed',current:()=>true,now:()=>0,peers:()=>['peer'],request:async()=>null,reconcile:()=>calls++});
 assert.equal(q.receive('peer',JSON.stringify({version:1,operation:'inbox-changed',revision:1})),null);assert.equal(calls,0);
 assert.equal(JSON.parse(q.receive('peer',JSON.stringify({version:1,operation:'call-inbox-changed',revision:1}))).status,'accepted');assert.equal(calls,1);q.stop();
});
