// Real offline store-and-forward tests. Stops ONLY com.axonic.dev, never normal apps.
// No routing overrides: report and verify actual custodians and stream counters.
const {run,until,evaluate}=require('./test-two-phone-dev.cjs');
const {execFileSync}=require('node:child_process'),fs=require('node:fs');
const q=JSON.stringify,adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const allowed=['axonic:1:778f81f35399db5b3bfa5068e34aad2a4389f851b64aebc997cd453879cd008f','axonic:1:77fe994da47f6239debbe70b516eede89d8645796e6803e41b1701b5df0df0fa'];
const launch=e=>execFileSync(adb,['-s',e.serial,'shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev'],{stdio:'pipe'});
const halt=e=>{execFileSync(adb,['-s',e.serial,'shell','am','force-stop','com.axonic.dev']);e.stopped=true;};
const snapshot=e=>run(e.target,`return {owner:account.status().account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
const network=e=>run(e.target,`return (get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot()?.sessions??[]).filter(s=>s.state==='connected').map(s=>({account:s.account,traffic:s.traffic,timeouts:s.consecutiveMediaTimeouts}));`);
async function connect(e){e.target=(await until(async()=>{
 const t=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).find(t=>t.id===e.id&&t.appId==='com.axonic.dev');
 if(!t)return null;try{return await run(t,`return account.status().state==='unlocked'&&!account.status().busy;`)?t:null;}catch{return null;}
},e.name+' Dev reconnect',90000)).value;e.stopped=false;}
async function main(){
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json();
 const pt=targets.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1')),et=targets.find(t=>t.appId==='com.axonic.dev'&&t.id.startsWith('715a'));
 if(!pt||!et)throw Error('Known phone Dev and emulator Dev pair must be connected');
 const phone={name:'Phone Dev',serial:'R3GYC0H7PMY',id:pt.id,target:pt},emulator={name:'Emulator Dev',serial:'emulator-5554',id:et.id,target:et},ends=[phone,emulator];
 const out='builds/live-relay-streams-'+Date.now()+'.json',result={started:new Date().toISOString(),release:'643e045',bytesPerMB:1000000,rows:[],measurement:'One run per size/direction. Upload: enqueue invocation to observed complete relay custody (includes preparation). Download: receiver launch to observed verified file (includes startup/reconnect). Deliberate offline gap excluded; not raw link speed.'};
 const save=()=>fs.writeFileSync(out,JSON.stringify(result,null,2));
 for(const e of ends){e.before=await snapshot(e);e.owner=e.before.owner;}
 const normalBefore=execFileSync(adb,['-s',phone.serial,'shell','dumpsys','package','com.axonic'],{encoding:'utf8'}).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l));
 try{
  for(const e of ends){
   await evaluate(e.target,`setTimeout(()=>{const m=[...__r.getModules()].find(([id,m])=>/react-native[\\/]index\\.js$/.test(m.verboseName));__r(m[0]).DevSettings.reload();},100);true`);
  }
  await new Promise(r=>setTimeout(r,2500));for(const e of ends)await connect(e);
  for(const [a,b] of [[phone,emulator],[emulator,phone]])await run(a.target,`const c=(await ledger().snapshot()).contacts.find(c=>c.account===${q(b.owner)});if(!c?.accepted||c.blocked)throw Error('Dev peer is not approved');return true;`);
  const requested=process.argv.find(a=>a.startsWith('--direction='))?.split('=')[1];
  for(const mb of [1,5,10])for(const [sender,receiver] of (requested==='upload'?[[phone,emulator]]:requested==='download'?[[emulator,phone]]:[[phone,emulator],[emulator,phone]])){
   console.log(JSON.stringify({starting:mb,from:sender.name,to:receiver.name}));
   halt(receiver);
   await until(async()=>!(await network(sender)).some(s=>s.account===receiver.owner),'Recipient disconnected',30000);
   const beforeNet=await network(sender);
   const fixture=await run(sender.target,`const fapi=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),f=new fapi.File(fapi.Paths.cache,'DEV-relay-stream-'+Date.now()+'.bin');const b=new Uint8Array(${mb*1000000});let x=1729;for(let i=0;i<b.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;b[i]=x&255;}f.write(b);return {uri:f.uri,name:f.name};`);
   const start=performance.now();
   const id=await run(sender.target,`return await get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentSource(${q(receiver.owner)},${q(fixture.uri)},${q(fixture.name)},'application/octet-stream');`);
   const queued=performance.now();
   const stored=(await until(()=>run(sender.target,`const js=await get('src/services/identity/mobileAttachmentJobs.ts').createMobileAttachmentJobs().list(account.status().account),j=js.find(j=>j.descriptor.manifest.id===${q(id)});return j?.phase==='confirming'&&j.cursor===Math.ceil(j.descriptor.manifest.bytes/3000000)&&j.custodians.length?{digest:j.digest,custodians:j.custodians,checksum:j.descriptor.checksum,cursor:j.cursor}:null;`),'Complete encrypted relay custody',240000)).value;
   const storedAt=performance.now(),afterNet=await network(sender);
   const streamCredits=stored.custodians.reduce((n,p)=>n+(afterNet.find(s=>s.account===p)?.traffic?.['relay-block-stream']??0)-(beforeNet.find(s=>s.account===p)?.traffic?.['relay-block-stream']??0),0);
   if(!stored.custodians.every(p=>allowed.includes(p))||streamCredits<=0)throw Error('Custody did not prove the updated AoN streaming path');
   halt(sender);
   const receiveStart=performance.now();launch(receiver);await connect(receiver);
   const received=(await until(()=>run(receiver.target,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${q(id)}&&m.direction==='incoming');if(m?.status!=='delivered'||!m.attachment)return null;const j=await get('src/services/identity/mobileAttachmentJobs.ts').createMobileAttachmentJobs().get(account.status().account,${q(stored.digest)});const files=get('src/services/identity/rootAttachmentFiles.ts'),f=files.rootAttachmentFile(account.status().account,${q(stored.digest)});return {bytes:f.size,checksum:await files.hashRootAttachmentFile(account.status().account,${q(stored.digest)},f.size),sources:j?.receivedSources,coverage:j?.sourceCoverage,receipt:!!j?.receipt};`),'Verified relay download',240000)).value;
   const receivedAt=performance.now(),receiveNet=await network(receiver);
   if(received.bytes!==mb*1000000||received.checksum!==stored.checksum||!received.coverage||!received.receipt||!received.sources?.length||received.sources.some(p=>!allowed.includes(p)))throw Error('Relay integrity/source/receipt check failed');
   const downloadFrames=received.sources.reduce((n,p)=>n+(receiveNet.find(s=>s.account===p)?.traffic?.['relay-block-stream']??0),0);
   if(downloadFrames<=0)throw Error('Download did not use the streamed relay path');
   launch(sender);await connect(sender);
   await until(()=>run(sender.target,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${q(id)}&&m.direction==='outgoing');return m?.status==='delivered';`),'Sender signed receipt',90000);
   // Only the temporary fixture created above; never erase user media/history.
   await run(sender.target,`const fapi=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),f=new fapi.File(${q(fixture.uri)});if(f.exists)f.delete();return true;`);
   const row={mb,bytes:mb*1000000,from:sender.name,to:receiver.name,id,blocks:stored.cursor,custodians:stored.custodians,sources:received.sources,enqueueMs:Math.round(queued-start),uploadToCustodyMs:Math.round(storedAt-start),downloadIncludingStartupMs:Math.round(receivedAt-receiveStart),streamCredits,downloadFrames,checksum:true,signedReceipt:true};result.rows.push(row);save();console.log(JSON.stringify(row));
  }
 }catch(e){result.error=e.message;save();throw e;}
 finally{
  for(const e of ends){if(e.stopped)launch(e);await connect(e);const after=await snapshot(e);if(after.owner!==e.before.owner||e.before.keys.some(k=>!after.keys.includes(k)))throw Error('Baseline history changed');}
  const normalAfter=execFileSync(adb,['-s',phone.serial,'shell','dumpsys','package','com.axonic'],{encoding:'utf8'}).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l));
  result.historyPreserved=true;result.normalAppUnchanged=JSON.stringify(normalBefore)===JSON.stringify(normalAfter);result.finished=new Date().toISOString();save();console.log(JSON.stringify({output:out,historyPreserved:true,normalAppUnchanged:result.normalAppUnchanged,restoredBothDevApps:true}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
