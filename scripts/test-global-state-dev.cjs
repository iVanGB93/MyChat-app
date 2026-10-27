// Two emulator Dev accounts only. Add labeled test traffic; preserve existing history.
const fs=require('node:fs'),{run,until}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=await require('./dev-acceptance-targets.cjs').acceptanceTargets();
 if(targets.length!==2)throw Error('Exactly two Dev emulators required');
 const owners=[];
 try{
  for(const t of targets)owners.push(await run(t,`if(account.status().state!=='unlocked')throw Error('Unlock Dev');
   const history=await ledger().snapshot();const chats=get('src/modules/ui/chatState.ts').chatState,transfers=get('src/modules/ui/transferState.ts').transferState;
   if(globalThis.__globalStateAudit)throw Error('Prior audit still active');
   const audit=globalThis.__globalStateAudit={keys:history.messages.map(m=>m.direction+':'+m.peer+':'+m.id),chatEvents:0,transferEvents:0,stops:[]};
   audit.stops.push(chats.subscribe(()=>audit.chatEvents++),transfers.subscribe(()=>audit.transferEvents++));
   return account.status().account;`));
  if(owners[0]===owners[1])throw Error('Distinct Dev identities required');
  for(let i=0;i<2;i++)await run(targets[i],`const c=(await ledger().snapshot()).contacts.find(c=>c.account===${JSON.stringify(owners[1-i])});if(!c?.accepted||c.blocked)throw Error('Dev peer must already be approved');return true;`);
  const results=[];
  for(let i=0;i<2;i++){
   const id=await run(targets[i],`return messaging.sendText(${JSON.stringify(owners[1-i])},'[DEV STATE TEST] Shared state '+Date.now());`);
   const delivered=await until(async()=>run(targets[1-i],`const s=get('src/modules/ui/chatState.ts').chatState.getState();const m=s.state.messages.find(m=>m.id===${JSON.stringify(id)}&&m.direction==='incoming');return m?.status==='delivered'&&s.rooms[${JSON.stringify(owners[i])}]?.some(m=>m.id===${JSON.stringify(id)});`),'Message in shared conversation index');
   results.push({direction:i===0?'A to B':'B to A',deliveredAndIndexed:true,observedMs:delivered.elapsedMs});
  }
  const media=await run(targets[0],`const fs=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),file=new fs.File(fs.Paths.cache,'global-state-'+Date.now()+'.bin');file.write(new Uint8Array(5_000_000).fill(81));try{return await get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentSource(${JSON.stringify(owners[1])},file.uri,'DEV-global-state-5MB.bin','application/octet-stream');}finally{file.delete();}`);
  await until(async()=>run(targets[1],`const m=(await ledger().snapshot()).messages.find(m=>m.id===${JSON.stringify(media)}&&m.direction==='incoming');return m?.status==='delivered';`),'5 MB delivery',180000);
  const received=await run(targets[1],`const m=(await ledger().snapshot()).messages.find(m=>m.id===${JSON.stringify(media)}&&m.direction==='incoming');const d=get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest),files=get('src/services/identity/rootAttachmentFiles.ts');return {bytes:files.rootAttachmentFile(account.status().account,d).size,checksumMatches:await files.hashRootAttachmentFile(account.status().account,d,5000000)===m.attachment.checksum};`);
  if(received.bytes!==5000000||!received.checksumMatches)throw Error('Media checksum mismatch');
  const evidence=[];
  for(const t of targets)evidence.push(await run(t,`const a=globalThis.__globalStateAudit,s=await ledger().snapshot(),keys=new Set(s.messages.map(m=>m.direction+':'+m.peer+':'+m.id));
   const live=get('src/modules/ui/liveState.ts'),view=get('src/modules/ui/chatState.ts').chatState.getState();
   return {historyPreserved:a.keys.every(k=>keys.has(k)),chatEvents:a.chatEvents,transferEvents:a.transferEvents,ownerMatches:view.owner===account.status().account,connections:live.networkState.getState().value.liveConnections.length};`));
  if(evidence.some(e=>!e.historyPreserved||!e.ownerMatches||!e.transferEvents))throw Error('State preservation or observation failed');
  const result={at:new Date().toISOString(),text:results,media:received,devices:evidence,normalAppsUntouched:true};
  fs.writeFileSync(process.env.DEV_RESULT_PATH||'builds/global-state-dev-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{for(const t of targets)await run(t,`const a=globalThis.__globalStateAudit;if(a)for(const off of a.stops)off();delete globalThis.__globalStateAudit;return true;`).catch(()=>{});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
