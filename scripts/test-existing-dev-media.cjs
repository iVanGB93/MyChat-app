// Explicitly authorized phone-only readiness check. Re-sends existing photo,
// video and audio files only between the two already accepted Dev accounts.
// No generated fixtures, normal app access, contact changes, or data deletion.
const fs=require('node:fs');
const {run}=require('./test-two-phone-dev.cjs');
const q=JSON.stringify,wait=ms=>new Promise(r=>setTimeout(r,ms));
const report={utc:new Date().toISOString(),rows:[],preservation:[]};
const output='builds/existing-dev-media-'+Date.now()+'.json';
const baseline=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const photoName=process.argv[3];
if(!photoName)throw Error('Supply the name of a visually verified existing real photo; do not infer from MIME/size');
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const devices=baseline.phones.map(d=>({...d,t:targets.find(t=>t.id.split('-')[0]===d.target.split('-')[0])}));
 if(devices.length!==2||devices.some(d=>!d.t)||devices[0].owner===devices[1].owner)throw Error('Two distinct known Dev accounts required');
 const inspect=d=>run(d.t,`if(account.status().account!==${q(d.owner)}||account.status().state!=='unlocked')throw Error('Dev account changed');return (await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id);`);
 const state=(d,peer,id,direction)=>run(d.t,`const v=get('src/services/identity/rootChatActions.ts').rootChatView(account.status().account,await ledger().snapshot());const m=v.messages.find(m=>m.peer===${q(peer)}&&m.id===${q(id)}&&m.direction===${q(direction)});return m?{status:m.status,read:!!m.read,digest:m.attachment?get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest):null}:null;`);
 try{
  for(const d of devices){
   const keys=await inspect(d);if(d.keys.some(k=>!keys.includes(k)))throw Error('Baseline data missing');
   await run(d.t,`const native=get('modules/axonic-nearby/index.ts').default;if(!native.attachmentStageStream)throw Error('Native handoff update missing');if(globalThis.__readinessCapture)throw Error('Existing check active');
    const original=console.info,capture=globalThis.__readinessCapture={events:[]};capture.restore=()=>{console.info=original;clearTimeout(capture.timer);delete globalThis.__readinessCapture;};
    console.info=(...args)=>{if(args[0]==='[Axonic direct attachment]'&&typeof args[1]==='string'){try{capture.events.push(JSON.parse(args[1]));if(capture.events.length>100)capture.events.shift();}catch{}}return original(...args);};capture.timer=setTimeout(capture.restore,600000);return true;`);
  }
  for(const [sender,receiver] of [[devices[0],devices[1]],[devices[1],devices[0]]]){
   const selected=await run(sender.t,`const owner=account.status().account,v=get('src/services/identity/rootChatActions.ts').rootChatView(owner,await ledger().snapshot());
    const c=v.contacts.find(c=>c.account===${q(receiver.owner)});if(!c?.accepted||c.blocked)throw Error('Dev peer not accepted');
    const candidates=v.messages.filter(m=>m.peer===${q(receiver.owner)}&&!m.group&&!m.deleted&&m.attachment&&!/(dev.test|benchmark|synthetic|comparison|fixture)/i.test(m.attachment.name)&&(!m.attachment.mime.startsWith('image/')||m.attachment.name===${q(photoName)}));
    return ['image/','video/','audio/'].map(type=>{const m=candidates.filter(m=>m.attachment.mime.startsWith(type)).sort((a,b)=>b.attachment.manifest.bytes-a.attachment.manifest.bytes)[0];if(!m)throw Error('Existing real media missing');return {id:m.id,direction:m.direction,type,bytes:m.attachment.manifest.bytes};});`);
   for(const source of selected){
    await run(receiver.t,'globalThis.__readinessCapture.events=[];return true;');
    const start=performance.now();
    const sent=await run(sender.t,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${q(source.id)}&&m.peer===${q(receiver.owner)}&&m.direction===${q(source.direction)});if(!m?.attachment)throw Error('Source no longer available');
     const a=m.attachment,f=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,get('src/services/identity/attachmentProtocol.ts').attachmentDigest(a.manifest));if(!f.exists||f.size!==a.manifest.bytes)throw Error('Source incomplete');
     const id=await get('src/services/identity/rootAttachmentRuntime.ts').queueRootAttachmentSource(${q(receiver.owner)},f.uri,a.name,a.mime,account.status().account);return {id,checksum:a.checksum,bytes:a.manifest.bytes};`);
    let received;
    while(performance.now()-start<120000){received=await state(receiver,sender.owner,sent.id,'incoming');if(received?.status==='delivered')break;await wait(350);}
    if(received?.status!=='delivered')throw Error('Real media delivery timed out; pending work preserved');
    const elapsed=Math.round(performance.now()-start);
    const checked=await run(receiver.t,`const file=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,${q(received.digest)});return {bytes:file.size,hash:await get('modules/axonic-nearby/index.ts').default.attachmentFileSha256(account.status().account,${q(received.digest)},true,file.size)};`);
    if(checked.hash!==sent.checksum||checked.bytes!==sent.bytes)throw Error('Real file checksum mismatch');
    let receipt;for(let n=0;n<80;n++){receipt=await state(sender,receiver.owner,sent.id,'outgoing');if(receipt?.status==='delivered')break;await wait(350);}
    if(receipt?.status!=='delivered')throw Error('Sender receipt not yet confirmed');
    const events=await run(receiver.t,'return globalThis.__readinessCapture.events;');
    const row={from:sender.label,to:receiver.label,type:source.type,bytes:sent.bytes,observedEndToEndMs:elapsed,checksumMatches:true,senderDelivered:true,streamVerified:events.some(e=>e.direction==='receive'&&e.result==='verified'&&e.bytes===sent.bytes),events};
    report.rows.push(row);save();console.log(JSON.stringify(row));
   }
  }
  report.completed=true;
 }finally{
  for(const d of devices){try{await run(d.t,'globalThis.__readinessCapture?.restore();return true;');const keys=await inspect(d);const preserved=d.keys.every(k=>keys.includes(k));report.preservation.push({phone:d.label,before:d.keys.length,after:keys.length,allBaselineRecordsPreserved:preserved});if(!preserved)throw Error('Baseline records missing');}catch(e){report.preservation.push({phone:d.label,error:e.message});process.exitCode=1;}}
  save();console.log(JSON.stringify({output,completed:!!report.completed,preservation:report.preservation}));
 }
}
main().catch(e=>{report.error=e.message;save();console.error(e.message);process.exitCode=1;});
