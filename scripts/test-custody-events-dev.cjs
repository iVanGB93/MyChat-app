// Synthetic in-memory fixtures; no accounts, chats, or real network messages.
const {run}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 if(!targets.length)throw Error('No Axonic Dev runtime connected');
 for(const target of targets){
  const result=await run(target,`
   const {createCustodyEvents}=get('src/services/identity/custodyEvents.ts');
   const {createEventDeadlineTask}=get('src/services/identity/eventDeadlineTask.ts');
   const {createRelayPollSchedule}=get('src/services/identity/relayPollSchedule.ts');
   const assert=(ok,why)=>{if(!ok)throw Error(why);};let now=0,calls=0;
   const schedule=createRelayPollSchedule(()=>now,10,()=>true);
   schedule.begin('peer').finish({empty:true,item:false});
   for(let i=0;i<1000;i++){now+=15000;assert(schedule.begin('peer')===null,'idle poll');}
   const receiver=createCustodyEvents({current:()=>true,now:()=>now,peers:()=>['sender'],request:async()=>null,reconcile:()=>schedule.resume('peer')});
   const sender=createCustodyEvents({current:()=>true,now:()=>now,peers:()=>['peer'],reconcile:()=>{},request:async(_peer,raw)=>{calls++;return receiver.receive('sender',raw);}});
   sender.changed('peer');await new Promise(r=>setTimeout(r,0));
   assert(calls===1&&sender.diagnostics().pending===0,'notice ACK');
   assert(!!schedule.begin('peer'),'event must reactivate inbox');
   let runs=0;const task=createEventDeadlineTask({now:Date.now,run:async()=>{runs++;}});for(let i=0;i<100;i++)task.changed();await new Promise(r=>setTimeout(r,20));assert(runs===1,'coalesced state work');await new Promise(r=>setTimeout(r,20));assert(runs===1,'idle state work');task.stop();sender.stop();receiver.stop();return {stateEventsCoalesced:true,passed:true,inMemory:true,idleCycles:1000,eventAcknowledged:true};
  `);console.log(JSON.stringify({runtime:target.title,...result}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
