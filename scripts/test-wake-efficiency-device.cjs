// Explicit Dev-only fixture: isolated SQLite database, synthetic identities,
// fake gateway, no chat/network sends or changes to existing app storage.
const fs=require('node:fs'),ts=require('typescript'),WebSocket=require('ws');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
function evaluate(target,expression){return new Promise((resolve,reject)=>{
 const socket=new WebSocket(target.webSocketDebuggerUrl),timer=setTimeout(()=>{socket.close();reject(Error('Dev debugger timeout'));},25000);
 socket.on('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
 socket.on('error',e=>{clearTimeout(timer);reject(e);});socket.on('message',raw=>{const m=JSON.parse(raw);if(m.id!==1)return;clearTimeout(timer);socket.close();if(m.result?.exceptionDetails)reject(Error(JSON.stringify(m.result.exceptionDetails)));else resolve(m.result?.result?.value);});
});}
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const target=process.env.AXONIC_DEV_TARGET?targets.find(t=>t.id===process.env.AXONIC_DEV_TARGET):targets.length===1?targets[0]:null;if(!target)throw Error('Choose one connected Axonic Dev with AXONIC_DEV_TARGET');
 const expression=`(()=>{globalThis.__wakeEfficiencyTest={pending:true};(async()=>{
 const get=name=>{const entry=[...__r.getModules()].find(([id,m])=>m.verboseName===name);if(!entry)throw Error('Module unavailable '+name);return __r(entry[0]);};
 const find=pattern=>{const entry=[...__r.getModules()].find(([id,m])=>pattern.test(m.verboseName));if(!entry)throw Error('SQLite unavailable');return __r(entry[0]);};
 const sql=find(/expo-sqlite[\\/]build[\\/]index\\.js$/),name='wake-efficiency-fixture-'+Date.now()+'.db';
 const db=await sql.openDatabaseAsync(name,{useNewConnection:true});
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 try{
 const p=get('src/services/identity/identityProtocol.ts'),c=get('src/services/identity/custodyProtocol.ts'),service=get('src/services/identity/custodyService.ts');
 const seeds=n=>new Uint8Array(32).fill(n);let now=Date.now();
 const device=p.publicDevice(seeds(2),seeds(3)),sender=p.issueRecord(seeds(1),[device],now),recipient=p.issueRecord(seeds(4),[p.publicDevice(seeds(5),seeds(6))],now);
 const records={read:async account=>account===sender.account?sender:recipient};
 const deps={'expo-sqlite':{openDatabaseAsync:async()=>db},'./identityProtocol':p,'./custodyService':service,'./custodyService.ts':service,'./custodyProtocol.ts':c};
 const storeModule={},wakeModule={};
 new Function('require','exports',${JSON.stringify(compile('src/services/identity/mobileCustodyStore.ts'))})(n=>deps[n],storeModule);
 new Function('require','exports',${JSON.stringify(compile('src/services/identity/custodyWakeForwarder.ts'))})(n=>deps[n],wakeModule);
 const store=storeModule.createMobileCustodyStore(recipient.account),other=storeModule.createMobileCustodyStore(recipient.account);
 const seal=id=>c.sealCustody({record:sender,signingSeed:seeds(2),encryptionSeed:seeds(3),recipient,recipientDevice:recipient.devices[0].id,id,text:'synthetic fixture',now,random:async n=>new Uint8Array(n).fill(9)});
 const deposit=e=>other.transaction(rows=>rows.push({sender:e.sender,recipient:e.recipient,id:e.id,recipientDevice:e.recipientDevice,expires:e.expires,digest:c.custodyDigest(e),packet:e}));
 const first=await seal('ab'.repeat(32));await deposit(first);let calls=0;
 const maintenance=['axonic-avatar-fetch-v1','axonic-avatar-offer-v1','axonic-group-members-v1','axonic-group-leave-v1','axonic-group-recover-v1','axonic-group-backup-v1','axonic-group-recovery-offer-v1'];
 for(const tag of maintenance){
  const e=await c.sealCustody({record:sender,signingSeed:seeds(2),encryptionSeed:seeds(3),recipient,recipientDevice:recipient.devices[0].id,id:'ae'.repeat(32),text:JSON.stringify([tag,'peer','id',{}]),now,random:async n=>new Uint8Array(n).fill(10)});
  assert(e.wakeMode==='silent','maintenance alert '+tag);
  assert(c.verifyCustodyWake(c.createCustodyWake(e,sender),sender,e.recipient,e.recipientDevice,now)?.wakeMode==='silent','unsigned silence');
 }
 const worker=wakeModule.createCustodyWakeForwarder({store,records,now:()=>now,current:()=>true,peers:()=>['synthetic-gateway'],request:async()=>{calls++;return '{"status":"forwarded"}';}});
 await worker.tick();for(let i=0;i<29;i++){now+=1000;await worker.tick();}
 assert(worker.diagnostics().work.storeReads===1,'idle reads');assert(calls===1,'duplicate gateway call');
 const second=await seal('ac'.repeat(32));await deposit(second);now+=1000;await worker.tick();assert(calls===2,'new deposit delayed');
 const revision=store.revision();try{await other.transaction(()=>{throw Error('expected rollback');});}catch{}assert(store.revision()===revision,'rollback changed revision');
 const invalid=await seal('ad'.repeat(32));invalid.wakeSignature='00'.repeat(64);await deposit(invalid);now+=1000;await worker.tick();
 assert(calls===2,'invalid wake transmitted');assert(worker.diagnostics().outcomes.local_wake_verification_failed===1,'missing rejection diagnosis');
 assert((await store.inspect()).length===3,'fixture ciphertext lost');worker.stop();
 return {passed:true,signedSilentMaintenanceTypes:maintenance.length,idleChecks:30,idleStoreReads:1,gatewayCalls:calls,invalidWakeRetained:true,crossFactoryWriteObserved:true,rollbackPreserved:true};
 }finally{await db.closeAsync();await sql.deleteDatabaseAsync(name);}
 })().then(value=>globalThis.__wakeEfficiencyTest={value},error=>globalThis.__wakeEfficiencyTest={error:String(error)});return true;})()`;
 await evaluate(target,ts.transpileModule(expression,{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText);
 try{for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,200));const state=await evaluate(target,'globalThis.__wakeEfficiencyTest');if(state&&!state.pending){if(state.error)throw Error(state.error);console.log(JSON.stringify(state.value));return;}}throw Error('Dev fixture timeout');}
 finally{await evaluate(target,'delete globalThis.__wakeEfficiencyTest').catch(()=>{});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
