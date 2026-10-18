// Explicit synthetic actual-chunk comparison. Read-only ledger pre/post checks.
// No runtime module replacement, real message sends, AoN access or data cleanup.
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ts=require('typescript'),WebSocketServer=require('ws').Server;
const {source,fixture}=require('./experiments/attachment-chunk-sizes.cjs');
const phone=require('./experiments/phone-chunk-benchmark.cjs');
const {evaluate,run}=require('./test-two-phone-dev.cjs');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const serial='R3GYC0H7PMY',adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
async function main(){
 const smoke=process.argv.includes('--smoke'),finishNative=process.argv.includes('--finish-native'),nativeAll=process.argv.includes('--native-all')||finishNative,sizes=[4096,16384,65536,262144],bytes=(smoke?1:10)*1048576+19;
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json(),target=targets.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1'));
 if(!target)throw Error('Open main Axonic Dev');
 if(process.argv.includes('--cancel')){console.log(JSON.stringify({cancelRequested:await evaluate(target,'(()=>{if(!globalThis.__actualChunkExperiment?.pending)return false;globalThis.__actualChunkExperiment.cancelled=true;return true;})()')}));return;}
 const baseline=await run(target,"if(account.status().state!=='unlocked'||find(/react-native[\\/]index\\.js$/).AppState.currentState!=='active')throw Error('Unlock foreground Dev');return {owner:account.status().account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.id+':'+m.direction)};");
 if(nativeAll){const hash=await run(target,"return get('modules/axonic-nearby/index.ts').default.attachmentSha256('a'.repeat(524448));");if(hash!==crypto.createHash('sha256').update('a'.repeat(524448)).digest('hex'))throw Error('Larger native hash not installed');}
 const output='builds/actual-chunk-sizes-'+(nativeAll?'native-':'')+Date.now()+'.json',token=crypto.randomBytes(24).toString('hex');
 const result={startedUTC:new Date().toISOString(),device:target.deviceName,smoke,nativeAll,bytes,batchBytes:262144,transport:'USB ADB reverse to loopback-only PC WebSocket; no Axonic authenticated scheduler/relay',configuration:{mobileGitBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeHashSourceSha256:crypto.createHash('sha256').update(fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AttachmentHash.kt')).digest('hex'),codec: sizes.map(s=>{const c=source(s);return {size:s,sourceSha256:c.sourceSha256,experimentSha256:c.experimentSha256};}),runnerSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),phoneHarnessSha256:crypto.createHash('sha256').update(fs.readFileSync(require.resolve('./experiments/phone-chunk-benchmark.cjs'))).digest('hex')},rows:[],failures:[]};
 const save=()=>fs.writeFileSync(output,JSON.stringify(result,null,2));let active=null,port;
 if(finishNative)result.continuationOf='builds/actual-chunk-sizes-native-1792301584393.json';
 const thermal=()=>{const text=execFileSync(adb,['-s',serial,'shell','dumpsys','thermalservice'],{encoding:'utf8',timeout:10000});const m=text.match(/^Thermal Status:\s*(\d+)/m);if(!m)throw Error('Thermal status unavailable');return Number(m[1]);};
 async function cool(){const began=Date.now();let status=thermal();if(status>0)console.log(JSON.stringify({waitingForCooldown:true,thermalStatus:status}));while(status>0&&Date.now()-began<240000){await sleep(10000);status=thermal();}if(status>0)throw Error('Phone needs more cooldown; synthetic data preserved');return status;}
 const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:1024});await new Promise(r=>server.once('listening',r));port=server.address().port;
 server.on('connection',(ws,request)=>{
  if(request.url!=='/'+token||!active){ws.close();return;}const job=active;
  ws.on('message',raw=>{try{const r=JSON.parse(raw);if(!Number.isSafeInteger(r.start)||r.start!==job.next||r.count!==Math.min(job.f.a.batchCount,job.f.chunks.length-r.start))throw Error('Unexpected benchmark request');
   const start=performance.now(),data=job.f.a.batch.packAttachmentBatch(job.f.manifest,r.start,job.f.chunks.slice(r.start,r.start+r.count));job.packMs+=performance.now()-start;
   job.next+=r.count;ws.send(JSON.stringify({start:r.start,count:r.count,data}));
  }catch{ws.close(1008,'Invalid experiment request');}});
 });
 try{
  const reverses=execFileSync(adb,['-s',serial,'reverse','--list'],{encoding:'utf8'});if(reverses.includes('tcp:'+port))throw Error('Reverse port already exists');
  execFileSync(adb,['-s',serial,'reverse','tcp:'+port,'tcp:'+port],{stdio:'pipe'});
  // Rotate candidate order. Every observation, including failures, is retained.
  const variants=sizes.map(size=>({size,nativeLeaf:nativeAll}));
  const reference={size:4096,nativeLeaf:true};
  const rounds=finishNative?[[variants[0],variants[2]]]:smoke?[variants]:nativeAll?[variants,[variants[3],variants[1],variants[0],variants[2]]]:[[reference,...variants],[variants[3],variants[1],reference,variants[2],variants[0]]];
  for(let repeat=0;repeat<rounds.length;repeat++)for(const {size,nativeLeaf} of rounds[repeat]){
   const thermalBefore=await cool();
   const f=fixture(size,bytes);active={f,next:0,packMs:0};const runId=crypto.randomBytes(12).toString('hex');
   const input={runId,codec:source(size),manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),senderRecord:f.ids[0].record,recipientRecord:f.ids[1].record,senderSeed:Buffer.from(f.ids[0].seed).toString('hex'),recipientSeed:Buffer.from(f.ids[1].seed).toString('hex'),checksum:f.checksum,url:'ws://127.0.0.1:'+port+'/'+token,nativeLeaf};
   console.log(JSON.stringify({starting:true,repeat:repeat+1,chunkKiB:size/1024,fileMiB:bytes/1048576,nativeLeaf}));
   const code=`(()=>{if(globalThis.__actualChunkExperiment)throw Error('Experiment already exists');globalThis.__actualChunkExperiment={pending:true};const get=name=>{const e=[...__r.getModules()].find(([id,m])=>m.verboseName===name);if(!e)throw Error('Missing module '+name);return __r(e[0]);};const find=pattern=>{const e=[...__r.getModules()].find(([id,m])=>pattern.test(m.verboseName));if(!e)throw Error('Missing dependency '+pattern);return __r(e[0]);};(${phone.toString()})(${JSON.stringify(input)},get,find,get('src/services/identity/localAccount.ts').localAccount).then(value=>globalThis.__actualChunkExperiment={value},e=>globalThis.__actualChunkExperiment={error:String(e)});return true;})()`;
   try{await evaluate(target,compile(code));let status;const at=Date.now();
    do{await sleep(1000);status=await evaluate(target,'globalThis.__actualChunkExperiment');if(!status?.pending)break;}while(Date.now()-at<240000);
    if(status?.pending)throw Error('Experiment timeout; leave process intact for inspection');if(status?.error)throw Error(status.error);if(!status?.value)throw Error('Experiment result missing');
    const r=status.value;if(!f.a.protocol.verifyAttachmentReceipt(r.receipt,f.manifest,f.ids[1].record,Date.now()))throw Error('PC receipt verification failed');delete r.receipt;
    result.rows.push({repeat:finishNative?2:repeat+1,...r,thermalBefore,thermalAfter:thermal(),pcPreparationMs:f.preparationMs,pcPackMs:active.packMs});console.log(JSON.stringify(result.rows.at(-1)));save();
   }finally{
    // Stop this isolated operation before clearing its handle on a host error.
    // No normal app worker or global account setting is modified.
    const pending=await evaluate(target,'!!globalThis.__actualChunkExperiment?.pending').catch(()=>false);
    if(pending){await evaluate(target,'globalThis.__actualChunkExperiment.cancelled=true;true').catch(()=>{});for(const ws of server.clients)ws.close();
     for(let i=0;i<50;i++){await sleep(500);if(!await evaluate(target,'!!globalThis.__actualChunkExperiment?.pending').catch(()=>false))break;}
    }
    f.key.fill(0);f.plain.fill(0);for(const id of f.ids)id.seed.fill(0);active=null;await evaluate(target,'delete globalThis.__actualChunkExperiment;true').catch(()=>{});
   }
  }
 }catch(e){result.failures.push({error:e.message,at:new Date().toISOString()});throw e;}
 finally{
  try{const after=await run(target,"return {owner:account.status().account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.id+':'+m.direction)};");result.preservation={accountUnchanged:baseline.owner===after.owner,allPreviousMessagesPresent:baseline.keys.every(k=>after.keys.includes(k)),before:baseline.keys.length,after:after.keys.length};}catch(e){result.preservation={unverified:e.message};}
  for(const ws of server.clients)ws.close();server.close();if(port)execFileSync(adb,['-s',serial,'reverse','--remove','tcp:'+port],{stdio:'pipe'});
  result.finishedUTC=new Date().toISOString();save();console.log(JSON.stringify({output,rows:result.rows.length,failures:result.failures,preservation:result.preservation}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
