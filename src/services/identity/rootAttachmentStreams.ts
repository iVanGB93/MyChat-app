import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {rootAttachmentFile,rootAttachmentPartial,createRootStreamTemporary,sweepRootStreamTemporaries} from './rootAttachmentFiles';
import {createDirectAttachmentStream} from './directAttachmentStream';
import type {AttachmentJob} from './attachmentTransfer';
import type {RtcAttachmentLane} from './rtcAxonTransport';

export interface AttachmentStreams {
 available(account:string,device:string):boolean;
 open(account:string,device:string):RtcAttachmentLane;
 listen(handler:(account:string,device:string,lane:RtcAttachmentLane)=>boolean):()=>void;
}
/** One incoming and one outgoing transfer at most. Runtime owns cancellation;
 * the worker remains the only publisher and signer of attachment receipts. */
export function createRootAttachmentStreams(network:AttachmentStreams,request:(peer:string,raw:string)=>Promise<string|null>){
 type Attempt={job:AttachmentJob;temporary:string;live():Promise<boolean>;lane?:RtcAttachmentLane;run?:ReturnType<typeof createDirectAttachmentStream>;task?:Promise<void>;finish?:(result:boolean)=>void;cancel():void};
 let stopped=false,incoming:Attempt|undefined,outgoing:Attempt|undefined;
 let sweptAt=0;
 const active=(a:Attempt)=>!stopped&&localAccount.status().state==='unlocked'&&localAccount.status().account===a.job.owner;
 async function run(a:Attempt,lane:RtcAttachmentLane,role:'send'|'receive'){
  a.lane=lane;let valid=true,created=false;const started=Date.now();
  const file=rootAttachmentFile(a.job.owner,role==='send'?a.job.digest:a.temporary);
  const live=()=>valid&&active(a)&&lane.live()&&a.job.descriptor.manifest.expires>Date.now();
  const validate=async()=>{valid=active(a)&&await a.live();if(!valid)throw Error('Attachment stream revoked');};
  const stream=a.run=createDirectAttachmentStream({role,
   expected:{digest:a.job.digest,bytes:a.job.descriptor.manifest.bytes,checksum:a.job.descriptor.checksum},
   live,now:Date.now,wait:async()=>{await new Promise<void>(r=>setTimeout(r,0));await validate();},
   send:data=>lane.send(data),close:()=>lane.close(),
   authorize:async()=>{await validate();await lane.credit(a.job.descriptor.manifest.bytes,true);await validate();},
   consumed:async offset=>{await validate();await lane.credit(offset,false);},
   reader:()=>{if(!live())throw Error('Stream closed');const handle=file.open();return {read:(n:number)=>handle.readBytes(n),close:()=>handle.close()};},
   writer:()=>{if(!live())throw Error('Stream closed');createRootStreamTemporary(a.job.owner,a.temporary);created=true;
    const handle=file.open();return {write:(bytes:Uint8Array)=>handle.writeBytes(bytes),close:()=>handle.close()};},
   hash:async()=>{await validate();const hash=await Native!.attachmentFileSha256!(a.job.owner,role==='send'?a.job.digest:a.temporary,true,a.job.descriptor.manifest.bytes);await validate();return hash;},
   discard:()=>{if(created&&file.parentDirectory.exists)file.parentDirectory.delete();created=false;},
  });
  lane.listen(data=>{void stream.receive(data).catch(()=>{});},()=>stream.abort('RTC stream closed'));
  try{await lane.ready();if(role==='send')await validate();await stream.start();await validate();
   if(role==='receive'){
    const partial=rootAttachmentPartial(a.job.owner,a.job.digest);partial.parentDirectory.create({intermediates:true,idempotent:true});
    if(partial.exists)partial.delete();file.move(partial);
   }
   console.info('[Axonic direct attachment]',JSON.stringify({direction:role,bytes:a.job.descriptor.manifest.bytes,result:'verified'}));
  }catch(error){stream.abort(error);
   const reason=error instanceof Error?error.message.toLowerCase():'';
   console.info('[Axonic direct attachment]',JSON.stringify({direction:role,bytes:a.job.descriptor.manifest.bytes,result:'fallback',
    reason:['revoked','timeout','admission','closed','checksum','unavailable','collision'].find(value=>reason.includes(value))??'transfer-error',elapsedMs:Date.now()-started}));throw error;}
  finally{if(created){const temp=rootAttachmentFile(a.job.owner,a.temporary).parentDirectory;if(temp.exists)temp.delete();}lane.close();}
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
  async pull(job:AttachmentJob,live:()=>Promise<boolean>){
   const m=job.descriptor.manifest;
   if(stopped||incoming||!Native?.attachmentFileSha256||!network.available(m.sender,m.senderDevice)||!await live()){
    console.info('[Axonic direct attachment]',JSON.stringify({direction:'receive',result:'skipped',reason:stopped?'stopped':incoming?'busy':!Native?.attachmentFileSha256?'native-unavailable':!network.available(m.sender,m.senderDevice)?'rtc-unavailable':'revoked'}));return false;
   }
   const a=await attempt(job,live);if(stopped||incoming||!await live())return false;incoming=a;let timer:ReturnType<typeof setTimeout>|undefined;
   const completed=new Promise<boolean>(resolve=>{a.finish=resolve;timer=setTimeout(()=>{a.cancel();resolve(false);},10*60*1000);});
   try{
    const response=await request(m.sender,JSON.stringify({version:1,operation:'direct-stream',digest:job.digest}));
    if(!response||JSON.parse(response).status!=='streaming')return false;
    // A successful request that never opens a channel must not hold the worker.
    const arrival=setTimeout(()=>{if(!a.lane){a.cancel();a.finish?.(false);}},5000);
    try{return await completed&&await live();}finally{clearTimeout(arrival);}
   }catch{return false;}finally{
    if(timer)clearTimeout(timer);a.cancel();await a.task?.catch(()=>{});
    if(incoming===a)incoming=undefined;
   }
  },
  async serve(job:AttachmentJob,live:()=>Promise<boolean>){
   const m=job.descriptor.manifest;
   if(stopped||outgoing||!Native?.attachmentFileSha256||!network.available(m.recipient,m.recipientDevice)||!await live())return false;
   const a=await attempt(job,live);if(stopped||outgoing||!await live())return false;outgoing=a;
   try{const lane=network.open(m.recipient,m.recipientDevice);
    a.task=run(a,lane,'send');void a.task.catch(()=>{}).finally(()=>{if(outgoing===a)outgoing=undefined;});return true;
   }catch{a.cancel();if(outgoing===a)outgoing=undefined;return false;}
  },
  stop(){stopped=true;unlisten();incoming?.cancel();outgoing?.cancel();incoming?.finish?.(false);},
 };
}
