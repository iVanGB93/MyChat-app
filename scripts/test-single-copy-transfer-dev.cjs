const fs=require('node:fs'),{run,until}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=await require('./dev-acceptance-targets.cjs').acceptanceTargets();
 if(targets.length!==2)throw Error('Need two Dev emulators');const [a,b]=targets;
 const [aa,bb]=await Promise.all(targets.map(t=>run(t,`if(account.status().state!=='unlocked')throw Error('Unlock Dev');return account.status().account;`)));
 const id=await run(a,`const fs=find(/expo-file-system[\\/]src[\\/]index\\.ts$/);const f=new fs.File(fs.Paths.cache,'single-copy-test-'+Date.now()+'.bin');f.write(new Uint8Array(5_000_000).fill(73));try{return await get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentSource(${JSON.stringify(bb)},f.uri,'single-copy-dev-test.bin','application/octet-stream');}finally{f.delete();}`);
 const check=(t,peer,direction,id)=>run(t,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${JSON.stringify(id)}&&m.peer===${JSON.stringify(peer)}&&m.direction===${JSON.stringify(direction)});if(!m?.attachment||m.status!=='delivered')return null;const d=get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest);const files=get('src/services/identity/rootAttachmentFiles.ts');const f=files.rootAttachmentFile(account.status().account,d);return {id:m.id,digest:d,uri:f.uri,exists:f.exists,size:f.size,checksum:m.attachment.checksum};`);
 const sent=(await until(async()=>{const v=await check(a,bb,'outgoing',id);return v?.uri.startsWith('content://media/')?v:null;},'Sender canonical media',180000)).value;
 const received=(await until(async()=>{const v=await check(b,aa,'incoming',id);return v?.uri.startsWith('content://media/')?v:null;},'Receiver canonical media',180000)).value;
 for(const [t,row] of [[a,sent],[b,received]]){
  const hash=await run(t,`return get('src/services/identity/rootAttachmentFiles.ts').hashRootAttachmentFile(account.status().account,${JSON.stringify(row.digest)},5_000_000);`);
  if(!row.exists||row.size!==5_000_000||hash!==row.checksum)throw Error('Shared media mismatch');
 }
 // Forward the received file back; no new permanent source copy on the forwarder.
 await run(b,`await get('src/services/identity/rootMessageForward.ts').forwardRootMessage({peer:${JSON.stringify(aa)},id:${JSON.stringify(id)},direction:'incoming'},${JSON.stringify(aa)});return true;`);
 const forwarded=(await until(async()=>run(b,`const rows=(await ledger().snapshot()).messages.filter(m=>m.direction==='outgoing'&&m.peer===${JSON.stringify(aa)}&&m.attachment?.name==='single-copy-dev-test.bin'&&m.status==='delivered');for(const m of rows){const d=get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest);const f=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,d);if(f.uri===${JSON.stringify(received.uri)})return {id:m.id,uri:f.uri};}return null;`),'Forwarded media reuses original',180000)).value;
 const result={at:new Date().toISOString(),bytes:5_000_000,sent,received,forwarded,checksumVerifiedBoth:true,forwardReusesOriginal:true};
 fs.writeFileSync(process.env.DEV_RESULT_PATH||'builds/single-copy-transfer-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
