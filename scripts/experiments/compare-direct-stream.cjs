// Invoke after direct-stream-device setup/connect and speed-measure setup.
// Preserves all raw samples. No app installation, personal media or message text.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),os=require('node:os');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'builds/direct-stream-comparison-'+Date.now());fs.mkdirSync(out);
const normal='D:/Proyects/Axonic/builds/speed-measure.cjs',direct=path.join(__dirname,'direct-stream-device.cjs');
const invoke=(script,...args)=>cp.execFileSync(process.execPath,[script,...args.map(String)],{cwd:root,encoding:'utf8',timeout:180000});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function sample(mode,bytes,index){
 const script=mode==='normal'?normal:direct,frame=mode==='stream16'?16384:65536;
 invoke(script,'send',bytes,frame);const started=Date.now();let rows;
 while(Date.now()-started<150000){
  await wait(1000);const raw=invoke(script,'status');fs.writeFileSync(path.join(out,`${index}-${mode}-${bytes}.jsonl`),raw);rows=raw.trim().split(/\r?\n/).map(JSON.parse);
  if(mode==='normal'){
   if(rows[0].result.event?.completedAt&&rows[1].result.verified){const e=rows[0].result.event;return {mode,bytes,elapsedMs:e.completedAt-e.startedAt,prepareMs:e.preparedAt-e.startedAt,verified:true,route:rows[0].result.route?.[0]?.route};}
  }else{
   if(rows.some(r=>r.result.error||r.result.result?.error))throw Error('Direct transfer failed: '+JSON.stringify(rows));
   if(rows[0].result.result?.verified&&rows[1].result.independentlyVerified){const r=rows[0].result.result;return {mode,bytes,elapsedMs:r.elapsedMs,hashMs:r.hashMs,verified:true};}
  }
 }
 throw Error('Transfer did not finish: '+JSON.stringify(rows));
}
(async()=>{
 const sources={};for(const f of ['scripts/experiments/direct-stream-session.cjs','scripts/experiments/direct-stream-device.cjs','src/services/identity/rootAttachmentFiles.ts','src/services/identity/attachmentTransfer.ts'])sources[f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
 fs.writeFileSync(path.join(out,'environment.json'),JSON.stringify({utc:new Date().toISOString(),node:process.version,hostCpu:os.cpus()[0]?.model,appVersion:require('../../package.json').version,sources,contract:'Dev emulator to Dev phone. Established independent channels. Normal: queue through receipt, including preparation. Direct: native source hash through final verified receipt. Fixture generation and channel setup excluded. Direct uses desktop signed signaling; no relay, group, resume or production binary admission integration.'},null,2));
 const results=[];console.log('Results directory: '+out);let index=0;
 try{
  for(let repeat=0;repeat<3;repeat++){
   const modes=['normal','stream16','stream64'];for(const mode of [...modes.slice(repeat),...modes.slice(0,repeat)]){const r=await sample(mode,524287,++index);results.push(r);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(r));}
  }
  for(let repeat=0;repeat<3;repeat++)for(const mode of repeat%2?['stream64','normal']:['normal','stream64']){const r=await sample(mode,2097151,++index);results.push(r);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(r));}
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e));throw e;}
})();
