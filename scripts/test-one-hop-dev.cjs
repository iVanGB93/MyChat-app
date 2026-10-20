// In-memory protocol fixtures only. No account/chat writes or network messages.
const {run}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 if(!targets.length)throw Error('No Axonic Dev runtime connected');
 for(const target of targets){
  const result=await run(target,`
   const p=get('src/services/identity/identityProtocol.ts'),c=get('src/services/identity/custodyProtocol.ts'),s=get('src/services/identity/custodyService.ts'),w=get('src/services/identity/custodyWakeForwarder.ts');
   const assert=(ok,why)=>{if(!ok)throw Error(why);},now=Date.now(),seed=n=>new Uint8Array(32).fill(n);
   const ids=[1,4,7].map(n=>({signingSeed:seed(n+1),encryptionSeed:seed(n+2),record:p.issueRecord(seed(n),[p.publicDevice(seed(n+1),seed(n+2))],now)}));
   const [sender,relay,recipient]=ids,records={read:async account=>ids.find(i=>i.record.account===account)?.record??null};
   const packet=await c.sealCustody({...sender,recipient:recipient.record,recipientDevice:recipient.record.devices[0].id,id:'ab'.repeat(32),text:'synthetic one-hop fixture',now,random:async n=>new Uint8Array(n).fill(12)});
   let rows=[],saved=false,pushes=0,lastReply=null;
   const store={transaction:async fn=>{const next=JSON.parse(JSON.stringify(rows));const value=fn(next);rows=next;return value;}};
   const service=s.createCustodyService({owner:relay.record.account,records,store,now:()=>now,current:()=>true});
   const receiver=s.createCustodyService({owner:recipient.record.account,records,store:{transaction:async()=>{throw Error('No transit deposit');}},now:()=>now,current:()=>true,receiveOwn:async e=>{
    assert(c.openCustody(e,recipient.record.account,recipient.signingSeed,recipient.encryptionSeed)==='synthetic one-hop fixture','decryption');saved=true;return c.signCustodyReceipt(e,recipient.signingSeed,recipient.encryptionSeed);
   }});
   assert(JSON.parse(await service.receive(sender.record.account,JSON.stringify({operation:'deposit',packet}))).status==='held','deposit');
   const worker=w.createCustodyWakeForwarder({store,records,now:()=>now,current:()=>true,peers:()=>[],request:async()=>{pushes++;return null;},deliverDirect:e=>service.deliverDirect(e,async(peer,raw)=>{lastReply=await receiver.receive(relay.record.account,raw);return lastReply;})});
   try{await worker.tick();assert(saved&&rows[0].packet.kind==='receipt'&&pushes===0,'direct delivery/receipt '+JSON.stringify({saved,kind:rows[0].packet.kind,pushes,reply:lastReply&&JSON.parse(lastReply).status,diagnostics:worker.diagnostics()}));}finally{worker.stop();}
   const data=c.createCustodyWake(packet,sender.record,true,relay.record.account);
   assert(data.custodian===relay.record.account&&!!data.envelope,'encrypted inline hint');
   assert(new TextEncoder().encode(JSON.stringify(data)).length<=c.CUSTODY_WAKE_DATA_BYTES,'FCM budget');
   return {passed:true,inMemory:true,signedReceipt:true,inlineCiphertext:true};
  `);
  console.log(JSON.stringify({runtime:target.title,...result}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
