import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {rootAttachmentFile,createRootStreamTemporary,sweepRootStreamTemporaries,hashRootAttachmentFile} from './rootAttachmentFiles';
import {createDirectAttachmentStream} from './directAttachmentStream';
import type {AttachmentJob} from './attachmentTransfer';
import type {AttachmentLane as RtcAttachmentLane,AttachmentStreams} from './attachmentConnections';
export type {AttachmentStreams} from './attachmentConnections';
/** One incoming and one outgoing transfer at most. Runtime owns cancellation;
 * the worker remains the only publisher and signer of attachment receipts. */
export function createRootAttachmentStreams(network:AttachmentStreams,request:(peer:string,raw:string)=>Promise<string|null>,changed:()=>void=()=>{},receiveProgress?:(job:AttachmentJob)=>(bytes:number)=>void){
 type Attempt={job:AttachmentJob;temporary:string;live():Promise<boolean>;lane?:RtcAttachmentLane;run?:ReturnType<typeof createDirectAttachmentStream>;task?:Promise<void>;finish?:(result:boolean)=>void;cancel():void};
 let stopped=false,incoming:Attempt|undefined,outgoing:Attempt|undefined;
 let sweptAt=0;
 const active=(a:Attempt)=>!stopped&&localAccount.status().state==='unlocked'&&localAccount.status().account===a.job.owner;
 async function run(a:Attempt,lane:RtcAttachmentLane,role:'send'|'receive'){
  a.lane=lane;let valid=true,created=false;let temporary:ReturnType<typeof createRootStreamTemporary>|undefined;const started=Date.now();
  let stage='channel';
  const report=role==='receive'?receiveProgress?.(a.job):undefined;
  const live=()=>valid&&active(a)&&lane.live()&&a.job.descriptor.manifest.expires>Date.now();
  const validate=async()=>{const allowed=await a.live();valid=valid&&active(a)&&allowed;if(!valid)throw Error('Attachment stream revoked');};
  let wake:(()=>void)|undefined;
  const signal=()=>wake?.();
  const waitForProgress=()=>new Promise<void>(resolve=>{
   // Wake immediately after a processed frame. Still recheck the durable lease
   // during silence, without polling SQLite on every zero-delay timer.
   const finish=()=>{clearTimeout(timer);if(wake===finish)wake=undefined;resolve();};
   const timer=setTimeout(finish,250);wake=finish;
  });
  const stream=a.run=createDirectAttachmentStream({role,
   expected:{digest:a.job.digest,bytes:a.job.descriptor.manifest.bytes,checksum:a.job.descriptor.checksum},
   live,now:Date.now,wait:async idle=>{if(idle)await waitForProgress();else await new Promise<void>(r=>setTimeout(r,0));await validate();},
   send:data=>{stage='send';lane.send(data);},close:()=>lane.close(),
   authorize:async()=>{await validate();await lane.credit(a.job.descriptor.manifest.bytes,true);await validate();},
   consumed:async offset=>{await validate();report?.(offset);await lane.credit(offset,false);},
   reader:()=>{
    stage='source-open';if(!live())throw Error('Stream closed');
    // Gallery export can adopt the source while channel admission is awaiting.
    // Resolve at open, not before that wait. Retry only a changed canonical URI
    // if export raced this open too; never recreate a removed source.
    const file=rootAttachmentFile(a.job.owner,a.job.digest);
    let handle:ReturnType<typeof file.open>;
    try{handle=file.open();}catch(error){
     const adopted=rootAttachmentFile(a.job.owner,a.job.digest);
     if(adopted.uri===file.uri)throw error;
     handle=adopted.open();
    }
    return {read:(n:number)=>{stage='source-read';return handle.readBytes(n);},close:()=>handle.close()};
   },
   writer:()=>{if(!live())throw Error('Stream closed');temporary=createRootStreamTemporary(a.job.owner,a.temporary);created=true;
    const handle=temporary.open();return {write:(bytes:Uint8Array)=>handle.writeBytes(bytes),close:()=>handle.close()};},
   hash:async()=>{await validate();const hash=await hashRootAttachmentFile(a.job.owner,role==='send'?a.job.digest:a.temporary,a.job.descriptor.manifest.bytes);await validate();return hash;},
   discard:()=>{if(created&&temporary?.parentDirectory.exists)temporary.parentDirectory.delete();created=false;},
  });
  // Control records wake the sender immediately. Data frames already validate
  // before replenishing native credit and at final verification; waking the idle
  // pump per frame duplicates journal reads and competes with file processing.
  let initialized=false,earlyControl:string|undefined;
  const receive=(data:unknown)=>{void stream.receive(data).catch(()=>{}).finally(()=>{if(typeof data==='string')signal();});};
  lane.listen(data=>{
   // Native channel-open and first-message events can share one bridge batch.
   // Admit only one bounded control until start() establishes the protocol state;
   // binary data still requires the normal native and protocol authorization.
   if(!initialized){
    if(typeof data!=='string'||data.length>1024||earlyControl!==undefined){stream.abort('Unexpected early stream frame');return;}
    earlyControl=data;return;
   }
   receive(data);
  },()=>{stream.abort('RTC stream closed');signal();});
  try{await lane.ready();if(role==='send')await validate();const done=stream.start();initialized=true;
   if(earlyControl!==undefined){receive(earlyControl);earlyControl=undefined;}
   await done;await validate();
   if(role==='receive'){
    // A failed rename leaves the durable chunk prefix intact. Older clients
    // without this primitive continue with chunks instead of unsafe replacement.
    if(!Native!.attachmentStageStream!(a.job.owner,a.temporary,a.job.digest,a.job.descriptor.manifest.bytes))throw Error('Stream staging unavailable');
   }
   console.info('[Axonic direct attachment]',JSON.stringify({direction:role,bytes:a.job.descriptor.manifest.bytes,result:'verified',elapsedMs:Date.now()-started,...(role==='receive'?{previousVerifiedChunks:a.job.cursor}:{})}));
  }catch(error){stream.abort(error);
   const reason=error instanceof Error?error.message.toLowerCase():'';
   console.info('[Axonic direct attachment]',JSON.stringify({direction:role,bytes:a.job.descriptor.manifest.bytes,result:'fallback',
    reason:['revoked','timeout','admission','closed','checksum','unavailable','collision'].find(value=>reason.includes(value))??'transfer-error',stage,elapsedMs:Date.now()-started,...stream.progress()}));throw error;}
  finally{signal();if(created&&temporary?.parentDirectory.exists)temporary.parentDirectory.delete();lane.close();}
 }
 const unlisten=network.listen((account,device,lane)=>{
  const a=incoming,m=a?.job.descriptor.manifest;
  if(!a||a.lane||!active(a)||m?.sender!==account||m.senderDevice!==device)return false;
  // Receiver's pending promise is wired before requesting this lane.
  a.task=run(a,lane,'receive');void a.task.then(()=>a.finish?.(true),()=>a.finish?.(false));return true;
 });
 async function attempt(job:AttachmentJob,live:()=>Promise<boolean>):Promise<Attempt>{
  if(Date.now()-sweptAt>=15*60*1000){sweepRootStreamTemporaries(job.owner);sweptAt=Date.now();}
  const temporary=await Native!.identityRandomBytes!(32);
  const a:Attempt={job,temporary,live,cancel(){a.run?.abort('Attachment runtime stopped');a.lane?.close();}};return a;
 }
 return {
  sending(job:AttachmentJob){return !!outgoing&&outgoing.job.owner===job.owner&&outgoing.job.digest===job.digest&&active(outgoing)&&!!outgoing.lane?.live();},
  async pull(job:AttachmentJob,live:()=>Promise<boolean>){
   const m=job.descriptor.manifest;
   if(stopped||incoming||!Native?.attachmentFileSha256||!Native?.attachmentStageStream||!await live()){
    console.info('[Axonic direct attachment]',JSON.stringify({direction:'receive',result:'skipped',reason:stopped?'stopped':incoming?'busy':!Native?.attachmentFileSha256||!Native?.attachmentStageStream?'native-unavailable':'revoked'}));return 'unavailable' as const;
   }
   // The normal request also wakes the sender's route preference, whichever
   // account owns the dialing role. Chunks keep moving while RTC negotiates.
   const upgrading=!network.available(m.sender,m.senderDevice);
   if(upgrading&&!network.request?.(m.sender,m.senderDevice)){
    const reason=network.unavailableReason?.(m.sender,m.senderDevice);
    console.info('[Axonic direct attachment]',JSON.stringify({direction:'receive',result:'skipped',reason:
     ['inactive-account','native-unavailable','peer-stream-unsupported','route-not-ready'].includes(reason??'')?reason:'upgrade-not-admitted'}));
    return 'unavailable' as const;
   }
   const a=await attempt(job,live);if(stopped||incoming||!await live())return 'unavailable' as const;incoming=a;let timer:ReturnType<typeof setTimeout>|undefined;
   const completed=new Promise<boolean>(resolve=>{a.finish=resolve;timer=setTimeout(()=>{a.cancel();resolve(false);},10*60*1000);});
   try{
    const raw=JSON.stringify({version:1,operation:'direct-stream',digest:job.digest});
    let response=await request(m.sender,raw);
    // Both endpoints have been asked to promote this authenticated route.
    // Bound the head start before expensive relay-block materialization.
    // Unsupported peers and opened lanes never enter this wait.
    if(upgrading&&!a.lane&&response&&JSON.parse(response).status==='unavailable'){
     const deadline=Date.now()+1500;
     while(!stopped&&!a.lane&&!network.available(m.sender,m.senderDevice)&&Date.now()<deadline){
      await new Promise<void>(resolve=>setTimeout(resolve,100));
      if(!active(a)||!await live())return 'unavailable' as const;
     }
     if(!stopped&&!a.lane&&active(a)&&network.available(m.sender,m.senderDevice)&&await live())response=await request(m.sender,raw);
    }
    if(!response||JSON.parse(response).status!=='streaming')return a.lane?false:'unavailable' as const;
    // A successful request that never opens a channel must not hold the worker.
    const arrival=setTimeout(()=>{if(!a.lane){a.cancel();a.finish?.(false);}},5000);
    try{return await completed&&await live();}finally{clearTimeout(arrival);}
   }catch{return a.lane?false:'unavailable' as const;}finally{
    if(timer)clearTimeout(timer);a.cancel();await a.task?.catch(()=>{});
    if(incoming===a)incoming=undefined;
   }
  },
  async serve(job:AttachmentJob,live:()=>Promise<boolean>){
   const m=job.descriptor.manifest;
   if(stopped||outgoing||!Native?.attachmentFileSha256||!await live())return false;
   if(!network.available(m.recipient,m.recipientDevice)){network.request?.(m.recipient,m.recipientDevice);return false;}
   const a=await attempt(job,live);if(stopped||outgoing||!await live())return false;outgoing=a;
   try{const lane=network.open(m.recipient,m.recipientDevice);
    a.task=run(a,lane,'send');void a.task.catch(()=>{}).finally(()=>{if(outgoing===a){outgoing=undefined;changed();}});return true;
   }catch{a.cancel();if(outgoing===a)outgoing=undefined;return false;}
  },
  stop(){stopped=true;unlisten();incoming?.cancel();outgoing?.cancel();incoming?.finish?.(false);},
 };
}
