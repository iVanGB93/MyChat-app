import {toByteArray} from 'base64-js';
import {trialReference,type TrialObservation} from './trialCredits.ts';
import {createContributionMeter,type ContributionEvent} from './networkScorecard.ts';
import type {AttachmentTransaction,AttachmentStore,AttachmentCustodyRow} from './relayStorage.ts';
export type {AttachmentCustodyRow,AttachmentTransaction,AttachmentStore} from './relayStorage.ts';
import {retiredAttachment} from './retiredAttachment.ts';
import {attachmentDigest,attachmentContentDigest,validAttachmentManifest,verifyAttachmentManifest,verifyAttachmentChunk,verifyAttachmentReceipt,attachmentBlockBytes,validAttachmentPreviewCiphertext,
 type AttachmentManifest,type AttachmentChunk,type AttachmentReceipt} from './attachmentProtocol.ts';
import {verifyRecord} from './identityProtocol.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';
import type {IdentityPeer} from './identityClient.ts';
import {ATTACHMENT_STREAM_FRAME_BYTES,isAttachmentUploadBatch,unpackAttachmentBatch,packAttachmentBatch,validAttachmentRange} from './attachmentBatch.ts';
import type {AttachmentEncoding} from './attachmentEncoding.ts';
// Counts bound metadata work, not ordinary sharing. Byte reservations remain
// the primary storage budget; group recipients share one content reservation.
export const ATTACHMENT_CUSTODY_LIMITS={records:4096,contents:1024,senderContents:256} as const;
export function createAttachmentCustody(d:{owner:string;store:AttachmentStore;records:IdentityRecordStore;now():number;current():boolean;maxBytes?:number;encoding?:AttachmentEncoding;scoreChanged?():void;trial?(event:TrialObservation):void}){
 const meter=createContributionMeter(d.now,d.scoreChanged);
 let queued=0,bulkQueued=0;const maxBytes=d.maxBytes??64*1024*1024;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid attachment capacity');
 const reply=(value:unknown)=>JSON.stringify(value);
 const contentKey=(row:AttachmentCustodyRow)=>row.manifest.shared?attachmentContentDigest(row.manifest):row.digest;
 const hasChunk=async(tx:AttachmentTransaction,key:string,index:number)=>tx.hasChunk?tx.hasChunk(key,index):!!await tx.chunk(key,index);
 async function prune(tx:AttachmentTransaction){const all=await tx.rows(),rows=all.filter(r=>!retiredAttachment(r)),seen=new Set<string>();
  if(rows.length>ATTACHMENT_CUSTODY_LIMITS.records)throw Error('Invalid attachment store');
  for(const r of rows){if(!r||!validAttachmentManifest(r.manifest,r.manifest?.expires-1)||r.digest!==attachmentDigest(r.manifest)||seen.has(r.digest)
    ||!Number.isSafeInteger(r.received)||r.received<0||r.received>Math.ceil(r.manifest.bytes/attachmentBlockBytes(r.manifest)))throw Error('Invalid attachment store');seen.add(r.digest);}
  if(tx.discardUnreferencedChunks&&all.length!==rows.length){
   for(const r of all)if(retiredAttachment(r))await tx.erase(r.digest);
   await tx.discardUnreferencedChunks([...new Set(rows.map(r=>attachmentContentDigest(r.manifest)))]);
  }
  for(const r of rows)if(r.manifest.expires<=d.now()){await tx.eraseChunks(attachmentContentDigest(r.manifest));await tx.erase(r.digest);}return rows.filter(r=>r.manifest.expires>d.now());}
 async function prefix(tx:AttachmentTransaction,m:AttachmentManifest,key:string,rows:AttachmentCustodyRow[]){
  const total=Math.ceil(m.bytes/attachmentBlockBytes(m));let n=0;
  for(const row of rows)n=Math.max(n,row.received);
  while(n<total&&await hasChunk(tx,key,n))n++;
  return n;
 }
 async function handle(request:ReturnType<typeof JSON.parse>,peer:IdentityPeer){
  const current=()=>d.current()&&peer.expiresAt>d.now()&&peer.account!==d.owner;
  const delta:Partial<Record<ContributionEvent,number>>={};let credit:TrialObservation|undefined;
  const transaction=async<T>(work:(tx:AttachmentTransaction)=>Promise<T>)=>{const result=await d.store.transaction(async tx=>{
   if(!current())throw Error('Attachment session ended');const value=await work(tx);if(!current())throw Error('Attachment session ended');return value;
  });meter.commit(delta);if(credit)try{d.trial?.(credit);}catch{}return result;};
  if(!current())return reply({status:'rejected'});
  const record=await d.records.read(peer.account);if(!record||record.account!==peer.account||!verifyRecord(record,d.now())||!record.devices.some(v=>v.id===peer.device)||!current())return reply({status:'rejected'});
  if(request.operation==='offer'){
   const m=request.manifest as AttachmentManifest;
   if(!verifyAttachmentManifest(m,record,d.now())||m.sender!==peer.account||m.senderDevice!==peer.device||m.recipient===d.owner)return reply({status:'rejected'});
   // Normalize the public fields. Never persist arbitrary extra fields supplied by the caller.
   const {version,id,sender,senderDevice,recipient,recipientDevice,created,expires,bytes,root,checksum,signature}=m;
   const manifest:AttachmentManifest={version,id,sender,senderDevice,recipient,recipientDevice,created,expires,bytes,root,checksum,signature,...(m.shared?{shared:{...m.shared}}:{}),...(m.preview?{preview:{...m.preview}}:{})},digest=attachmentDigest(manifest);
   return transaction(async tx=>{
    const rows=await prune(tx);if(!current()||expires<=d.now())return reply({status:'rejected'});
    const content=attachmentContentDigest(manifest),siblings=rows.filter(r=>!!r.manifest.shared&&!!m.shared&&r.manifest.sender===sender&&r.manifest.shared!.id===m.shared!.id);
    const old=rows.find(r=>r.manifest.sender===sender&&r.manifest.id===id);
    const previewRows=m.shared?siblings:old?[old]:[];
    const previewNeeded=m.preview?{previewNeeded:!previewRows.some(r=>r.preview&&contentKey(r)===content)}:{};
    if(old)return reply(old.digest===digest?{status:old.receipt?'completed':'held',received:m.shared?await prefix(tx,m,content,siblings.filter(r=>contentKey(r)===content)):old.received,...previewNeeded}:{status:'conflict'});
    if(siblings.some(r=>contentKey(r)!==content||r.manifest.shared!.slot===m.shared!.slot||r.manifest.recipient===recipient))return reply({status:'conflict'});
    const completed=new Map<string,number>(),reserved=new Map<string,AttachmentManifest>();
    // A completed grant can still reserve shared bytes for not-yet-offered slots.
    for(const r of rows){
     if(r.receipt&&!r.manifest.shared)continue;
     const key=contentKey(r);reserved.set(key,r.manifest);
     if(r.receipt)completed.set(key,(completed.get(key)??0)+1);
    }
    for(const [key,count] of completed)if(count>=reserved.get(key)!.shared!.count)reserved.delete(key);
    if(rows.length>=ATTACHMENT_CUSTODY_LIMITS.records)return reply({status:'full',reason:'record_capacity'});
    if(!reserved.has(content)){
     if(reserved.size>=ATTACHMENT_CUSTODY_LIMITS.contents)return reply({status:'full',reason:'content_capacity'});
     if([...reserved.values()].filter(m=>m.sender===sender).length>=ATTACHMENT_CUSTODY_LIMITS.senderContents)return reply({status:'full',reason:'sender_capacity'});
     if([...reserved.values()].reduce((n,m)=>n+m.bytes,bytes)>maxBytes)return reply({status:'full',reason:'byte_capacity'});
    }
    const received=m.shared?await prefix(tx,m,content,siblings):0;
    await tx.save({manifest,digest,received,receipt:null});delta.attachmentGrantsHeld=1;return reply({status:'held',received,...previewNeeded});
   });
  }
  if(typeof request.digest!=='string'||!/^[a-f0-9]{64}$/.test(request.digest))return reply({status:'rejected'});
  return transaction(async tx=>{
   const rows=await prune(tx),row=rows.find(r=>r.digest===request.digest);if(!row||!current())return reply({status:'unavailable'});
   const m=row.manifest,from=peer.account===m.sender&&peer.device===m.senderDevice,to=peer.account===m.recipient&&peer.device===m.recipientDevice;
   if(!from&&!to)return reply({status:'rejected'});
   const content=contentKey(row),shared=m.shared;
   const contentRows=()=>shared?rows.filter(r=>r.manifest.sender===m.sender&&r.manifest.shared?.id===shared.id&&contentKey(r)===content):[row];
   if(request.operation==='get-preview'&&to){
    if(Object.keys(request).sort().join(',')!=='digest,operation,version')return reply({status:'rejected'});
    const data=m.preview?contentRows().find(r=>r.preview)?.preview:undefined;
    return reply(data?{status:'ok',data}:{status:'unavailable'});
   }
   if(request.operation==='put-preview'&&from){
    const data=request.data;
    if(Object.keys(request).sort().join(',')!=='data,digest,operation,version'||typeof data!=='string'||data.length>8024||data.length%4
     ||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||!validAttachmentPreviewCiphertext(m,toByteArray(data)))return reply({status:'rejected'});
    if(!contentRows().some(r=>r.preview)){row.preview=data;await tx.save(row);}
    return reply({status:'held'});
   }
   if(request.operation==='status')return reply({status:row.receipt?'completed':'held',received:await prefix(tx,m,content,contentRows()),total:Math.ceil(m.bytes/attachmentBlockBytes(m)),receipt:row.receipt});
   if(request.operation==='put-batch'&&from){
    if(row.receipt)return reply({status:'completed'});
    const chunks=unpackAttachmentBatch(m,request.index,request.count,request.data,d.encoding);
    // Validate the entire range before mutating storage. Keep the exact original
    // per-chunk Merkle checks; batching is not an aggregate proof or new cipher.
    for(let n=0;n<chunks.length;n++){
     if(!current()||m.expires<=d.now()||!verifyAttachmentChunk(m,chunks[n]))throw Error('Invalid attachment batch');
     if((n+1)%16===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    let added=0;
    for(const chunk of chunks){
     if(!current()||m.expires<=d.now())throw Error('Attachment session ended');
     if(!await hasChunk(tx,content,chunk.index)){await tx.saveChunk(content,chunk);added++;delta.ciphertextBytesStored=(delta.ciphertextBytesStored??0)+chunk.ciphertext.length/2;}
    }
    if(added){delta.blocksStored=added;
     const siblings=contentRows(),received=await prefix(tx,m,content,siblings);
     for(const sibling of siblings)if(sibling.received!==received){sibling.received=received;await tx.save(sibling);}
    }
    if(m.expires<=d.now())throw Error('Attachment expired');
    // The transaction wrapper checks the session again and withholds this reply
    // until commit succeeds. Retransmission of the same range is idempotent.
    return reply({status:'held',index:request.index,count:request.count,received:row.received});
   }
   if(request.operation==='get-batch'&&to){
    if(row.receipt)return reply({status:'completed'});
    if(!validAttachmentRange(m,request.index,request.count))return reply({status:'rejected'});
    const chunks:AttachmentChunk[]=[];
    for(let n=0;n<request.count;n++){
     const chunk=await tx.chunk(content,request.index+n);
     if(!chunk)return reply({status:'unavailable'});
     chunks.push(chunk);
    }
    return reply({status:'ok',index:request.index,count:request.count,data:packAttachmentBatch(m,request.index,chunks,undefined,d.encoding)});
   }
   if(request.operation==='receipt'&&to&&verifyAttachmentReceipt(request.receipt,m,record,d.now())){
    // Recipient receipt authorizes deletion even if it obtained some chunks from another neuron.
    const {version,id,digest,recipient,device,expires,signature,route,routeSignature}=request.receipt as AttachmentReceipt;
    credit={kind:'media-receipt',reference:trialReference(m.sender,m.id,m.recipient)};if(!row.receipt)delta.attachmentReceipts=1;
    row.receipt={version,id,digest,recipient,device,expires,signature,...(route?{route:{sources:[...route.sources],partial:route.partial},routeSignature}:{})};await tx.save(row);
    if(!shared||contentRows().filter(r=>r.receipt).length===shared.count)await tx.eraseChunks(content);
    return reply({status:'completed'});
   }
   return reply({status:'rejected'});
  });
 }
 return {
  contribution:meter.snapshot,
  async receive(raw:string,peer:IdentityPeer){
   if(typeof raw!=='string'||raw.length>ATTACHMENT_STREAM_FRAME_BYTES-1024||queued>=8)return reply({status:'rejected'});
   let request;try{request=JSON.parse(raw);}catch{return reply({status:'rejected'});}
   if(request?.version!==1)return reply({status:'rejected'});
   const bulk=request.operation==='put-batch';
   if(bulk?bulkQueued>=2||!isAttachmentUploadBatch(request)||new TextEncoder().encode(raw).length>ATTACHMENT_STREAM_FRAME_BYTES-1024:raw.length>13000)return reply({status:'rejected'});
   queued++;if(bulk)bulkQueued++;
   try{return await handle(request,peer);}catch{return reply({status:'rejected'});}finally{queued--;if(bulk)bulkQueued--;}
  },
  sweep:()=>d.store.transaction(async tx=>{await prune(tx);}),
 };
}
