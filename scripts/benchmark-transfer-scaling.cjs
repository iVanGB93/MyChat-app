// Authorized synthetic phone Dev <-> FirstNeuron scale test. No resets or deletion.
const {remote,mobile}=require('./benchmark-live-transfers.cjs'),fs=require('node:fs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 let devSession,traceStarted=false;const traceEvents=[];let traceComplete;const tracingDone=new Promise(r=>traceComplete=r);
 const encoded=Buffer.from(fs.readFileSync('D:/Proyects/Axonic/builds/transfer-benchmark-worker.mjs','utf8')).toString('base64');
 const first=remote('FirstNeuron','ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i','C:/Users/iVan/.ssh/axonic-neuron-admin','root@143.198.121.2',`/opt/node22/bin/node --input-type=module -e "await import('data:text/javascript;base64,${encoded}')" axonic-neuron`]);
 const result={startedUTC:new Date().toISOString(),bytesPerMiB:1048576,rows:[],measurement:'Host monotonic send invocation to observed complete receiver; excludes phone fixture generation/hash; includes actual selection, preparation, API/CDP and polling (hosted fixture upload remains included). Post-enqueue excludes most sender preparation; neither is raw link speed.'};
 const output='builds/transfer-scaling-'+Date.now()+'.json';
 try{
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json(),target=targets.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1'));
 if(!target)throw Error('Open phone Axonic Dev');devSession=require('./test-two-phone-dev.cjs').createDevSession(target);await devSession.call('Runtime.enable');if(process.argv.includes('--trace')){devSession.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='Tracing.dataCollected')traceEvents.push(...m.params.value);if(m.method==='Tracing.tracingComplete')traceComplete();});await devSession.call('Tracing.start',{categories:''});traceStarted=true;}const phone=mobile('Phone Dev',devSession),endpoints=[phone,first];
 for(const e of endpoints){e.info=await e.call({op:'info'});e.baseline=await e.call({op:'inventory'});console.log(JSON.stringify({ready:e.name,release:e.info.release,baselineMessages:e.baseline.keys.length}));}
 if(process.argv.includes('--inspect-only')){console.log(JSON.stringify(endpoints.map(e=>({endpoint:e.name,...e.info}))));return;}
 for(const [a,b] of [[phone,first],[first,phone]])await a.call({op:'accept',peer:b.info.account});
 const sizes=process.argv.includes('--one-only')?[1]:process.argv.includes('--ten-only')?[10]:process.argv.includes('--preparation')?[1,10]:[1,5,10],repeats=process.argv.includes('--preparation')||process.argv.includes('--single')?1:2;
 for(const sizeMiB of sizes)for(let repeat=1;repeat<=repeats;repeat++)for(const [sender,receiver] of (process.argv.includes('--preparation')&&!process.argv.includes('--bidirectional')?[[first,phone]]:[[phone,first],[first,phone]])){
 console.log(JSON.stringify({starting:true,from:sender.name,to:receiver.name,sizeMiB,repeat}));
 const beforeReceiver=await receiver.call({op:'info'}),beforeSender=await sender.call({op:'info'});
 const fixture=sender===phone?await sender.call({op:'fixture',size:sizeMiB*1048576}):undefined;
 const start=performance.now(),sent=await sender.call({op:'send',peer:receiver.info.account,size:sizeMiB*1048576,...(fixture?{fixture}:{})}),queued=performance.now();let incoming;
 while(performance.now()-queued<300000){incoming=await receiver.call({op:'observe',peer:sender.info.account,id:sent.id,direction:'incoming'});if(incoming?.status==='delivered')break;await wait(500);}
 if(incoming?.status!=='delivered')throw Error('Transfer timed out; pending work preserved');
 const done=performance.now(),verified=await receiver.call({op:'verify',digest:incoming.attachmentDigest});
 if(verified.bytes!==sent.bytes||verified.checksum!==sent.checksum)throw Error('Checksum mismatch');
 let outgoing;const receiptStart=performance.now();
 do{outgoing=await sender.call({op:'observe',peer:receiver.info.account,id:sent.id,direction:'outgoing'});if(outgoing?.status==='delivered')break;await wait(500);}while(performance.now()-receiptStart<60000);
 if(outgoing?.status!=='delivered')throw Error('Sender receipt missing; preserving transfer');
 const afterReceiver=await receiver.call({op:'info'}),receiverTimingDelta=Object.fromEntries(Object.entries(afterReceiver.timings??{}).map(([key,v])=>[key,{calls:v.calls-(beforeReceiver.timings?.[key]?.calls??0),milliseconds:v.milliseconds-(beforeReceiver.timings?.[key]?.milliseconds??0),errors:v.errors-(beforeReceiver.timings?.[key]?.errors??0)}]));
 const afterSender=await sender.call({op:'info'}),senderTimingDelta=Object.fromEntries(Object.entries(afterSender.timings??{}).map(([key,v])=>[key,{calls:v.calls-(beforeSender.timings?.[key]?.calls??0),milliseconds:v.milliseconds-(beforeSender.timings?.[key]?.milliseconds??0)}]));
 const row={senderStreamAttempts:afterSender.streamAttempts,receiverStreamAttempts:afterReceiver.streamAttempts,fixtureTiming:sent.fixtureTiming,senderTimingDelta,from:sender.name,to:receiver.name,sizeMiB,repeat,endToEndMs:Math.round(done-start),enqueueMs:Math.round(queued-start),postEnqueueMs:Math.round(done-queued),preparationStages:sent.preparationStages,receiverTimingDelta,effectiveMiBps:+(sizeMiB/((done-start)/1000)).toFixed(3),checksumMatches:true,senderConfirmed:true};
 result.rows.push(row);fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(row));
 }
 for(const e of endpoints){const after=await e.call({op:'inventory'});if(after.account!==e.baseline.account||e.baseline.keys.some(k=>!after.keys.includes(k)))throw Error('Baseline preservation check failed');console.log(JSON.stringify({preserved:e.name,baselineMessages:e.baseline.keys.length,currentMessages:after.keys.length}));}
 result.finishedUTC=new Date().toISOString();result.allBaselineRecordsPreserved=true;fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({complete:true,transfers:result.rows.length,output}));
 }finally{try{if(traceStarted){await devSession.call('Tracing.end');await Promise.race([tracingDone,wait(5000)]);fs.writeFileSync('builds/phone-checkpoint-trace.json',JSON.stringify({traceEvents}));}}finally{devSession?.close();first.close();}}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
