// Authorized FirstNeuron -> phone Dev notification/recovery checks. Never force-stop FCM receiver.
const fs=require('node:fs'),{execFileSync,spawn}=require('node:child_process'),{randomBytes}=require('node:crypto');
const {remote,mobile}=require('./benchmark-live-transfers.cjs'),{createDevSession,run}=require('./test-two-phone-dev.cjs');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe',serial='R3GYC0H7PMY',wait=ms=>new Promise(r=>setTimeout(r,ms)),q=JSON.stringify;
async function main(){
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json(),target=targets.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1'));if(!target)throw Error('Open phone Dev');
 const session=createDevSession(target);await session.call('Runtime.enable');const phone=mobile('Phone Dev',session);
 let code=fs.readFileSync('D:/Proyects/Axonic/builds/transfer-benchmark-worker.mjs','utf8');code=code.replace("if(c.op==='inventory')",`if(c.op==='text'){if(!c.text.startsWith('DEV notification test'))throw Error('Test text only');const id=randomBytes(32).toString('hex');await post({peer:c.peer,id,text:c.text});return {id};} if(c.op==='inventory')`);
 const encoded=Buffer.from(code).toString('base64'),first=remote('FirstNeuron','ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i','C:/Users/iVan/.ssh/axonic-neuron-admin','root@143.198.121.2',`/opt/node22/bin/node --input-type=module -e "await import('data:text/javascript;base64,${encoded}')" axonic-neuron`]);
 const report={started:new Date().toISOString(),rows:[]},output='builds/notification-recovery-'+Date.now()+'.json';
 const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
 report.wakeLogs=[];const log=spawn(adb,['-s',serial,'logcat','-v','epoch','-s','ReactNativeJS']);let logbuf='';log.stdout.on('data',b=>{logbuf+=b;let at;while((at=logbuf.indexOf('\n'))>=0){const l=logbuf.slice(0,at);logbuf=logbuf.slice(at+1);if(/Axonic (recovery payload|background wake|message wake|stream lease|notification timing)/.test(l)){report.wakeLogs.push(l);if(report.wakeLogs.length>200)report.wakeLogs.shift();}}});
 try{
  const pb=await phone.call({op:'inventory'}),nb=await first.call({op:'inventory'});const owner=pb.account,peer=nb.account;
  for(const size of (process.argv.includes('--ten-only')?[10]:process.argv.includes('--text-only')?[0]:process.argv.includes('--media-only')?[5,10]:[0,5,10])){
   execFileSync(adb,['-s',serial,'shell','input','keyevent','3']);console.log(JSON.stringify({backgrounding:true,sizeMiB:size}));await wait(35000);
   let before=await run(session,`return {state:find(/react-native[\\/]index\\.js$/).AppState.currentState,network:get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot(),journal:get('src/services/diagnosticJournal.ts').diagnosticJournal.snapshot()};`);
   if(before.state==='active')throw Error('Dev must be backgrounded');
   const idleDeadline=Date.now()+120000;
   while((before.network?.sessions?.length??0)>0&&Date.now()<idleDeadline){await wait(3000);before=await run(session,`return {state:find(/react-native[\\/]index\\.js$/).AppState.currentState,network:get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot()};`);}
   if(before.state==='active'||(before.network?.sessions?.length??0)>0)throw Error('No disconnected background window; no test sent');
   const timingBefore=await run(session,`return {attachments:get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentTimings(),ledger:ledger().diagnostics()};`);
   const start=Date.now(),sent=await first.call(size?{op:'send',peer:owner,size:size*1048576}:{op:'text',peer:owner,text:'DEV notification test: inline text '+Date.now()});
   const row={sizeMiB:size,id:sent.id,started:start,timingBefore,sendCallMs:Date.now()-start,senderPrepareMs:sent.prepareMs,senderPreparation:sent.preparationStages,backgroundBefore:before.state,networkBefore:before.network,notificationMs:null,completeMs:null};report.rows.push(row);save();console.log(JSON.stringify({sent:true,sizeMiB:size,id:sent.id}));
   while(Date.now()-start<90000){
    const state=await run(session,`const snap=await ledger().snapshot(),m=snap.messages.find(m=>m.id===${q(sent.id)}&&m.peer===${q(peer)}&&m.direction==='incoming');const nf=find(/@notifee.*[\\/]index\\.(ts|js)$/).default;const notices=(await nf.getDisplayedNotifications()).map(n=>n.notification).filter(n=>{try{return JSON.parse(n.data?.messagePreviews||'[]').some(p=>p.id===${q(sent.id)});}catch{return false;}});return {appState:find(/react-native[\\/]index\\.js$/).AppState.currentState,status:m?.status,digest:m?.attachment?get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest):null,notifications:notices.length,journal:get('src/services/diagnosticJournal.ts').diagnosticJournal.snapshot().events.filter(e=>e.at>=${start}),streamAttempts:get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentStreamDiagnostics()};`);
    row.latest=state;if(state.notifications&&row.notificationMs===null)row.notificationMs=Date.now()-start;
    if(state.status==='delivered'){if(row.completeMs===null)row.completeMs=Date.now()-start;if(size&&!row.checksumMatches){const v=await phone.call({op:'verify',digest:state.digest});row.checksumMatches=v.bytes===sent.bytes&&v.checksum===sent.checksum;if(!row.checksumMatches)throw Error('Checksum mismatch');}if(state.notifications||Date.now()-start-row.completeMs>10000)break;}save();await wait(1000);
   }
   row.timingAfter=await run(session,`return {attachments:get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentTimings(),ledger:ledger().diagnostics()};`);
   row.outgoing=await first.call({op:'observe',peer:owner,id:sent.id,direction:'outgoing'});save();console.log(JSON.stringify({sizeMiB:size,notificationMs:row.notificationMs,completeMs:row.completeMs,checksum:row.checksumMatches,status:row.latest?.status}));
   if(!row.completeMs){report.blocked='Background completion not observed; preserving pending work';break;}
  }
  const pa=await phone.call({op:'inventory'}),na=await first.call({op:'inventory'});report.preserved=pa.account===pb.account&&na.account===nb.account&&pb.keys.every(k=>pa.keys.includes(k))&&nb.keys.every(k=>na.keys.includes(k));if(!report.preserved)throw Error('Baseline preservation failed');
 }catch(e){report.error=e.message;throw e;}finally{
  log.kill();save();console.log(JSON.stringify({output}));session.close();first.close();execFileSync(adb,['-s',serial,'shell','am','start','-n','com.axonic.dev/com.axonic.MainActivity']);
  const logs=execFileSync(adb,['-s',serial,'logcat','-d','-t','3000','-s','ReactNativeJS'],{encoding:'utf8'});fs.writeFileSync(output+'.wake.log',logs.split('\n').filter(l=>/Axonic.*(wake|recovery)/i.test(l)).join('\n'));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
