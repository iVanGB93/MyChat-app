import {attachmentDigest,validAttachmentManifest,verifyAttachmentManifest,verifyAttachmentChunk,verifyAttachmentReceipt,ATTACHMENT_CHUNK_BYTES,
 type AttachmentManifest,type AttachmentChunk,type AttachmentReceipt} from './attachmentProtocol.ts';
import {verifyRecord} from './identityProtocol.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';
import type {IdentityPeer} from './identityClient.ts';
export interface AttachmentCustodyRow {digest:string;manifest:AttachmentManifest;received:number;receipt:AttachmentReceipt|null}
export interface AttachmentTransaction {
 rows():Promise<AttachmentCustodyRow[]>;
 save(row:AttachmentCustodyRow):Promise<void>;
 chunk(digest:string,index:number):Promise<AttachmentChunk|null>;
 saveChunk(digest:string,chunk:AttachmentChunk):Promise<void>;
 eraseChunks(digest:string):Promise<void>;
 erase(digest:string):Promise<void>;
}
/** Metadata and ciphertext writes/deletes must commit atomically or throw, serialized per database. */
export interface AttachmentStore {transaction<T>(work:(tx:AttachmentTransaction)=>Promise<T>):Promise<T>}
export function createAttachmentCustody(d:{owner:string;store:AttachmentStore;records:IdentityRecordStore;now():number;current():boolean;maxBytes?:number}){
 let queued=0;const maxBytes=d.maxBytes??64*1024*1024;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid attachment capacity');
 const reply=(value:unknown)=>JSON.stringify(value);
 async function prune(tx:AttachmentTransaction){const rows=await tx.rows(),seen=new Set<string>();
  if(rows.length>128)throw Error('Invalid attachment store');
  for(const r of rows){if(!r||!validAttachmentManifest(r.manifest,r.manifest?.expires-1)||r.digest!==attachmentDigest(r.manifest)||seen.has(r.digest)
    ||!Number.isSafeInteger(r.received)||r.received<0||r.received>Math.ceil(r.manifest.bytes/ATTACHMENT_CHUNK_BYTES))throw Error('Invalid attachment store');seen.add(r.digest);}
  for(const r of rows)if(r.manifest.expires<=d.now())await tx.erase(r.digest);return rows.filter(r=>r.manifest.expires>d.now());}
 async function handle(raw:string,peer:IdentityPeer){
  const current=()=>d.current()&&peer.expiresAt>d.now()&&peer.account!==d.owner;
  const transaction=<T>(work:(tx:AttachmentTransaction)=>Promise<T>)=>d.store.transaction(async tx=>{
   if(!current())throw Error('Attachment session ended');const value=await work(tx);if(!current())throw Error('Attachment session ended');return value;
  });
  if(!current())return reply({status:'rejected'});
  const request=JSON.parse(raw);if(request.version!==1)return reply({status:'rejected'});
  const record=await d.records.read(peer.account);if(!record||record.account!==peer.account||!verifyRecord(record,d.now())||!record.devices.some(v=>v.id===peer.device)||!current())return reply({status:'rejected'});
  if(request.operation==='offer'){
   const m=request.manifest as AttachmentManifest;
   if(!verifyAttachmentManifest(m,record,d.now())||m.sender!==peer.account||m.senderDevice!==peer.device||m.recipient===d.owner)return reply({status:'rejected'});
   // Normalize the public fields. Never persist arbitrary extra fields supplied by the caller.
   const {version,id,sender,senderDevice,recipient,recipientDevice,created,expires,bytes,root,signature}=m;
   const manifest={version,id,sender,senderDevice,recipient,recipientDevice,created,expires,bytes,root,signature},digest=attachmentDigest(manifest);
   return transaction(async tx=>{
    const rows=await prune(tx);if(!current()||expires<=d.now())return reply({status:'rejected'});
    const old=rows.find(r=>r.manifest.sender===sender&&r.manifest.id===id);
    if(old)return reply(old.digest===digest?{status:old.receipt?'completed':'held',received:old.received}:{status:'conflict'});
    const held=rows.filter(r=>!r.receipt);
    if(rows.length>=128||held.length>=16||held.filter(r=>r.manifest.sender===sender).length>=4||held.reduce((n,r)=>n+r.manifest.bytes,bytes)>maxBytes)return reply({status:'full'});
    await tx.save({manifest,digest,received:0,receipt:null});return reply({status:'held',received:0});
   });
  }
  if(typeof request.digest!=='string'||!/^[a-f0-9]{64}$/.test(request.digest))return reply({status:'rejected'});
  return transaction(async tx=>{
   const row=(await prune(tx)).find(r=>r.digest===request.digest);if(!row||!current())return reply({status:'unavailable'});
   const m=row.manifest,from=peer.account===m.sender&&peer.device===m.senderDevice,to=peer.account===m.recipient&&peer.device===m.recipientDevice;
   if(!from&&!to)return reply({status:'rejected'});
   if(request.operation==='status')return reply({status:row.receipt?'completed':'held',received:row.received,total:Math.ceil(m.bytes/ATTACHMENT_CHUNK_BYTES),receipt:row.receipt});
   if(request.operation==='put'&&from){
    if(row.receipt)return reply({status:'completed'});
    const chunk=request.chunk as AttachmentChunk;if(!verifyAttachmentChunk(m,chunk))return reply({status:'rejected'});
    if(!await tx.chunk(row.digest,chunk.index)){
     await tx.saveChunk(row.digest,{index:chunk.index,ciphertext:chunk.ciphertext,proof:chunk.proof.slice()});
     row.received++;await tx.save(row);
    }return reply({status:'held',received:row.received});
   }
   if(request.operation==='get'&&to){
    if(row.receipt)return reply({status:'completed'});
    if(!Number.isSafeInteger(request.index)||request.index<0||request.index>=Math.ceil(m.bytes/ATTACHMENT_CHUNK_BYTES))return reply({status:'rejected'});
    return reply({status:'ok',chunk:await tx.chunk(row.digest,request.index)});
   }
   if(request.operation==='receipt'&&to&&verifyAttachmentReceipt(request.receipt,m,record,d.now())){
    // Recipient receipt authorizes deletion even if it obtained some chunks from another neuron.
    const {version,id,digest,recipient,device,expires,signature}=request.receipt as AttachmentReceipt;
    await tx.eraseChunks(row.digest);row.receipt={version,id,digest,recipient,device,expires,signature};await tx.save(row);
    return reply({status:'completed'});
   }
   return reply({status:'rejected'});
  });
 }
 return {
  async receive(raw:string,peer:IdentityPeer){
   if(typeof raw!=='string'||raw.length>13000||queued>=8)return reply({status:'rejected'});queued++;
   try{return await handle(raw,peer);}catch{return reply({status:'rejected'});}finally{queued--;}
  },
  sweep:()=>d.store.transaction(async tx=>{await prune(tx);}),
 };
}
