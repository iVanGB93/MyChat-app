// Authorized two-Dev-account call only; restores instrumentation and preserves history.
const {run,until}=require('./test-two-phone-dev.cjs');
const {execFileSync}=require('node:child_process');
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 if(targets.length!==2)throw Error('Exactly two Dev apps required');
 try{
  for(const t of targets)await run(t,`const call=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot();if(call&&call.status!=='ended')throw Error('Existing call');const proto=find(/react-native-webrtc[\\/]src[\\/]index\\.ts$/).RTCPeerConnection.prototype,old=proto.createDataChannel;if(globalThis.__hangupProbe)throw Error('Existing probe');globalThis.__hangupProbe={restore:()=>{proto.createDataChannel=old;}};proto.createDataChannel=function(...args){const c=old.apply(this,args);if(args[0]==='axonic-call-video-state-v1')globalThis.__hangupProbe.channel=c;return c;};return true;`);
  execFileSync(process.execPath,['scripts/test-dev-screen-share.cjs','start','--relay'],{stdio:'inherit'});
  let sender;
  await until(async()=>{for(const t of targets)if(await run(t,`return globalThis.__hangupProbe?.channel?.readyState==='open';`)){sender=t;return true;}return false;},'Call control data channel',45000);
  const start=Date.now();
  console.log(await run(sender,`const test=globalThis.__screenTest,calls=get('src/modules/calls/index.ts').localAccountCalls(),call=calls.snapshot();if(call?.id!==test.id||call.status!=='ready')throw Error('Not the test call');const channel=globalThis.__hangupProbe.channel,h=get('src/services/callEndHandshake.ts').createCallEndHandshake(call.id,{send:raw=>{channel.send(raw);return true;},ended:()=>{}});const listener=e=>h.receive(e.data);channel.addEventListener('message',listener);await h.end();channel.removeEventListener('message',listener);h.close();await calls.end(call.id);return {sent:true};`));
  await until(async()=>{for(const t of targets)if(!await run(t,`const c=get('src/modules/calls/index.ts').localAccountCalls()?.snapshot();return !c||c.status==='ended';`))return false;return true;},'Both Dev calls ended',5000);
  console.log(JSON.stringify({bothEnded:true,observedElapsedMs:Date.now()-start}));
 }finally{
  execFileSync(process.execPath,['scripts/test-dev-screen-share.cjs','end'],{stdio:'inherit'});
  for(const t of targets)await run(t,`globalThis.__hangupProbe?.restore();delete globalThis.__hangupProbe;return true;`);
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
