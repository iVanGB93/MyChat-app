import type {AttachmentTransaction,AttachmentStore} from './relayStorage.ts';
export type {AttachmentCustodyRow,AttachmentTransaction,AttachmentStore} from './relayStorage.ts';
import {retiredAttachment} from './retiredAttachment.ts';
import {attachmentDigest,attachmentContentDigest,validAttachmentManifest,verifyAttachmentManifest,verifyAttachmentChunk,verifyAttachmentReceipt,attachmentBlockBytes,
 type AttachmentManifest,type AttachmentChunk,type AttachmentReceipt} from './attachmentProtocol.ts';
import {verifyRecord} from './identityProtocol.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';
import type {IdentityPeer} from './identityClient.ts';
import {ATTACHMENT_STREAM_FRAME_BYTES,isAttachmentUploadBatchRequest,unpackAttachmentBatch,packAttachmentBatch,validAttachmentRange} from './attachmentBatch.ts';
import type {AttachmentEncoding} from './attachmentEncoding.ts';
export function createAttachmentCustody(d:{owner:string;store:AttachmentStore;records:IdentityRecordStore;now():number;current():boolean;maxBytes?:number;encoding?:AttachmentEncoding}){
 let queued=0,bulkQueued=0;const maxBytes=d.maxBytes??64*1024*1024;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid attachment capacity');
 const reply=(value:unknown)=>JSON.stringify(value);
 async function prune(tx:AttachmentTransaction){const rows=(await tx.rows()).filter(r=>!retiredAttachment(r)),seen=new Set<string>();
  if(rows.length>128)throw Error('Invalid attachment store');
  for(const r of rows){if(!r||!validAttachmentManifest(r.manifest,r.manifest?.expires-1)||r.digest!==attachmentDigest(r.manifest)||seen.has(r.digest)
    ||!Number.isSafeInteger(r.received)||r.received<0||r.received>Math.ceil(r.manifest.bytes/attachmentBlockBytes(r.manifest)))throw Error('Invalid attachment store');seen.add(r.digest);}
  for(const r of rows)if(r.manifest.expires<=d.now()){await tx.eraseChunks(attachmentContentDigest(r.manifest));await tx.erase(r.digest);}return rows.filter(r=>r.manifest.expires>d.now());}
 async function prefix(tx:AttachmentTransaction,m:AttachmentManifest){const key=attachmentContentDigest(m),total=Math.ceil(m.bytes/attachmentBlockBytes(m));let n=Math.max(0,...(await tx.rows()).filter(r=>!retiredAttachment(r)&&attachmentContentDigest(r.manifest)===key).map(r=>r.received));while(n<total&&await tx.chunk(key,n))n++;return n;}
 async function handle(raw:string,peer:IdentityPeer){
  const current=()=>d.current()&&peer.expiresAt>d.now()&&peer.account!==d.owner;
  const transaction=<T>(work:(tx:AttachmentTransaction)=>Promise<T>)=>d.store.transaction(async tx=>{
   if(!current())throw Error('Attachment session ended');const value=await work(tx);if(!current())throw Error('Attachment session ended');return value;
  });
  if(!current())return reply({status:'rejected'});
  const request=JSON.parse(raw);if(request.version!==1)return reply({status:'rejected'});
  if(request.operation==='put-batch'&&!isAttachmentUploadBatchRequest(raw))return reply({status:'rejected'});
  const record=await d.records.read(peer.account);if(!record||record.account!==peer.account||!verifyRecord(record,d.now())||!record.devices.some(v=>v.id===peer.device)||!current())return reply({status:'rejected'});
  if(request.operation==='offer'){
   const m=request.manifest as AttachmentManifest;
   if(!verifyAttachmentManifest(m,record,d.now())||m.sender!==peer.account||m.senderDevice!==peer.device||m.recipient===d.owner)return reply({status:'rejected'});
   // Normalize the public fields. Never persist arbitrary extra fields supplied by the caller.
   const {version,id,sender,senderDevice,recipient,recipientDevice,created,expires,bytes,root,checksum,signature}=m;
   const manifest:AttachmentManifest={version,id,sender,senderDevice,recipient,recipientDevice,created,expires,bytes,root,checksum,signature,...(!!m.shared?{shared:{...m.shared!}}:{})},digest=attachmentDigest(manifest);
   return transaction(async tx=>{
    const rows=await prune(tx);if(!current()||expires<=d.now())return reply({status:'rejected'});
    const old=rows.find(r=>r.manifest.sender===sender&&r.manifest.id===id);
    if(old)return reply(old.digest===digest?{status:old.receipt?'completed':'held',received:!!m.shared?await prefix(tx,m):old.received}:{status:'conflict'});
    const content=attachmentContentDigest(manifest),siblings=rows.filter(r=>!!r.manifest.shared&&!!m.shared&&r.manifest.sender===sender&&r.manifest.shared!.id===m.shared!.id);
    if(siblings.some(r=>attachmentContentDigest(r.manifest)!==content||r.manifest.shared!.slot===m.shared!.slot||r.manifest.recipient===recipient))return reply({status:'conflict'});
    const held=rows.filter(r=>!r.receipt);
    const reserved=new Map(held.map(r=>[attachmentContentDigest(r.manifest),r.manifest]));
    // A completed grant can still reserve shared bytes for not-yet-offered slots.
    for(const r of rows)if(!!r.manifest.shared&&rows.filter(v=>attachmentContentDigest(v.manifest)===attachmentContentDigest(r.manifest)&&v.receipt).length<r.manifest.shared!.count)reserved.set(attachmentContentDigest(r.manifest),r.manifest);
    if(rows.length>=128||!reserved.has(content)&&(reserved.size>=16||[...reserved.values()].filter(m=>m.sender===sender).length>=4||[...reserved.values()].reduce((n,m)=>n+m.bytes,bytes)>maxBytes))return reply({status:'full'});
    const received=!!m.shared?await prefix(tx,m):0;
    await tx.save({manifest,digest,received,receipt:null});return reply({status:'held',received});
   });
  }
  if(typeof request.digest!=='string'||!/^[a-f0-9]{64}$/.test(request.digest))return reply({status:'rejected'});
  return transaction(async tx=>{
   const rows=await prune(tx),row=rows.find(r=>r.digest===request.digest);if(!row||!current())return reply({status:'unavailable'});
   const m=row.manifest,from=peer.account===m.sender&&peer.device===m.senderDevice,to=peer.account===m.recipient&&peer.device===m.recipientDevice;
   const content=attachmentContentDigest(m);
   if(!from&&!to)return reply({status:'rejected'});
   if(request.operation==='status')return reply({status:row.receipt?'completed':'held',received:await prefix(tx,m),total:Math.ceil(m.bytes/attachmentBlockBytes(m)),receipt:row.receipt});
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
     if(!await tx.chunk(content,chunk.index)){await tx.saveChunk(content,chunk);added++;}
    }
    if(added){
     const received=await prefix(tx,m);for(const sibling of rows.filter(r=>attachmentContentDigest(r.manifest)===content)){sibling.received=received;await tx.save(sibling);}
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
    const {version,id,digest,recipient,device,expires,signature}=request.receipt as AttachmentReceipt;
    row.receipt={version,id,digest,recipient,device,expires,signature};await tx.save(row);
    if(!m.shared||rows.filter(r=>attachmentContentDigest(r.manifest)===content&&r.receipt).length===m.shared!.count)await tx.eraseChunks(content);
    return reply({status:'completed'});
   }
   return reply({status:'rejected'});
  });
 }
 return {
  async receive(raw:string,peer:IdentityPeer){
   if(typeof raw!=='string'||raw.length>ATTACHMENT_STREAM_FRAME_BYTES-1024||queued>=8)return reply({status:'rejected'});
   const bulk=isAttachmentUploadBatchRequest(raw);
   if(raw.length>13000&&!bulk||bulk&&(bulkQueued>=2||new TextEncoder().encode(raw).length>ATTACHMENT_STREAM_FRAME_BYTES-1024))return reply({status:'rejected'});
   queued++;if(bulk)bulkQueued++;
   try{return await handle(raw,peer);}catch{return reply({status:'rejected'});}finally{queued--;if(bulk)bulkQueued--;}
  },
  sweep:()=>d.store.transaction(async tx=>{await prune(tx);}),
 };
}
