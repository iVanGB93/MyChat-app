// In-memory signed fixtures only. No real identities, network sends, SQLite,
// notifications, chat mutations, reset, deletion or OS settings changes.
const fs=require('node:fs');const {run}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const prefixes=['737378d0ee3d6d92454bdc00c70a11f88cb4b621','c105964d4a6122be03ab7886c02d4590978b87bd'];
 const selected=prefixes.map(p=>targets.filter(t=>t.id.split('-')[0]===p));
 if(selected.some(a=>a.length!==1))throw Error('Both exact authorized Dev targets required');
 const results=[];
 for(const [target] of selected){const result=await run(target,`
  const assert=(value,why)=>{if(!value)throw Error(why);};
  const p=get('src/services/identity/identityProtocol.ts'),c=get('src/services/identity/custodyProtocol.ts'),wake=get('src/services/identity/custodyWakeForwarder.ts');
  const group=get('src/services/identity/groupCustodyProtocol.ts'),groupService=get('src/services/identity/groupCustodyService.ts'),report=get('src/services/diagnosticReport.ts');
  const seed=n=>new Uint8Array(32).fill(n);let now=Date.now(),checks=0;
  const device=p.publicDevice(seed(2),seed(3)),sender=p.issueRecord(seed(1),[device],now),recipient=p.issueRecord(seed(4),[p.publicDevice(seed(5),seed(6))],now);
  for(const silent of [false,true]){
   const e=await c.sealCustody({record:sender,signingSeed:seed(2),encryptionSeed:seed(3),recipient,recipientDevice:recipient.devices[0].id,id:(silent?'ab':'ac').repeat(32),text:silent?JSON.stringify(['axonic-root-action-v1','peer','id',{kind:'read'}]):'in-memory wake test',now,random:async n=>new Uint8Array(n).fill(silent?9:10)});
   const data=c.createCustodyWake(e,sender,true),verify=d=>c.verifyCustodyWake(d,sender,e.recipient,e.recipientDevice,now),event=verify(data);
   assert(!!event,'valid signature');assert(!!c.custodyWakeEnvelope(data,event,now),'valid inline lost');checks+=2;
   let reloaded=e;for(let hop=0;hop<3;hop++){reloaded=c.parseCustody(JSON.stringify(reloaded),now);assert(!!reloaded,'roundtrip parse');assert(c.createCustodyWake(reloaded,sender,true).event===data.event,'signed bytes changed');checks+=2;}
   const replayRows=[{sender:e.sender,recipient:e.recipient,id:e.id,recipientDevice:e.recipientDevice,expires:e.expires,digest:c.custodyDigest(e),packet:reloaded}],before=JSON.stringify(replayRows);let simulatedRequests=0;
   const forward=wake.createCustodyWakeForwarder({inlineEnvelope:true,store:{read:async fn=>fn(JSON.parse(JSON.stringify(replayRows))),transaction:async()=>{throw Error('Unexpected write');}},records:{read:async id=>id===sender.account?sender:recipient},current:()=>true,now:()=>now,peers:()=>['fixture-gateway'],request:async(_peer,raw)=>{
    simulatedRequests++;const next=JSON.parse(raw).data;assert(next.event===data.event,'fallback changed signed bytes');assert(!!verify(next),'fallback wake rejected');return JSON.stringify({status:next.envelope?'rejected':'forwarded'});
   }});
   try{await forward.tick();assert(simulatedRequests===2,'legacy fallback missing');assert(JSON.stringify(replayRows)===before,'wake changed custody');checks+=2;}finally{forward.stop();}
   const altered={...e};if(silent)delete altered.wakeMode;else altered.wakeMode='silent';
   for(const bad of [altered,{...e,wakeSignature:'00'.repeat(64)},{...e,wakeSignature:undefined}]){
    const incoming={...data,envelope:JSON.stringify(bad)};
    assert(!!verify(incoming),'signed hint lost');assert(c.custodyWakeEnvelope(incoming,event,now)===null,'inconsistent inline accepted');checks+=2;
   }
   const badData=c.createCustodyWake(altered,sender,true);assert(verify(badData)===null,'changed signed flag accepted');checks++;
   const row={sender:e.sender,recipient:e.recipient,id:e.id,recipientDevice:e.recipientDevice,expires:e.expires,digest:c.custodyDigest(e),packet:altered},rows=[row],original=JSON.stringify(rows);
   let calls=0;const worker=wake.createCustodyWakeForwarder({store:{read:async fn=>fn(rows),transaction:async()=>{throw Error('Unexpected mutation');},revision:()=>1},records:{read:async id=>id===sender.account?sender:recipient},current:()=>true,now:()=>now,peers:()=>['in-memory-gateway'],request:async()=>{calls++;throw Error('No network allowed');}});
   try{await worker.tick();now+=1000;await worker.tick();assert(calls===0,'invalid wake requested');assert(worker.diagnostics().outcomes.local_silent_flag_binding_mismatch===1,'missing precise reason');assert(JSON.stringify(rows)===original,'ciphertext changed');checks+=3;}finally{worker.stop();}
   const third=p.issueRecord(seed(11),[p.publicDevice(seed(12),seed(13))],now);let fixtureRandom=30;
   const job=await group.sealGroupCustody({record:sender,signingSeed:seed(2),encryptionSeed:seed(3),id:'ef'.repeat(32),text:silent?JSON.stringify(['axonic-root-group-action-v1','peer','id',{kind:'read'}]):'fixture group text',recipients:[recipient,third].map((r,i)=>({record:r,device:r.devices[0].id,id:(i?'bb':'aa').repeat(32),metadata:'{}'})),now,random:async n=>new Uint8Array(n).fill(fixtureRandom++)});
   const saved=JSON.parse(JSON.stringify([{sender:sender.account,expires:job.payload.expires,accepted:true,recipients:job.grants.map(grant=>({id:grant.id,recipient:grant.recipient,recipientDevice:grant.recipientDevice,grant,receipt:null,consumed:false}))}]));
   const view=groupService.groupCustodyWakeStore({transaction:async fn=>fn(saved)}),packets=await view.transaction(r=>r.map(row=>row.packet));
   assert(packets.length===2,'group wake rows missing');checks++;
   for(const grant of packets){const hint=c.createCustodyWake(grant,sender),verified=c.verifyCustodyWake(hint,sender,grant.recipient,grant.recipientDevice,now);assert(!!verified,'group wake signature');assert(verified.wakeMode===(silent?'silent':undefined),'group silence lost');checks+=2;}
  }
  const sample={requests:4,lastOutcome:'local_silent_flag_binding_mismatch',lastObservedAt:123,nextRetryAt:456,peer:'DO_NOT_EXPORT',text:'DO_NOT_EXPORT'};
  const projected=report.summarizeWakeForReport({private:{pendingSample:Array(20).fill(sample)},group:{pendingSample:[sample]}});
  assert(projected.private.pendingSample.length===8,'pending sample bound');assert(projected.group.pendingSample[0].lastOutcome===sample.lastOutcome,'group reason missing');assert(!JSON.stringify(projected).includes('DO_NOT_EXPORT'),'report privacy');checks+=3;
  return {passed:true,checks,scope:'In-memory fixtures only',networkCalls:0,storageMutations:0};
 `);results.push({target:target.id,...result});console.log(JSON.stringify(results.at(-1)));}
 const file='builds/wake-binding-dev-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(results,null,2),{flag:'wx'});console.log(file);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
