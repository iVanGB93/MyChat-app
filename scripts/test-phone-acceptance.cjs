const {run,until}=require('./test-two-phone-dev.cjs');
const {acceptanceTargets}=require('./dev-acceptance-targets.cjs');
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe',q=JSON.stringify;
async function main(){
 let [phone,emulator]=await acceptanceTargets();
 if(!phone.deviceName.startsWith('SM-S948U1')||!emulator.deviceName.startsWith('sdk_gphone'))throw Error('Expected phone Dev then emulator Dev');
 const inspect=t=>run(t,`const s=await ledger().snapshot();return {owner:account.status().account,keys:s.messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
 const baseline=await Promise.all([inspect(phone),inspect(emulator)]),results=[];
 const save=()=>fs.writeFileSync(process.env.DEV_RESULT_PATH||'builds/phone-acceptance-20261023.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
 const timing=t=>run(t,`return get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentTimings();`);
 for(const bytes of process.env.DEV_TEN_MB_ONLY==='1'?[10_000_000]:[1_000_000,5_000_000,10_000_000])for(const reverse of [false,true]){
  const [sender,receiver,from,to]=reverse?[emulator,phone,baseline[1].owner,baseline[0].owner]:[phone,emulator,baseline[0].owner,baseline[1].owner];
  const before=await Promise.all([timing(sender),timing(receiver)]),start=performance.now();
  const id=await run(sender,`const fs=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),f=new fs.File(fs.Paths.cache,'DEV-acceptance-'+Date.now()+'.bin');f.write(new Uint8Array(${bytes}).fill(83));try{return await get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentSource(${q(to)},f.uri,'DEV-acceptance-${bytes}.bin','application/octet-stream');}finally{f.delete();}`);
  const queued=performance.now();
  const row=(await until(()=>run(receiver,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${q(id)}&&m.peer===${q(from)}&&m.direction==='incoming');if(m?.status!=='delivered'||!m.attachment)return null;const d=get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest),files=get('src/services/identity/rootAttachmentFiles.ts'),f=files.rootAttachmentFile(account.status().account,d);return {digest:d,checksum:m.attachment.checksum,bytes:f.size,uri:f.uri};`),'Received file',180000)).value;
  const received=performance.now(),hash=await run(receiver,`return get('src/services/identity/rootAttachmentFiles.ts').hashRootAttachmentFile(account.status().account,${q(row.digest)},${bytes});`);
  if(row.bytes!==bytes||hash!==row.checksum)throw Error('Checksum/size mismatch');
  const after=await Promise.all([timing(sender),timing(receiver)]);
  const stages=after.map((a,i)=>Object.fromEntries(Object.entries(a?.stages||{}).map(([key,v])=>[key,{calls:v.calls-(before[i]?.stages?.[key]?.calls||0),milliseconds:v.milliseconds-(before[i]?.stages?.[key]?.milliseconds||0),errors:v.errors-(before[i]?.stages?.[key]?.errors||0)}])));
  results.push({test:'file',direction:reverse?'emulator to phone':'phone to emulator',bytes,endToEndObservedMs:Math.round(received-start),enqueueMs:Math.round(queued-start),checksum:true,sharedStorage:row.uri.startsWith('content://media/'),stages});save();console.log(JSON.stringify(results.at(-1)));
 }
 if(process.env.DEV_TRANSFER_ONLY==='1')return;
 const serial='R3GYC0H7PMY';
 if(execFileSync(adb,['-s',serial,'shell','getprop','ro.product.model'],{encoding:'utf8'}).trim()!=='SM-S948U1')throw Error('Wrong phone');
 let id;
 try{
  execFileSync(adb,['-s',serial,'shell','am','force-stop','com.axonic.dev']);
  id=await run(emulator,`return messaging.sendText(${q(baseline[0].owner)},'[DEV ACCEPTANCE] Queued during Dev restart '+Date.now());`);
 }finally{execFileSync(adb,['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);}
 phone=(await until(async()=>(await(await fetch('http://127.0.0.1:8081/json/list')).json()).find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1')),'Debugger reconnect')).value;
 await until(async()=>{try{return await run(phone,`const rows=(await ledger().snapshot()).messages.filter(m=>m.id===${q(id)}&&m.direction==='incoming');if(rows.length>1)throw Error('Duplicate');return rows.length===1&&rows[0].status==='delivered';`);}catch{return false;}},'Queued delivery after reconnect',90000);
 const after=await Promise.all([inspect(phone),inspect(emulator)]);
 if(baseline.some((b,i)=>b.owner!==after[i].owner||b.keys.some(k=>!after[i].keys.includes(k))))throw Error('Baseline preservation failed');
 results.push({test:'reconnect',queuedDeliveredOnce:true,identitiesAndHistoryPreserved:true});save();console.log(JSON.stringify(results.at(-1)));
}
main().catch(e=>{console.error(e.message);process.exit(1);});
