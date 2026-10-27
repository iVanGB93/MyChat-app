// Fault injection only: shared acquisition fails; real call selection must create TURN fallback.
// No peer connection is supplied by the harness; production call logic owns creation and cleanup.
// Explicitly authorized two-Dev-account call checks; no normal app or history mutation.
const {run,until}=require('./test-two-phone-dev.cjs');
async function main(){
 const targets=await require('./dev-acceptance-targets.cjs').acceptanceTargets((process.env.DEV_TARGET_IDS||'').split(',').filter(Boolean));
 if(targets.length!==2)throw Error('Exactly two Dev debugger targets required');
 const mode=process.argv[2]??'stats';
 if(mode==='start'){
  const owners=[];
  for(const t of targets)owners.push(await run(t,`if(account.status().state!=='unlocked')throw Error('Unlock Dev');const call=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot();if(call&&call.status!=='ended')throw Error('Existing call; refusing test');return account.status().account;`));
  if(owners[0]===owners[1])throw Error('Test identities must differ');
  for(let i=0;i<2;i++)await run(targets[i],`const rtc=find(/react-native-webrtc[\\/]src[\\/]index\\.ts$/),proto=rtc.RTCPeerConnection.prototype; if(globalThis.__screenTest)throw Error('Test already instrumented');const original=proto.addTrack;const baseline=(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id);globalThis.__screenTest={baseline,owner:account.status().account,restore:()=>{proto.addTrack=original;}};proto.addTrack=function(...args){globalThis.__screenTest.pc=this;return original.apply(this,args);};const peer=${JSON.stringify(owners[1-i])};const c=(await ledger().snapshot()).contacts.find(c=>c.account===peer);if(c?.blocked)throw Error('Blocked peer');if(!c?.accepted)await ledger().configure(peer,{accepted:true});await get('src/screens/calls/RootAccountCallScreen.tsx').ensureRootCallPermissions('video');return true;`);
  for(const t of targets)await run(t,`const test=globalThis.__screenTest;test.installRelay=()=>{const call=get('src/modules/calls/index.ts').localAccountCalls().snapshot(),transport=call?.transport;if(!transport)return false;const acquire=transport.acquirePeer,load=transport.loadIceConfig,oldRestore=test.restore;transport.acquirePeer=async()=>{throw Error('DEV TEST: shared peer unavailable');};transport.loadIceConfig=async()=>{const cfg=await load();if(!cfg.ice_servers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u))))throw Error('TURN unavailable');return {...cfg,ice_transport_policy:'relay'};};test.restore=()=>{transport.acquirePeer=acquire;transport.loadIceConfig=load;oldRestore();};return true;};const timer=setInterval(()=>{if(test.installRelay())clearInterval(timer);},5),deadline=setTimeout(()=>clearInterval(timer),30000),restore=test.restore;test.restore=()=>{clearInterval(timer);clearTimeout(deadline);restore();};return true;`);
  await run(targets[0],`globalThis.__screenTest.starting=true;get('src/modules/calls/index.ts').calling.start(${JSON.stringify(owners[1])},'video',async()=>{}).then(id=>{globalThis.__screenTest.id=id;globalThis.__screenTest.starting=false;},e=>{globalThis.__screenTest.error=String(e);globalThis.__screenTest.starting=false;});return true;`);
  await until(async()=>run(targets[1],`const c=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot();if(!c||c.outgoing||c.status!=='ringing')return false;globalThis.__screenTest.id=c.id;return get('src/modules/calls/index.ts').localAccountCalls().accept(c.id);`),'Dev incoming call',60000);
  for(const t of targets)await until(()=>run(t,`const pc=globalThis.__screenTest?.pc;if(!pc)return false;const rs=[...(await pc.getStats()).values()],transport=rs.find(r=>r.type==='transport'&&r.selectedCandidatePairId),pair=rs.find(r=>r.id===transport?.selectedCandidatePairId);return pair&&[pair.localCandidateId,pair.remoteCandidateId].every(id=>rs.find(r=>r.id===id)?.candidateType==='relay')&&rs.some(r=>r.type==='inbound-rtp'&&r.kind==='video'&&r.framesDecoded>0);`),'Actual TURN video',45000);
  console.log(JSON.stringify({started:true,forcedUnavailableSharedPeer:true,automaticFallbackVerified:true,targets:targets.map(t=>t.id)}));
 }else if(mode==='end'){
  await run(targets[0],`const test=globalThis.__screenTest,calls=get('src/modules/calls/index.ts').localAccountCalls(),view=calls?.snapshot();if(test&&view?.id===test.id&&view.status!=='ended')await calls.end(view.id);return true;`);
  for(const t of targets)await until(()=>run(t,`const test=globalThis.__screenTest,c=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot(),m=get('src/services/identity/callMediaState.ts').callMediaState.getState().value;return !test||(!c||c.id===test.id&&c.status==='ended')&&m===null;`),'Hangup propagated to both Dev phones',30000);
  for(const t of targets)console.log(JSON.stringify(await run(t,`const test=globalThis.__screenTest;if(!test)return {instrumented:false};const calls=get('src/modules/calls/index.ts').localAccountCalls(),view=calls?.snapshot();if(view&&view.id===test.id)await calls.end(view.id);test.restore();const s=await ledger().snapshot(),keys=s.messages.map(m=>m.peer+':'+m.direction+':'+m.id);if(account.status().account!==test.owner||test.baseline.some(k=>!keys.includes(k)))throw Error('Preservation failed');delete globalThis.__screenTest;return {ended:true,allBaselineMessagesPreserved:true};`)));
 }else for(const t of targets){
  const result=await run(t,`const pc=globalThis.__screenTest?.pc;if(!pc)return {pc:false};const reports=[...(await pc.getStats()).values()];const rows=reports.filter(r=>['outbound-rtp','inbound-rtp','remote-inbound-rtp'].includes(r.type)&&r.kind==='video').map(r=>Object.fromEntries(['type','timestamp','framesEncoded','framesSent','framesDecoded','framesReceived','framesDropped','bytesSent','bytesReceived','packetsLost','packetsSent','frameWidth','frameHeight','framesPerSecond','freezeCount','totalFreezesDuration','qualityLimitationReason','totalEncodeTime','pliCount','nackCount'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));const transport=reports.find(r=>r.type==='transport'&&r.selectedCandidatePairId),pair=reports.find(r=>r.id===transport?.selectedCandidatePairId)??reports.find(r=>r.type==='candidate-pair'&&r.nominated&&r.state==='succeeded');const candidates=pair?[pair.localCandidateId,pair.remoteCandidateId].map(id=>reports.find(r=>r.id===id)?.candidateType):[];return {ice:pc.iceConnectionState,path:candidates,rows,senders:pc.getSenders().filter(s=>s.track?.kind==='video').map(s=>({settings:s.track.getSettings(),encodings:s.getParameters().encodings}))};`);
  console.log(JSON.stringify({target:t.id,...result}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});






