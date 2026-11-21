const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./helpers/attachment.cjs');
const {createEventDeadlineTask}=load('eventDeadlineTask'),{createRelayPollSchedule}=load('relayPollSchedule');
// Execute the production composition's resume method against real idle schedulers.
const source=fs.readFileSync('src/composition/neuronRuntime.ts','utf8');
const body=source.match(/resume\(\) \{([\s\S]*?)\}, refreshRoutes(?:\s*:|\s*\()/)[1];
const recoveryBody=source.match(/resumeRecovery\(peer:string\) \{([\s\S]*?)\},\s+resume\(\)/)[1];
function fixture(){
 let now=1,sequence=0;const timers=new Map(),counts={private:0,group:0,transport:0,media:0};
 const task=run=>createEventDeadlineTask({now:()=>now,run,schedule:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},cancel:id=>timers.delete(id)});
 function inbox(name){const polls=createRelayPollSchedule(()=>now,10,()=>true);const work=task(async()=>{const pass=polls.begin('relay');if(pass){counts[name]++;pass.finish({empty:true,item:false});}return polls.nextDeadline(['relay']);});return {polls,work};}
 const p=inbox('private'),g=inbox('group'),transport=task(async()=>{counts.transport++;return Infinity;}),state=task(async()=>{});
 const workers=[state,transport,p.work,g.work],pump=()=>workers.forEach(w=>w.runDue());
 const resume=new Function('stateWork','runtime','transportWork','courier','groupCourier','privateInboxWork','groupInboxWork','ownAttachments','pump',body).bind(null,state,{resume(){}},transport,p.polls,g.polls,p.work,g.work,{wake(){counts.media++;}},pump);
 return {counts,timers,resume,pump,workers,async idle(){workers.forEach(w=>w.changed());pump();await new Promise(setImmediate);assert.equal(timers.size,0);},async settle(){await new Promise(setImmediate);},stop(){workers.forEach(w=>w.stop());}};
}
test('verified hint resumes private and group inboxes already asleep on an unchanged connection, without firing JS timers',async()=>{
 const f=fixture();await f.idle();assert.deepEqual(f.counts,{private:1,group:1,transport:1,media:0});
 // A bare tick cannot wake idle inboxes: this was the old FCM path.
 f.pump();await f.settle();assert.equal(f.counts.private,1);
 f.resume();await f.settle();assert.deepEqual(f.counts,{private:2,group:2,transport:2,media:1});assert.equal(f.timers.size,0);
 for(let i=0;i<100;i++)f.pump();await f.settle();assert.equal(f.counts.private,2);f.stop();
});
test('repeated hints coalesce and stopped coordinators cannot start reads',async()=>{
 const f=fixture();await f.idle();for(let i=0;i<20;i++)f.resume();await f.settle();f.pump();await f.settle();
 assert(f.counts.private<=3);assert(f.counts.group<=3);f.stop();const before=f.counts.private;f.resume();await f.settle();assert.equal(f.counts.private,before);
});
test('targeted wake resumes only the requested relay without restarting transport discovery',()=>{
 const calls=[];
 const resume=new Function('peer','courier','groupCourier','privateInboxWork','groupInboxWork','ownAttachments','pump',recoveryBody);
 resume('custodian',{resume:p=>calls.push(['private',p])},{resume:p=>calls.push(['group',p])},
  {changed:()=>calls.push('private-inbox')},{changed:()=>calls.push('group-inbox')},{wake:()=>calls.push('media')},()=>calls.push('pump'));
 assert.deepEqual(calls,[['private','custodian'],['group','custodian'],'private-inbox','group-inbox','media','pump']);
});
