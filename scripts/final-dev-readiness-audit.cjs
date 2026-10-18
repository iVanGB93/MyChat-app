// Read-only integrity audit, with optional restart of Dev processes only.
// Existing files are read and hashed; no fixtures, messages or receipts created.
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {run}=require('./test-two-phone-dev.cjs');
const q=JSON.stringify,wait=ms=>new Promise(r=>setTimeout(r,ms));
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const serials={A:'R3GYC0H7PMY',B:'R3GL10CNS1K'};
const report={utc:new Date().toISOString(),phones:[]},output='builds/final-dev-readiness-'+Date.now()+'.json';
const targets=async()=>(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
const cmd=(d,args)=>execFileSync(adb,['-s',serials[d.label],...args],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:15000});
const official=d=>cmd(d,['shell','dumpsys','package','com.axonic']).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l));
const inspect=d=>run(d.t,`const s=account.status();if(s.state!=='unlocked'||s.account!==${q(d.owner)})throw Error('Dev identity changed or locked');const raw=await ledger().snapshot();
 const v=get('src/services/identity/rootChatActions.ts').rootChatView(s.account,raw);const n=get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot();
 return {keys:raw.messages.map(m=>m.peer+':'+m.direction+':'+m.id),media:v.messages.filter(m=>m.attachment&&!m.deleted).map(m=>({digest:get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest),bytes:m.attachment.manifest.bytes,checksum:m.attachment.checksum})),
  network:{connected:n.pool?.connections?.filter(c=>c.state==='connected').length,rtc:n.rtc?.filter(c=>c.open).length},
  nativeAtomicStage:typeof get('modules/axonic-nearby/index.ts').default.attachmentStageStream==='function',
  testGlobals:['__phoneAB','__axonicTransferComparison','__actualChunkExperiment','__readinessCapture'].filter(k=>globalThis[k])};`);
async function main(){
 const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),list=await targets();
 const devices=base.phones.map(d=>({...d,t:list.find(t=>t.id.split('-')[0]===d.target.split('-')[0])}));
 if(devices.length!==2||devices.some(d=>!d.t||!serials[d.label]))throw Error('Both known Dev targets required');
 for(const d of devices){d.before=await inspect(d);d.official=official(d);if(d.keys.some(k=>!d.before.keys.includes(k)))throw Error('Original baseline missing');}
 if(process.argv.includes('--restart-dev')){
  for(const d of devices)cmd(d,['shell','am','force-stop','com.axonic.dev']);
  for(const d of devices)cmd(d,['shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);
  let ready=false;const deadline=Date.now()+120000;
  while(Date.now()<deadline){try{const current=await targets();for(const d of devices){d.t=current.find(t=>t.id.split('-')[0]===d.target.split('-')[0]);if(!d.t)throw Error('Waiting for Dev');await inspect(d);}ready=true;break;}catch{await wait(1000);}}
  if(!ready)throw Error('Dev reconnect blocked; no data changed');report.restartedDevOnly=true;
 }
 for(const d of devices){
  const after=await inspect(d),preserved=d.before.keys.every(k=>after.keys.includes(k));
  const unique=[...new Map(after.media.map(m=>[m.digest,m])).values()];let verified=0;
  for(let i=0;i<unique.length;i+=8){
   const rows=await run(d.t,`const owner=account.status().account,native=get('modules/axonic-nearby/index.ts').default,files=get('src/services/identity/rootAttachmentFiles.ts');let verified=0;for(const m of ${q(unique.slice(i,i+8))}){const f=files.rootAttachmentFile(owner,m.digest);if(!f.exists||f.size!==m.bytes)throw Error('Saved Dev attachment unavailable');const hash=await native.attachmentFileSha256(owner,m.digest,true,m.bytes);if(hash!==m.checksum)throw Error('Saved Dev attachment checksum mismatch');verified++;}return verified;`);
   verified+=rows;
  }
  const officialUnchanged=JSON.stringify(d.official)===JSON.stringify(official(d));
  const row={phone:d.label,originalMessages:d.keys.length,beforeRestart:d.before.keys.length,afterRestart:after.keys.length,allBaselineRecordsPreserved:preserved,verifiedExistingFiles:verified,nativeAtomicStage:after.nativeAtomicStage,testGlobals:after.testGlobals,officialPackageUnchanged:officialUnchanged,network:after.network};
  report.phones.push(row);console.log(JSON.stringify(row));
  if(!preserved||!officialUnchanged||after.testGlobals.length)throw Error('Final safety assertion failed');
 }
 // Allow normal background connection establishment; do not create a test send.
 const deadline=Date.now()+60000;let reconnected=false;
 while(Date.now()<deadline){const snapshots=await Promise.all(devices.map(inspect));if(snapshots.every(s=>s.network.connected>=1)){report.networkAfterRecovery=snapshots.map((s,i)=>({phone:devices[i].label,...s.network}));reconnected=true;break;}await wait(1000);}
 if(!reconnected)throw Error('Connected route not yet recovered');
 report.apkSha256=crypto.createHash('sha256').update(fs.readFileSync('android/app/build/outputs/apk/debug/app-debug.apk')).digest('hex');
 report.completed=true;
}
main().catch(e=>{report.error=e.message;console.error(e.message);process.exitCode=1;}).finally(()=>{fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,completed:!!report.completed}));});
