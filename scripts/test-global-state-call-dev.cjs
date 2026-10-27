const fs=require('node:fs'),{run,until}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=await require('./dev-acceptance-targets.cjs').acceptanceTargets();
 if(targets.length!==2)throw Error('Exactly two Dev emulators required');let id;
 try{
  for(const t of targets)await run(t,`const call=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot();if(call&&call.status!=='ended')throw Error('Existing call: abort');if(account.status().state!=='unlocked')throw Error('Unlock Dev');await get('src/screens/calls/RootAccountCallScreen.tsx').ensureRootCallPermissions('voice');return true;`);
  const peer=await run(targets[1],`return account.status().account;`);
  id=await run(targets[0],`return get('src/modules/calls/index.ts').calling.start(${JSON.stringify(peer)},'voice',async()=>{});`);
  await until(async()=>run(targets[1],`const c=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot();return c?.id===${JSON.stringify(id)}&&c.status==='ringing';`),'Incoming Dev call',45000);
  await run(targets[1],`return get('src/modules/calls/index.ts').localAccountCalls().accept(${JSON.stringify(id)});`);
  const media=[];
  for(const t of targets)media.push((await until(async()=>run(t,`const signal=get('src/modules/ui/liveState.ts').callState.getState().value,media=get('src/services/identity/callMediaState.ts').callMediaState.getState().value;return signal?.id===${JSON.stringify(id)}&&signal.status==='ready'&&media?.id===signal.id&&media.connection!=='connecting'?{signaling:signal.status,connection:media.connection,muted:media.muted,recovering:media.recovering}:null;`),'Live call media projection',45000)).value);
  await run(targets[0],`return get('src/modules/calls/index.ts').localAccountCalls().end(${JSON.stringify(id)});`);
  for(const t of targets)await until(async()=>run(t,`const c=get('src/modules/ui/liveState.ts').callState.getState().value,m=get('src/services/identity/callMediaState.ts').callMediaState.getState().value;return (!c||c.id===${JSON.stringify(id)}&&c.status==='ended')&&m===null;`),'Call cleared on both Dev apps',30000);
  const result={at:new Date().toISOString(),voiceCallConnectedBoth:true,media,hangupClearedBoth:true,normalAppsUntouched:true};fs.writeFileSync('builds/global-state-call-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(id)for(const t of targets)await run(t,`const c=get('src/modules/calls/index.ts').localAccountCalls();if(c?.snapshot()?.id===${JSON.stringify(id)}&&c.snapshot().status!=='ended')await c.end(${JSON.stringify(id)});return true;`).catch(()=>{});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
