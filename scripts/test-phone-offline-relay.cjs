// Dev-only store-and-forward test. Both apps restored in finally; no data resets.
const {run,until}=require('./test-two-phone-dev.cjs'),{acceptanceTargets}=require('./dev-acceptance-targets.cjs');
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),q=JSON.stringify;
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const launch=serial=>execFileSync(adb,['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);
async function main(){
 let [phone,emulator]=await acceptanceTargets();
 if(!phone.deviceName.startsWith('SM-S948U1')||!emulator.id.startsWith('715a'))throw Error('Known Dev pair required');
 const baseline=async t=>run(t,`const s=await ledger().snapshot();return {owner:account.status().account,keys:s.messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
 const before=await Promise.all([baseline(phone),baseline(emulator)]);
 const reconnect=async id=>(await until(async()=>{
  const t=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).find(t=>t.appId==='com.axonic.dev'&&t.id===id);
  if(!t)return null;
  try{return await run(t,`return account.status().state==='unlocked'&&!account.status().busy;`)?t:null;}catch{return null;}
 },'Unlocked Dev reconnect')).value;
 let stoppedPhone=false,stoppedEmulator=false;
 try{
  execFileSync(adb,['-s','R3GYC0H7PMY','shell','am','force-stop','com.axonic.dev']);stoppedPhone=true;
  const uploadStart=performance.now(),timingBefore=await run(emulator,`return get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentTimings();`);
  const id=await run(emulator,`const fapi=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),f=new fapi.File(fapi.Paths.cache,'DEV-relay-'+Date.now()+'.bin');f.write(new Uint8Array(5_000_000).fill(91));try{return await get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentSource(${q(before[0].owner)},f.uri,'DEV-offline-relay-5MB.bin','application/octet-stream');}finally{f.delete();}`);
  const stored=(await until(()=>run(emulator,`const jobs=await get('src/services/identity/mobileAttachmentJobs.ts').createMobileAttachmentJobs().list(account.status().account);const j=jobs.find(j=>j.descriptor.manifest.id===${q(id)});return j?.phase==='confirming'&&j.custodians.length?{digest:j.digest,custodians:j.custodians}:null;`),'Relay custody while phone offline',240000)).value;
  const uploadObservedMs=Math.round(performance.now()-uploadStart),timingAfter=await run(emulator,`return get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentTimings();`);
  const uploadStages=Object.fromEntries(Object.entries(timingAfter?.stages||{}).map(([k,v])=>[k,{calls:v.calls-(timingBefore?.stages?.[k]?.calls||0),milliseconds:v.milliseconds-(timingBefore?.stages?.[k]?.milliseconds||0)}]));
  console.log(JSON.stringify({uploadObservedMs,uploadStages}));
  execFileSync(adb,['-s','emulator-5554','shell','am','force-stop','com.axonic.dev']);stoppedEmulator=true;
  launch('R3GYC0H7PMY');stoppedPhone=false;phone=await reconnect(phone.id);
  const start=performance.now();
  const received=(await until(()=>run(phone,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${q(id)}&&m.direction==='incoming');if(m?.status!=='delivered'||!m.attachment)return null;const files=get('src/services/identity/rootAttachmentFiles.ts'),j=await get('src/services/identity/mobileAttachmentJobs.ts').createMobileAttachmentJobs().get(account.status().account,${q(stored.digest)});return {hash:await files.hashRootAttachmentFile(account.status().account,${q(stored.digest)},5_000_000),checksum:m.attachment.checksum,sources:j?.receivedSources,coverage:j?.sourceCoverage};`),'Offline sender relay delivery',180000)).value;
  if(received.hash!==received.checksum||!received.coverage||!received.sources?.length||received.sources.includes(before[1].owner))throw Error('Relay checksum/source proof failed');
  const result={id,bytes:5_000_000,checksum:true,senderOffline:true,uploadObservedMs,uploadStages,receivedSources:received.sources,receiveObservedMs:Math.round(performance.now()-start)};
  fs.writeFileSync(process.env.DEV_RESULT_PATH||'builds/phone-offline-relay-20261023.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{
  if(stoppedPhone)launch('R3GYC0H7PMY');if(stoppedEmulator)launch('emulator-5554');
  phone=await reconnect(phone.id);emulator=await reconnect(emulator.id);
  const after=await Promise.all([baseline(phone),baseline(emulator)]);
  if(before.some((b,i)=>b.owner!==after[i].owner||b.keys.some(k=>!after[i].keys.includes(k))))throw Error('History preservation failed');
  console.log(JSON.stringify({restoredBothDevApps:true,historyPreserved:true}));
 }
}
main().catch(e=>{console.error(e.message);process.exit(1);});
