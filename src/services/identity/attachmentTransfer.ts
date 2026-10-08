import {hexToBytes} from '@noble/hashes/utils.js';
import {attachmentDigest,validAttachmentManifest,verifyAttachmentManifest,verifyAttachmentChunk,decryptAttachmentChunk,
 verifyAttachmentReceipt,ATTACHMENT_CHUNK_BYTES,type AttachmentManifest,type AttachmentChunk,type AttachmentReceipt} from './attachmentProtocol.ts';
import {validAccountId,type IdentityRecord} from './identityProtocol.ts';
import type {IdentityPeer} from './identityClient.ts';

/** Private chat metadata. Never send this descriptor to a custodian outside encrypted chat. */
export interface AttachmentDescriptor {manifest:AttachmentManifest;key:string;checksum:string;name:string;mime:string}
export class AttachmentFileReset extends Error {}
export const attachmentDescriptorFingerprint=(d:AttachmentDescriptor)=>JSON.stringify([attachmentDigest(d.manifest),d.key,d.checksum,d.name,d.mime]);
export type AttachmentPhase='queued'|'uploading'|'downloading'|'confirming'|'complete'|'expired'|'cancelled';
export interface AttachmentJob {
 version:1;owner:string;digest:string;direction:'outgoing'|'incoming';descriptor:AttachmentDescriptor;
 revision:number;phase:AttachmentPhase;cursor:number;relay:string|null;next:number;failures:number;receipt:AttachmentReceipt|null;
 custodians:string[];acknowledged:string[];
}
export interface AttachmentJobStore {
 /** Move finished legacy rows out of the bounded work queue without deleting own receipts or files. */
 retire?(owner:string,current:()=>boolean):Promise<void>;
 list(owner:string):Promise<AttachmentJob[]>;
 get(owner:string,digest:string):Promise<AttachmentJob|null>;
 /** expected=null creates. Commit atomically only when revision and current() still match. */
 save(job:AttachmentJob,expected:number|null,current:()=>boolean):Promise<boolean>;
}
const terminal=(phase:AttachmentPhase)=>['complete','expired','cancelled'].includes(phase);
const total=(job:AttachmentJob)=>Math.ceil(job.descriptor.manifest.bytes/ATTACHMENT_CHUNK_BYTES);
export function validAttachmentDescriptor(value:unknown):value is AttachmentDescriptor {
 const d=value as AttachmentDescriptor;
 return !!d&&Object.keys(d).length===5&&validAttachmentManifest(d.manifest,d.manifest?.expires-1)&&Object.keys(d.manifest).length===11&&typeof d.key==='string'&&/^[a-f0-9]{64}$/.test(d.key)
  &&typeof d.checksum==='string'&&/^[a-f0-9]{64}$/.test(d.checksum)&&typeof d.name==='string'&&d.name.length>0&&d.name.length<=120
  &&!/[\x00-\x1f\x7f/\\]/.test(d.name)&&typeof d.mime==='string'&&d.mime.length<=100&&/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(d.mime);
}
export function validAttachmentJob(job:unknown):job is AttachmentJob {
 const j=job as AttachmentJob;if(!j||j.version!==1||!validAttachmentDescriptor(j.descriptor)||!validAccountId(j.owner)
  ||!['incoming','outgoing'].includes(j.direction)||j.digest!==attachmentDigest(j.descriptor.manifest)
  ||j.owner!==(j.direction==='outgoing'?j.descriptor.manifest.sender:j.descriptor.manifest.recipient)
  ||!Number.isSafeInteger(j.revision)||j.revision<0||!Number.isSafeInteger(j.cursor)||j.cursor<0||j.cursor>total(j)
  ||!['queued','uploading','downloading','confirming','complete','expired','cancelled'].includes(j.phase)
  ||!Number.isSafeInteger(j.next)||j.next<0||!Number.isSafeInteger(j.failures)||j.failures<0||j.failures>32
  ||j.relay!==null&&!validAccountId(j.relay)
  ||!Array.isArray(j.custodians)||j.custodians.length>10||j.custodians.some(p=>!validAccountId(p))||new Set(j.custodians).size!==j.custodians.length
  ||!Array.isArray(j.acknowledged)||j.acknowledged.some(p=>!j.custodians.includes(p))||new Set(j.acknowledged).size!==j.acknowledged.length)return false;
 return j.receipt===null||!!j.receipt&&j.receipt.version===1&&j.receipt.id===j.descriptor.manifest.id&&j.receipt.digest===j.digest
  &&j.receipt.recipient===j.descriptor.manifest.recipient&&j.receipt.device===j.descriptor.manifest.recipientDevice
  &&j.receipt.expires===j.descriptor.manifest.expires&&/^[a-f0-9]{128}$/.test(j.receipt.signature);
}
/** Durable resumable jobs. Platform adapters own file I/O; no Django IDs, URLs or access tokens. */
export function createAttachmentTransfer(d:{
 owner():string|null;device():string|null;now():number;store:AttachmentJobStore;
 record(account:string):Promise<IdentityRecord|null>;peers():string[];allowed(peer:string):boolean;allowedJob?(job:AttachmentJob):boolean;
 request(peer:string,raw:string):Promise<string|null>;
 readChunk(job:AttachmentJob,index:number):Promise<AttachmentChunk>;
 /** Persist exact bytes at index; repeating a chunk must be idempotent. Never use the remote name as a path. */
 writeChunk(job:AttachmentJob,index:number,plain:Uint8Array,current:()=>boolean):Promise<void>;
 /** Read back the complete durable file, verify its size and descriptor.checksum, then publish it atomically. */
 commitFile(job:AttachmentJob,current:()=>boolean):Promise<void>;
 signReceipt(manifest:AttachmentManifest):Promise<AttachmentReceipt>;
 /** Idempotently update the own-chat row; called only for a verified complete file/recipient receipt. */
 completed(job:AttachmentJob,current:()=>boolean):Promise<void>;
}){
 let stopped=false,busy=false,generation=0,cursor=0,requests=0;
 const unavailable=new Map<string,number>();
 const directWaiting=new Map<string,number>();
 async function request(peer:string,operation:string,job:AttachmentJob,extra:object={}){
  const raw=await d.request(peer,JSON.stringify({version:1,operation,digest:job.digest,...extra}));
  if(!raw||raw.length>14000)throw Error('Attachment route unavailable');return JSON.parse(raw);
 }
 async function run(initial:AttachmentJob,epoch:number){
  let job=initial;const manifest=job.descriptor.manifest;
  const other=job.direction==='outgoing'?manifest.recipient:manifest.sender;
  const current=()=>!stopped&&generation===epoch&&d.owner()===job.owner&&d.allowed(other)&&(d.allowedJob?.(job)??true);
  async function live(){const saved=await d.store.get(job.owner,job.digest);return current()&&saved?.revision===job.revision&&!terminal(saved.phase);}
  async function save(patch:Partial<AttachmentJob>){
   const next={...job,...patch,revision:job.revision+1};if(!current()||!await d.store.save(next,job.revision,current))throw Error('Attachment job changed');job=next;
  }
  try{
   if(!await live())return;
   if(manifest.expires<=d.now()){await save({phase:'expired'});return;}
   const peer=job.direction==='outgoing'?manifest.recipient:manifest.sender;
   if(!d.allowed(peer))return;
   const sender=await d.record(manifest.sender);if(!sender||!verifyAttachmentManifest(manifest,sender,d.now())||!await live())return;
   if(job.direction==='incoming'&&manifest.recipientDevice!==d.device())return;
   if(job.direction==='outgoing'&&job.receipt){
    const recipient=await d.record(manifest.recipient);
    if(!recipient||!verifyAttachmentReceipt(job.receipt,manifest,recipient,d.now())||!await live())return;
    await d.completed(job,current);if(await live())await save({phase:'complete',next:0});return;
   }
   if(job.direction==='outgoing'&&d.peers().includes(peer)){
    // A ready recipient pulls directly from our own encrypted file. Older peers reject this operation.
    let response;try{response=await request(peer,'direct-status',job);}catch{}
    if(!await live())return;
    if(response?.status==='ready'){await save({next:d.now()+2000});return;}
    // Give the encrypted descriptor time to reach a connected recipient before creating custody.
    if(!job.custodians.length&&job.cursor===0){
     if(!directWaiting.has(job.digest)){if(directWaiting.size>=128)directWaiting.clear();directWaiting.set(job.digest,d.now()+3000);}
     if(d.now()<directWaiting.get(job.digest)!){await save({next:d.now()+500});return;}
    }
   }
   if(job.direction==='incoming'&&job.receipt){
    const recipient=await d.record(manifest.recipient);
    if(!recipient||!verifyAttachmentReceipt(job.receipt,manifest,recipient,d.now())||!await live())return;
    await d.completed(job,current);if(!await live())return;
    const pending=job.custodians.filter(p=>!job.acknowledged.includes(p));
    if(!pending.length){await save({phase:'complete',next:0});return;}
    const relay=pending.find(p=>d.peers().includes(p)&&(unavailable.get(job.digest+':'+p)??0)<=d.now());if(!relay)return;
    if(job.relay!==relay)await save({relay});
    const r=await request(relay,relay===manifest.sender?'direct-receipt':'receipt',job,{receipt:job.receipt});if(!await live())return;
    if(r.status!=='completed')throw Error('Attachment receipt not accepted');
    const acknowledged=[...job.acknowledged,relay];await save({acknowledged,phase:acknowledged.length===job.custodians.length?'complete':'confirming',next:0,failures:0});return;
   }
   const peers=d.peers().filter(p=>validAccountId(p)&&p!==job.owner&&(job.direction==='incoming'||p!==peer)&&(unavailable.get(job.digest+':'+p)??0)<=d.now()).sort((a,b)=>Number(b===peer)-Number(a===peer)).slice(0,10);
   if(!job.relay||!peers.includes(job.relay)||job.direction==='incoming'&&peers[0]===peer&&job.relay!==peer){
    if(!peers.length)return;
    await save({relay:peers[0],phase:job.direction==='outgoing'?'queued':job.receipt?'confirming':'downloading',cursor:job.direction==='outgoing'?0:job.cursor});
   }
   const relay=job.relay!;
   if(job.direction==='outgoing'){
    if(job.phase==='queued'){
     const r=await request(relay,'offer',job,{manifest});if(!await live())return;
     if(!['held','completed'].includes(r.status))throw Error('Attachment custodian refused');
     const custodians=job.custodians.includes(relay)?job.custodians:[...job.custodians,relay];
     if(custodians.length>9)throw Error('Too many attachment custodians');
     await save({phase:r.status==='completed'?'confirming':'uploading',custodians,failures:0,next:0});return;
    }
    if(job.phase==='uploading'&&job.cursor<total(job)){
     const chunk=await d.readChunk(job,job.cursor);if(!await live())return;
     if(chunk.index!==job.cursor||!verifyAttachmentChunk(manifest,chunk))throw Error('Own attachment chunk invalid');
     const r=await request(relay,'put',job,{chunk});if(!await live())return;
     if(!['held','completed'].includes(r.status))throw Error('Attachment chunk refused');
     const next=job.cursor+1;await save({cursor:next,phase:r.status==='completed'||next===total(job)?'confirming':'uploading',failures:0,next:0});return;
    }
    const r=await request(relay,'status',job);if(!await live())return;
    if(r.status==='held'){await save({next:d.now()+2000});return;}
    const recipient=await d.record(manifest.recipient);
    if(r.status!=='completed'||!recipient||!verifyAttachmentReceipt(r.receipt,manifest,recipient,d.now()))throw Error('No verified attachment receipt');
    if(!await live())return;
    await d.completed({...job,receipt:r.receipt},current);if(!await live())return;
    await save({receipt:r.receipt,phase:'complete',next:0,failures:0});return;
   }
   if(job.cursor<total(job)){
    const r=await request(relay,relay===manifest.sender?'direct-get':'get',job,{index:job.cursor});if(!await live())return;
    if(r.status!=='ok'||!r.chunk||r.chunk.index!==job.cursor||!verifyAttachmentChunk(manifest,r.chunk))throw Error('Attachment chunk unavailable');
    const key=hexToBytes(job.descriptor.key);let plain:Uint8Array|undefined;
    try{plain=decryptAttachmentChunk(manifest,r.chunk,key);if(!await live())return;await d.writeChunk(job,job.cursor,plain,current);}
    finally{key.fill(0);plain?.fill(0);}
    if(!await live())return;
    // The sender can disclose prior upload destinations so direct completion also cleans partial custody.
    const prior=relay===manifest.sender&&Array.isArray(r.custodians)?r.custodians.filter((p:unknown)=>validAccountId(p)&&p!==job.owner).slice(0,9):[];
    const custodians=[...new Set<string>([...job.custodians,relay,...prior])];if(custodians.length>10)throw Error('Too many attachment sources');
    await save({cursor:job.cursor+1,custodians,next:0,failures:0});return;
   }
   if(!job.receipt){
    await d.commitFile(job,current);if(!await live())return;
    const receipt=await d.signReceipt(manifest),recipient=await d.record(manifest.recipient);
    if(!recipient||!verifyAttachmentReceipt(receipt,manifest,recipient,d.now())||!await live())return;
    await save({receipt,phase:'confirming'});
   }
  }catch(error){
   if(!await live())return;
   if(job.relay){if(unavailable.size>=128)unavailable.clear();unavailable.set(job.digest+':'+job.relay,d.now()+10000);}
   const failures=Math.min(32,job.failures+1);
   await save({relay:null,phase:job.direction==='outgoing'?'queued':job.receipt?'confirming':'downloading',cursor:job.direction==='outgoing'||error instanceof AttachmentFileReset?0:job.cursor,failures,next:d.now()+Math.min(30000,500*2**Math.min(failures,6))}).catch(()=>{});
  }
 }
 return {
  /** Own-file requests are scoped to the authenticated intended endpoint, never arbitrary peers. */
  async receive(raw:string,peer:IdentityPeer):Promise<string|null>{
   let input;try{if(raw.length>13000)return null;input=JSON.parse(raw);}catch{return null;}
   if(!['direct-status','direct-get','direct-receipt'].includes(input?.operation))return null;
   const reply=(status:string,extra:object={})=>JSON.stringify({status,...extra});
   let admittedJob:AttachmentJob|null=null;
   const owner=d.owner(),epoch=generation,current=()=>!stopped&&generation===epoch&&d.owner()===owner&&d.allowed(peer.account)&&peer.expiresAt>d.now()&&(!admittedJob||(d.allowedJob?.(admittedJob)??true));
   if(!owner||requests>=8||input.version!==1||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||!current())return reply('rejected');requests++;
   try{
    const job=await d.store.get(owner,input.digest);if(!job||!current()||!(d.allowedJob?.(job)??true)||['cancelled','expired'].includes(job.phase))return reply('unavailable');
    admittedJob=job;
    const m=job.descriptor.manifest,sender=await d.record(m.sender),recipient=await d.record(m.recipient);
    if(!sender||!recipient||!verifyAttachmentManifest(m,sender,d.now())||!current())return reply('rejected');
    if(input.operation==='direct-status')return job.direction==='incoming'&&peer.account===m.sender&&peer.device===m.senderDevice&&d.device()===m.recipientDevice&&job.failures===0?reply('ready'):reply('unavailable');
    if(job.direction!=='outgoing'||peer.account!==m.recipient||peer.device!==m.recipientDevice||d.device()!==m.senderDevice)return reply('rejected');
    if(input.operation==='direct-get'){
     if(!Number.isSafeInteger(input.index)||input.index<0||input.index>=total(job))return reply('rejected');
     const chunk=await d.readChunk(job,input.index);return current()&&chunk.index===input.index&&verifyAttachmentChunk(m,chunk)?reply('ok',{chunk,custodians:job.custodians.slice(0,9)}):reply('rejected');
    }
    if(!verifyAttachmentReceipt(input.receipt,m,recipient,d.now())||!current())return reply('rejected');
    if(job.receipt)return reply('completed');
    const saved=await d.store.save({...job,revision:job.revision+1,receipt:input.receipt,next:0},job.revision,current);
    return reply(saved?'completed':'unavailable');
   }catch{return reply('rejected');}finally{requests--;}
  },
  async enqueue(descriptor:AttachmentDescriptor,direction:AttachmentJob['direction']){
   const owner=d.owner(),epoch=generation;if(!owner||stopped||!validAttachmentDescriptor(descriptor))throw Error('Invalid attachment');
   const manifest=descriptor.manifest,record=await d.record(manifest.sender),current=()=>!stopped&&generation===epoch&&d.owner()===owner;
   if(!current()||!record||!verifyAttachmentManifest(manifest,record,d.now())||owner!==(direction==='outgoing'?manifest.sender:manifest.recipient)
    ||(direction==='incoming'?manifest.recipientDevice:manifest.senderDevice)!==d.device())throw Error('Attachment identity mismatch');
   const job:AttachmentJob={version:1,owner,digest:attachmentDigest(manifest),descriptor:JSON.parse(JSON.stringify(descriptor)),direction,revision:0,phase:'queued',cursor:0,relay:null,next:0,failures:0,receipt:null,custodians:[],acknowledged:[]};
   const existing=await d.store.get(owner,job.digest);
   if(existing){if(attachmentDescriptorFingerprint(existing.descriptor)!==attachmentDescriptorFingerprint(job.descriptor)||existing.direction!==direction)throw Error('Attachment ID conflict');return existing;}
   if(!await d.store.save(job,null,current))throw Error('Attachment could not be saved');return job;
  },
  async tick(){
   const owner=d.owner(),epoch=generation;if(!owner||busy||stopped)return;busy=true;
   try{await d.store.retire?.(owner,()=>!stopped&&generation===epoch&&d.owner()===owner);const jobs=await d.store.list(owner);if(!jobs.every(validAttachmentJob))throw Error('Invalid own attachment jobs');
    const pending=jobs.filter(j=>!terminal(j.phase)&&j.next<=d.now());if(pending.length)await run(pending[cursor++%pending.length],epoch);
   }finally{busy=false;}
  },
  async cancel(digest:string){const owner=d.owner();if(!owner||stopped)throw Error('Unlock your account first');generation++;const epoch=generation;const job=await d.store.get(owner,digest);
   if(!job||terminal(job.phase)||job.receipt)throw Error('This transfer is already stopped or received');
   if(!await d.store.save({...job,revision:job.revision+1,phase:'cancelled'},job.revision,()=>!stopped&&generation===epoch&&d.owner()===owner))throw Error('Transfer changed. Try again');
  },
  async retry(digest:string){const owner=d.owner();if(!owner||stopped)throw Error('Unlock your account first');generation++;const epoch=generation;const job=await d.store.get(owner,digest);
   if(!job||job.phase==='complete')throw Error('Transfer is already complete');
   if(job.descriptor.manifest.expires<=d.now())throw Error('This attachment expired. Ask the sender to send it again');
   const peer=job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient;
   if(!d.allowed(peer))throw Error('Accept or unblock this identity first');
   unavailable.clear();directWaiting.clear();
   if(!await d.store.save({...job,revision:job.revision+1,phase:job.receipt?'confirming':job.direction==='outgoing'?'queued':'downloading',cursor:job.direction==='outgoing'?0:job.cursor,relay:null,next:0,failures:0},job.revision,()=>!stopped&&generation===epoch&&d.owner()===owner&&d.allowed(peer)))throw Error('Transfer changed. Try again');
  },
  invalidate(){generation++;unavailable.clear();directWaiting.clear();},stop(){stopped=true;generation++;unavailable.clear();directWaiting.clear();},
 };
}
