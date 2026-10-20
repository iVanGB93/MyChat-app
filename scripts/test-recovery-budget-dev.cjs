// Execute the current recovery source on each Dev Hermes runtime with isolated
// in-memory dependencies. Real native clocks/waits, no app networking or storage.
const fs=require('node:fs'),ts=require('typescript');const {run}=require('./test-two-phone-dev.cjs');
const source=ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageRecovery.ts','utf8'),{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
const lease=ts.transpileModule(fs.readFileSync('src/services/identity/messageWakeLease.ts','utf8'),{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
(async()=>{const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');if(targets.length!==2)throw Error('Two Dev targets required');const results=[];
for(const t of targets){if(!['737378d0ee3d6d92454bdc00c70a11f88cb4b621','c105964d4a6122be03ab7886c02d4590978b87bd'].includes(t.id.split('-')[0]))throw Error('Unexpected target');
const result=await run(t,`
 const native=get('modules/axonic-nearby/index.ts').default,assert=(ok,why)=>{if(!ok)throw Error(why);};
 const before=native.axonClockSnapshot();await native.axonMessageWait(500);const after=native.axonClockSnapshot();
 assert(after.elapsedMs-before.elapsedMs>=450,'native elapsed clock');assert(after.uptimeMs>=before.uptimeMs&&after.processCpuMs>=before.processCpuMs,'native clocks regressed');
 const results=[];
 for(const mode of ['receipt','slow_inline','diagnostic_error','late_callback']){
  let now=100000,stops=0,resumes=0,ticks=0,waits=0;const leases=[],observations=[],inline=[];
  const dependencies={'react-native':{AppState:{currentState:'background'}},'../../../modules/axonic-nearby':{default:{axonMessageWake:ms=>leases.push(ms),axonMessageWait:async ms=>{await native.axonMessageWait(1);now+=ms+(mode==='late_callback'?80000:0);waits++;}}},'./localAccount':{localAccount:{status:()=>({state:'unlocked',account:'fixture'})},startLocalAccount:async()=>{}},'../../composition/neuronRuntime':{startLocalAccountNetwork:()=>({receiveWakeEnvelope:async e=>{inline.push(e);if(mode==='slow_inline')now+=25000;return {};},resume:()=>resumes++,tick:()=>ticks++,recoveryComplete:()=>mode!=='late_callback'&&now>=100900,stop:()=>stops++})},'../mobileDeliveryDiagnostics':{deliveryDiagnosticEvent:(_a,_p,_i,event,details)=>{if(mode==='diagnostic_error'&&event==='recovery_finished')throw Error('synthetic diagnostic error');observations.push({event,details});}}};
  const l={};new Function('exports','require',${JSON.stringify(lease)})(l,n=>dependencies[n]);dependencies['./messageWakeLease']=l;
  const out={};new Function('exports','require','Date',${JSON.stringify(source)})(out,n=>dependencies[n],{now:()=>now});
  await out.recoverRootMessage('fixture','peer','id',200000,undefined,mode==='slow_inline'?{kind:'fixture'}:undefined);
  assert(stops===1&&leases.length===2&&leases[0]===30000&&leases[1]===0,'lease leak');
  if(mode==='slow_inline')assert(inline.length===1&&resumes===0&&ticks===0&&now===125000,'slow persistence added polling');
  if(mode==='late_callback')assert(ticks===1&&observations.at(-1).details.waitLagMs===80000,'late callback repeated expired work');
  results.push({mode,passed:true,elapsedFixtureMs:now-100000});
 }
 return {nativeClockDelta:{elapsedMs:after.elapsedMs-before.elapsedMs,uptimeMs:after.uptimeMs-before.uptimeMs,processCpuMs:after.processCpuMs-before.processCpuMs},scenarios:results,networkCalls:0,storageMutations:0};
`);results.push({target:t.id,...result});console.log(JSON.stringify(results.at(-1)));}
const file='builds/recovery-budget-dev-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(results,null,2),{flag:'wx'});console.log(file);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
