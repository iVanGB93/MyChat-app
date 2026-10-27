// Live synthetic benchmark. Only phone Dev, discovered emulator, First/ThirdNeuron.
const {spawn}=require('node:child_process'),fs=require('node:fs');
const {run}=require('./test-two-phone-dev.cjs');
const q=JSON.stringify,wait=ms=>new Promise(r=>setTimeout(r,ms));
const worker=fs.readFileSync('D:/Proyects/Axonic/builds/transfer-benchmark-worker.mjs','utf8');
const encoded=Buffer.from(worker).toString('base64');
function remote(name,command,args){
 const p=spawn(command,args,{stdio:['pipe','pipe','pipe']}),pending=new Map();let seq=0,buffer='';
 let readyResolve,readyReject;const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
 p.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);if(m.ready){readyResolve();continue;}const d=pending.get(m.seq);if(d){pending.delete(m.seq);clearTimeout(d.timer);m.error?d.reject(Error(name+': '+m.error)):d.resolve(m.value);}}catch{readyReject(Error(name+' invalid worker output'));}}});
 p.stderr.on('data',()=>{});
 p.on('exit',code=>{readyReject(Error(name+' worker exited '+code));for(const d of pending.values()){clearTimeout(d.timer);d.reject(Error(name+' disconnected'));}});
 return {name,ready,close:()=>p.stdin.end(),call:async c=>{await ready;return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(name+' timeout'));},120000);pending.set(id,{resolve,reject,timer});p.stdin.write(JSON.stringify({...c,seq:id})+'\n');});}};
}
function mobile(name,t){return {name,call:async c=>{
 if(c.op==='inventory')return run(t,`return {account:account.status().account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
 if(c.op==='audit')return run(t,`const s=await ledger().snapshot();return s.messages.filter(m=>m.attachment?.name?.startsWith('DEV-speed-')&&m.attachment.manifest.bytes===1048576&&m.at>=${c.since}).map(m=>({peer:m.peer,id:m.id,direction:m.direction,status:m.status,queuedAt:m.queuedAt,deliveredAt:m.deliveredAt,messageDelivery:m.messageDelivery,attachmentDelivery:m.attachmentDelivery,attachmentDigest:get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest),checksum:m.attachment.checksum,bytes:m.attachment.manifest.bytes}));`);
 if(c.op==='info')return run(t,`const s=account.status();if(s.state!=='unlocked'||s.busy)throw Error('Test account locked');const n=get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot();return {account:s.account,peers:n?.pool?.connections?.map(c=>({account:c.account,route:c.route,state:c.state})),messageCount:(await ledger().snapshot()).messages.length,streamAttempts:get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentStreamDiagnostics?.(),timings:get('src/services/identity/rootAttachmentRuntime.ts').rootAttachmentTimings()?.stages};`);
 if(c.op==='accept')return run(t,`const c=(await ledger().snapshot()).contacts.find(c=>c.account===${q(c.peer)});if(c?.blocked)throw Error('Test peer blocked');if(!c?.accepted)await ledger().configure(${q(c.peer)},{accepted:true});return {accepted:true};`);
 if(c.op==='fixture')return run(t,`const start=performance.now();const fs=find(/expo-file-system.*index\\.(ts|js)$/);const f=new fs.File(fs.Paths.cache,'DEV-speed-'+Date.now()+'.bin');f.create();const bytes=new Uint8Array(${c.size});let x=(Date.now()|0)||123;for(let i=0;i<bytes.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;bytes[i]=x&255;}const generated=performance.now();f.write(bytes);const written=performance.now();const checksum=get('node_modules/@noble/hashes/utils.js').bytesToHex(get('node_modules/@noble/hashes/sha2.js').sha256(bytes));return {uri:f.uri,name:f.name,bytes:bytes.length,checksum,timing:{generateMs:generated-start,writeMs:written-generated,hashMs:performance.now()-written}};`);
 if(c.op==='send'){
  const fixture=c.fixture??await mobile(name,t).call({op:'fixture',size:c.size});
  return run(t,`const fixture=${q(fixture)},started=performance.now();const id=await get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentSource(${q(c.peer)},fixture.uri,fixture.name,'application/octet-stream');return {id,checksum:fixture.checksum,bytes:fixture.bytes,prepareMs:performance.now()-started,preparationStages:{selectionStageMs:performance.now()-started},fixtureTiming:fixture.timing};`);
 }
 if(c.op==='observe')return run(t,`const s=get('src/services/identity/rootChatActions.ts').rootChatView(account.status().account,await ledger().snapshot());const rows=s.messages.filter(m=>m.id===${q(c.id)}&&m.peer===${q(c.peer)}&&m.direction===${q(c.direction)});if(rows.length>1)throw Error('Duplicate test message');const m=rows[0];return m?{status:m.status,delivery:m.delivery,attachmentDigest:m.attachment?get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest):null,bytes:m.attachment?.manifest.bytes,checksum:m.attachment?.checksum}:null;`);
 if(c.op==='verify')return run(t,`const owner=account.status().account,files=get('src/services/identity/rootAttachmentFiles.ts'),file=files.rootAttachmentFile(owner,${q(c.digest)});return {bytes:file.size,checksum:await files.hashRootAttachmentFile(owner,${q(c.digest)},file.size)};`);
 throw Error('Unknown operation');}};}
async function main(){
 const first=remote('FirstNeuron','ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i','C:/Users/iVan/.ssh/axonic-neuron-admin','root@143.198.121.2',`/opt/node22/bin/node --input-type=module -e "await import('data:text/javascript;base64,${encoded}')" axonic-neuron`]);
 const third=remote('ThirdNeuron','wsl',['--user','root','--exec','/home/ivan/.nvm/versions/node/v24.22.0/bin/node','--input-type=module','-e',`await import('data:text/javascript;base64,${encoded}')`,'axonic-thirdneuron']);
 const results=[];
 try{
 const all=await(await fetch('http://127.0.0.1:8081/json/list')).json(),pt=all.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1')),et=all.find(t=>t.appId==='com.axonic'&&t.deviceName.startsWith('sdk_gphone64_x86_64'));
 if(!pt||!et)throw Error('Phone Dev and emulator must be connected');
 const phone=mobile('Phone Dev',pt),emulator=mobile('Emulator',et),endpoints=[first,third,phone,emulator];
 for(const e of endpoints){console.log(JSON.stringify({checking:e.name}));e.info=await e.call({op:'info'});console.log(JSON.stringify({endpoint:e.name,ready:true,release:e.info.release?.shortRevision,connections:e.info.peers?.length}));}
 // Detect emulator snapshot clock drift before creating any synthetic traffic.
 for(const t of [pt,et]){const before=Date.now(),deviceTime=await run(t,'return Date.now();'),after=Date.now();if(deviceTime<before-5000||deviceTime>after+5000)throw Error('Test device clock differs by over five seconds; synchronize it before RTC benchmarking');}
 if(process.argv.includes('--inspect-only'))return;
 if(process.argv.includes('--audit-only')){let verified=0,outgoing=0;for(const e of endpoints){const rows=await e.call({op:'audit',since:Date.parse('2026-10-17T21:20:00Z')});for(const r of rows){if(r.status!=='delivered')throw Error('Unconfirmed test file');if(r.direction==='incoming'){const v=await e.call({op:'verify',digest:r.attachmentDigest});if(v.bytes!==r.bytes||v.checksum!==r.checksum)throw Error('Audit checksum mismatch');verified++;}else outgoing++;}console.log(JSON.stringify({audit:e.name,files:rows.map(r=>({peer:endpoints.find(x=>x.info.account===r.peer)?.name??'other',direction:r.direction,status:r.status,localQueueToReceiptMs:r.deliveredAt&&r.queuedAt?r.deliveredAt-r.queuedAt:null,payloadMethod:r.attachmentDelivery?.method,payloadScope:r.attachmentDelivery?.scope,observedRelayCount:r.attachmentDelivery?.relays?.length}))}));}console.log(JSON.stringify({verifiedIncomingFiles:verified,confirmedOutgoingFiles:outgoing}));return;}
 const pairs=process.argv.includes('--mobile-only')?[[phone,emulator]]:process.argv.includes('--phone-aon-only')?[[phone,first]]:[[first,third],[phone,first],[phone,emulator]];
 for(const [a,b] of pairs){
  await a.call({op:'accept',peer:b.info.account});await b.call({op:'accept',peer:a.info.account});
  for(const [sender,receiver,repetitions] of [[a,b,process.argv.includes('--single')?1:3],[b,a,1]])for(let repeat=1;repeat<=repetitions;repeat++){
   const beforeSender=await sender.call({op:'info'}),beforeReceiver=await receiver.call({op:'info'});
   const begin=performance.now(),sent=await sender.call({op:'send',peer:receiver.info.account,size:1048576}),queued=performance.now();let incoming=null;
   while(performance.now()-queued<180000){incoming=await receiver.call({op:'observe',peer:sender.info.account,id:sent.id,direction:'incoming'});if(incoming?.status==='delivered')break;await wait(500);}
   if(incoming?.status!=='delivered')throw Error(sender.name+' to '+receiver.name+' timed out');
   const complete=performance.now(),verified=await receiver.call({op:'verify',digest:incoming.attachmentDigest});
   if(verified.bytes!==sent.bytes||verified.checksum!==sent.checksum)throw Error('Checksum mismatch');
   const outgoing=await sender.call({op:'observe',peer:receiver.info.account,id:sent.id,direction:'outgoing'});
   const network=await sender.call({op:'info'});
   const afterReceiver=await receiver.call({op:'info'}),delta=(a,b)=>Object.fromEntries(Object.entries(b??{}).map(([key,v])=>[key,{calls:v.calls-(a?.[key]?.calls??0),milliseconds:v.milliseconds-(a?.[key]?.milliseconds??0),errors:v.errors-(a?.[key]?.errors??0)}]));
   console.log(JSON.stringify({timingStages:{sender:sender.name,receiver:receiver.name,senderDelta:delta(beforeSender.timings,network.timings),receiverDelta:delta(beforeReceiver.timings,afterReceiver.timings)}}));
   const row={from:sender.name,to:receiver.name,repeat,bytes:sent.bytes,prepareMs:Math.round(sent.prepareMs),enqueueCallMs:Math.round(queued-begin),postEnqueueToObservedCompleteMs:Math.round(complete-queued),endToEndObservedMs:Math.round(complete-begin),effectiveKiBps:Math.round(sent.bytes/1024/((complete-begin)/1000)),checksumMatches:true,senderStatus:outgoing?.status,receiverStatus:incoming.status,directPeerConnected:network.peers?.some(p=>p.account===receiver.info.account&&(!p.state||p.state==='connected')),deliveryEvidence:outgoing?.delivery};
   results.push(row);console.log(JSON.stringify(row));
  }
 }
 console.log(JSON.stringify({complete:true,transfers:results.length,scope:'Synthetic files only; no data deletion or normal phone app changes'}));
 }finally{first.close();third.close();}
}
module.exports={remote,mobile};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
