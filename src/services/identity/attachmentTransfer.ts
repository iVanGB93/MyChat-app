import {createOrderedReadAhead} from './orderedReadAhead';
import {hexToBytes} from '@noble/hashes/utils.js';
import {attachmentDigest,validAttachmentManifest,verifyAttachmentManifest,verifyAttachmentChunk,decryptAttachmentChunk,
 verifyAttachmentReceipt,ATTACHMENT_CHUNK_BYTES,type AttachmentManifest,type AttachmentChunk,type AttachmentReceipt,type AttachmentLeafHash} from './attachmentProtocol.ts';
import {validAccountId,type IdentityRecord} from './identityProtocol.ts';
import type {IdentityPeer} from './identityClient.ts';
import {ATTACHMENT_BATCH_CHUNKS,ATTACHMENT_BULK_FRAME_BYTES,validAttachmentRange,packAttachmentBatch,unpackAttachmentBatch} from './attachmentBatch.ts';

/** Private chat metadata. Never send this descriptor to a custodian outside encrypted chat. */
export interface AttachmentDescriptor {manifest:AttachmentManifest;key:string;checksum:string;name:string;mime:string;caption?:string}
export class AttachmentFileReset extends Error {}
export const attachmentDescriptorFingerprint=(d:AttachmentDescriptor)=>JSON.stringify([attachmentDigest(d.manifest),d.key,d.checksum,d.name,d.mime,...(d.caption!==undefined?[d.caption]:[])]);
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
 /** Optional indexed check of an already validated job. Every committed mutation must advance revision. */
 isCurrent?(owner:string,digest:string,revision:number):Promise<boolean>;
 /** expected=null creates. Commit atomically only when revision and current() still match. */
 save(job:AttachmentJob,expected:number|null,current:()=>boolean):Promise<boolean>;
}
const terminal=(phase:AttachmentPhase)=>['complete','expired','cancelled'].includes(phase);
const total=(job:AttachmentJob)=>Math.ceil(job.descriptor.manifest.bytes/ATTACHMENT_CHUNK_BYTES);
export function validAttachmentDescriptor(value:unknown):value is AttachmentDescriptor {
 const d=value as AttachmentDescriptor;
 return !!d&&(Object.keys(d).sort().join(',')==='checksum,key,manifest,mime,name'||Object.keys(d).sort().join(',')==='caption,checksum,key,manifest,mime,name'&&typeof d.caption==='string'&&new TextEncoder().encode(d.caption).length<=1600)&&validAttachmentManifest(d.manifest,d.manifest?.expires-1)&&Object.keys(d.manifest).length===11&&typeof d.key==='string'&&/^[a-f0-9]{64}$/.test(d.key)
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
 hashLeaf?:AttachmentLeafHash;
 /** Bounded read-ahead; wire format and durable per-chunk checkpoints stay unchanged. */
 downloadWindow?:number;
 uploadWindow?:number;
 record(account:string):Promise<IdentityRecord|null>;peers():string[];allowed(peer:string):boolean;allowedJob?(job:AttachmentJob):boolean;
 request(peer:string,raw:string):Promise<string|null>;
  bulkPeers?():string[];
  batchChunks?(peer:string):number;
  batchWindow?(peer:string):number;
 bulkRequest?(peer:string,raw:string):Promise<string|null>;
 readChunk(job:AttachmentJob,index:number):Promise<AttachmentChunk>;
 /** Persist exact bytes at index; repeating a chunk must be idempotent. Never use the remote name as a path. */
 writeChunk(job:AttachmentJob,index:number,plain:Uint8Array,current:()=>boolean):Promise<void>;
 /** Read back the complete durable file, verify its size and descriptor.checksum, then publish it atomically. */
 commitFile(job:AttachmentJob,current:()=>boolean):Promise<void>;
 signReceipt(manifest:AttachmentManifest):Promise<AttachmentReceipt>;
 /** Idempotently update the own-chat row; called only for a verified complete file/recipient receipt. */
 stored?(job:AttachmentJob,current:()=>boolean):Promise<void>;
 completed(job:AttachmentJob,current:()=>boolean):Promise<void>;
}){
 const downloadWindow=d.downloadWindow??1,uploadWindow=d.uploadWindow??1;
 if(!Number.isSafeInteger(uploadWindow)||uploadWindow<1||uploadWindow>4)throw Error('Invalid attachment upload window');
 if(!Number.isSafeInteger(downloadWindow)||downloadWindow<1||downloadWindow>4)throw Error('Invalid attachment download window');
 let stopped=false,busy=false,generation=0,cursor=0,requests=0,bulkRequests=0;
 const unavailable=new Map<string,number>();
 const directWaiting=new Map<string,number>();
 const published=new Set<string>();
 async function publish(job:AttachmentJob,current:()=>boolean){
  const key=job.owner+':'+job.direction+':'+job.digest;
  if(published.has(key))return;
  await d.completed(job,current);
  if(current()){if(published.size>=128)published.clear();published.add(key);}
 }

 async function request(peer:string,operation:string,job:AttachmentJob,extra:object={}){
  const raw=await d.request(peer,JSON.stringify({version:1,operation,digest:job.digest,...extra}));
  if(!raw||raw.length>14000)throw Error('Attachment route unavailable');return JSON.parse(raw);
 }
 async function run(initial:AttachmentJob,epoch:number){
  let job=initial;const manifest=job.descriptor.manifest;
  const other=job.direction==='outgoing'?manifest.recipient:manifest.sender;
  const current=()=>!stopped&&generation===epoch&&d.owner()===job.owner&&d.allowed(other)&&(d.allowedJob?.(job)??true);
  async function live(){
   if(!current())return false;
   if(d.store.isCurrent)return await d.store.isCurrent(job.owner,job.digest,job.revision)&&current();
   const saved=await d.store.get(job.owner,job.digest);return current()&&saved?.revision===job.revision&&!terminal(saved.phase);
  }
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
    await publish(job,current);if(await live())await save({phase:'complete',next:0});return;
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
    await publish(job,current);if(!await live())return;
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
     const start=job.cursor,count=Math.min(uploadWindow,total(job)-start);
     const results=await Promise.allSettled(Array.from({length:count},async(_,offset)=>{
      const index=start+offset,chunk=await d.readChunk(job,index);
      if(!await live())throw Error('Attachment job changed');
      if(chunk.index!==index||!verifyAttachmentChunk(manifest,chunk,d.hashLeaf))throw Error('Own attachment chunk invalid');
      return request(relay,'put',job,{chunk});
     }));
     let next=start,completed=false;
     try{for(const result of results){
      if(!await live())return;
      if(result.status==='rejected')throw result.reason;
      if(!['held','completed'].includes(result.value.status))throw Error('Attachment chunk refused');
      completed ||= result.value.status==='completed';next++;
     }}finally{
      if(next>start&&await live()){
       if(next===total(job)&&!completed){await d.stored?.(job,current);if(!await live())return;}
       await save({cursor:next,phase:completed||next===total(job)?'confirming':'uploading',failures:0,next:0});
      }
     }
     return;
    }
    const r=await request(relay,'status',job);if(!await live())return;
    if(r.status==='held'){if(job.cursor===total(job))await d.stored?.(job,current);if(!await live())return;await save({next:d.now()+2000});return;}
    const recipient=await d.record(manifest.recipient);
    if(r.status!=='completed'||!recipient||!verifyAttachmentReceipt(r.receipt,manifest,recipient,d.now()))throw Error('No verified attachment receipt');
    if(!await live())return;
    await publish({...job,receipt:r.receipt},current);if(!await live())return;
    await save({receipt:r.receipt,phase:'complete',next:0,failures:0});return;
   }
   if(job.cursor<total(job)){
    // Fetch a bounded window concurrently, but commit only a verified contiguous prefix.
    // Wait for every request to settle before returning so retries cannot accumulate in-flight reads.
    const start=job.cursor,bulk=relay===manifest.sender&&!!d.bulkRequest&&d.bulkPeers?.().includes(relay);
    const negotiated=bulk?(d.batchChunks?.(relay)??ATTACHMENT_BATCH_CHUNKS):downloadWindow;
    if(!Number.isSafeInteger(negotiated)||negotiated<1||negotiated>ATTACHMENT_BATCH_CHUNKS)throw Error('Invalid negotiated batch size');
    const window=bulk&&negotiated<=3?(d.batchWindow?.(relay)??2):1;
    if(!Number.isSafeInteger(window)||window<1||window>4)throw Error('Invalid negotiated batch window');
    const pipeline=bulk&&negotiated<=3;
    // At most four windows per turn; keep the negotiated request count in flight.
    const count=Math.min(window*negotiated*(pipeline?4:1),total(job)-start);
    let results:PromiseSettledResult<any>[]=[];
    const reads=bulk?createOrderedReadAhead(Math.ceil(count/negotiated),window,async batch=>{
      if(!current()||manifest.expires<=d.now())throw Error('Attachment unavailable');
      const index=start+batch*negotiated,length=Math.min(negotiated,count-batch*negotiated);
      const raw=await d.bulkRequest!(relay,JSON.stringify({version:1,operation:'direct-get-batch',digest:job.digest,index,count:length}));
      if(!raw||raw.length>ATTACHMENT_BULK_FRAME_BYTES-1024)throw Error('Attachment batch unavailable');
      const response=JSON.parse(raw);if(response.status!=='ok'||response.index!==index||response.count!==length)throw Error('Attachment batch unavailable');
      return unpackAttachmentBatch(manifest,index,length,response.data).map(chunk=>({status:'ok',chunk,custodians:response.custodians}));
    }):null;
    if(!bulk)results=await Promise.allSettled(Array.from({length:count},(_,offset)=>
     request(relay,relay===manifest.sender?'direct-get':'get',job,{index:start+offset})));
    let verifiedCursor=start,custodians=job.custodians;
    try{for(let offset=0;offset<count;offset++){
     if(!await live())return;
     if(manifest.expires<=d.now())throw Error('Attachment expired');
     const index=start+offset;let r:any;
     if(reads){const batch=await reads.get(Math.floor(offset/negotiated));if(batch.status==='rejected')throw batch.reason;r=batch.value[offset%negotiated];}
     else {const result=results[offset];if(result.status==='rejected')throw result.reason;r=result.value;}
     // decryptAttachmentChunk verifies the complete Merkle proof before decrypting.
     // Keep the requested-index check here; do not hash the same proof twice.
     if(r.status!=='ok'||!r.chunk||r.chunk.index!==index)throw Error('Attachment chunk unavailable');
     const key=hexToBytes(job.descriptor.key);let plain:Uint8Array|undefined;
     try{plain=decryptAttachmentChunk(manifest,r.chunk,key,d.hashLeaf);if(!await live())return;await d.writeChunk(job,index,plain,current);}
     finally{key.fill(0);plain?.fill(0);}
     if(!await live())return;
     const prior=relay===manifest.sender&&Array.isArray(r.custodians)?r.custodians.filter((p:unknown)=>validAccountId(p)&&p!==job.owner).slice(0,9):[];
     custodians=[...new Set<string>([...custodians,relay,...prior])];if(custodians.length>10)throw Error('Too many attachment sources');
     verifiedCursor=index+1;
     if(bulk&&(offset+1)%16===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }}finally{
     // Files are written at fixed offsets. A crash before this checkpoint safely
     // replays at most one bounded burst; a failed chunk preserves its verified prefix.
     await reads?.stop();
     if(verifiedCursor>start&&await live())await save({cursor:verifiedCursor,custodians,next:0,failures:0});
    }
    // Finish a fully written file in this turn instead of waiting for another
    // scheduler pass. Partial windows still yield to the other transfer jobs.
    if(job.cursor<total(job)||!await live())return;
   }
   if(!job.receipt){
    await d.commitFile(job,current);if(!await live())return;
    const receipt=await d.signReceipt(manifest),recipient=await d.record(manifest.recipient);
    if(!recipient||!verifyAttachmentReceipt(receipt,manifest,recipient,d.now())||!await live())return;
    await save({receipt,phase:'confirming'});
    // Persist the verified receipt before publishing. Remote receipt cleanup
    // remains resumable and does not delay showing the locally verified file.
    if(await live())await publish(job,current);
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
   if(!['direct-status','direct-get','direct-get-batch','direct-receipt'].includes(input?.operation))return null;
   const bulk=input.operation==='direct-get-batch';if(bulk&&bulkRequests>=4)return JSON.stringify({status:'unavailable'});
   const reply=(status:string,extra:object={})=>JSON.stringify({status,...extra});
   let admittedJob:AttachmentJob|null=null;
   const owner=d.owner(),epoch=generation,current=()=>!stopped&&generation===epoch&&d.owner()===owner&&d.allowed(peer.account)&&peer.expiresAt>d.now()&&(!admittedJob||(d.allowedJob?.(admittedJob)??true));
   if(!owner||requests>=8||input.version!==1||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||!current())return reply('rejected');requests++;if(bulk)bulkRequests++;
   try{
    const job=await d.store.get(owner,input.digest);if(!job||!current()||!(d.allowedJob?.(job)??true)||['cancelled','expired'].includes(job.phase))return reply('unavailable');
    admittedJob=job;
    const m=job.descriptor.manifest,sender=await d.record(m.sender),recipient=await d.record(m.recipient);
    if(!sender||!recipient||!verifyAttachmentManifest(m,sender,d.now())||!current())return reply('rejected');
    if(input.operation==='direct-status')return job.direction==='incoming'&&peer.account===m.sender&&peer.device===m.senderDevice&&d.device()===m.recipientDevice&&job.failures===0?reply('ready'):reply('unavailable');
    if(job.direction!=='outgoing'||peer.account!==m.recipient||peer.device!==m.recipientDevice||d.device()!==m.senderDevice)return reply('rejected');
    if(bulk){
     if(!validAttachmentRange(m,input.index,input.count))return reply('rejected');
     const chunks:AttachmentChunk[]=[];
     for(let offset=0;offset<input.count;offset++){
      if(!current()||m.expires<=d.now())return reply('unavailable');
      chunks.push(await d.readChunk(job,input.index+offset));
      if((offset+1)%16===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
     }
     const saved=await d.store.get(owner,input.digest);
     // Outgoing polling may advance revision while we read. Only cancellation,
     // expiry or changed content invalidates these immutable encrypted bytes.
     if(!current()||!saved||attachmentDescriptorFingerprint(saved.descriptor)!==attachmentDescriptorFingerprint(job.descriptor)||['cancelled','expired'].includes(saved.phase)||m.expires<=d.now())return reply('unavailable');
     const latestSender=await d.record(m.sender);if(!latestSender||!verifyAttachmentManifest(m,latestSender,d.now())||!current())return reply('unavailable');
     const data=packAttachmentBatch(m,input.index,chunks,d.hashLeaf);
     return current()&&m.expires>d.now()?reply('ok',{index:input.index,count:input.count,data,custodians:saved.custodians.slice(0,9)}):reply('unavailable');
    }
    if(input.operation==='direct-get'){
     if(!Number.isSafeInteger(input.index)||input.index<0||input.index>=total(job))return reply('rejected');
     const chunk=await d.readChunk(job,input.index);return current()&&chunk.index===input.index&&verifyAttachmentChunk(m,chunk,d.hashLeaf)?reply('ok',{chunk,custodians:job.custodians.slice(0,9)}):reply('rejected');
    }
    if(!verifyAttachmentReceipt(input.receipt,m,recipient,d.now())||!current())return reply('rejected');
    // Outgoing polling may checkpoint while the receipt is being verified.
    // Retry that local race before making the receiver back off its network route.
    let latest=job;
    const fingerprint=attachmentDescriptorFingerprint(job.descriptor);
    for(let attempt=0;attempt<3;attempt++){
     admittedJob=latest;
     if(!current()||m.expires<=d.now()||latest.direction!=='outgoing'||['cancelled','expired'].includes(latest.phase)
      ||attachmentDescriptorFingerprint(latest.descriptor)!==fingerprint)return reply('unavailable');
     if(latest.receipt)return reply('completed');
     if(await d.store.save({...latest,revision:latest.revision+1,receipt:input.receipt,next:0},latest.revision,current))return reply('completed');
     const refreshed=await d.store.get(owner,input.digest);if(!refreshed)return reply('unavailable');latest=refreshed;
    }
    return reply('unavailable');
   }catch{return reply('rejected');}finally{requests--;if(bulk)bulkRequests--;}
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
  async tick(options:{maxSteps?:number;maxMilliseconds?:number}={}){
   const steps=options.maxSteps??1,milliseconds=options.maxMilliseconds??50;
   if(!Number.isSafeInteger(steps)||steps<1||steps>32||!Number.isFinite(milliseconds)||milliseconds<1||milliseconds>100)throw Error('Invalid attachment work budget');
   const owner=d.owner(),epoch=generation;if(!owner||busy||stopped)return false;busy=true;
   const active=()=>!stopped&&generation===epoch&&d.owner()===owner;
   let progressed=false;const started=Date.now(),idle=new Set<string>();
   try{await d.store.retire?.(owner,active);
    // Re-read durable checkpoints between steps; never race pause, lock or receipt updates.
    // Rotate jobs within a bounded burst so a large file cannot monopolize the worker.
    for(let step=0;step<steps&&active();step++){
     const jobs=await d.store.list(owner);if(!jobs.every(validAttachmentJob))throw Error('Invalid own attachment jobs');
     const pending=jobs.filter(j=>!terminal(j.phase)&&j.next<=d.now()&&!idle.has(j.digest));if(!pending.length)break;
     const job=pending[cursor++%pending.length];await run(job,epoch);if(!active())break;
     const saved=await d.store.get(owner,job.digest);
     if(!saved||saved.revision===job.revision)idle.add(job.digest);
     else if(saved.failures===0&&(saved.cursor>job.cursor||saved.phase!==job.phase))progressed=true;
     if(Date.now()-started>=milliseconds)break;
    }
    return active()&&progressed;
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
  invalidate(){generation++;unavailable.clear();directWaiting.clear();published.clear();},stop(){stopped=true;generation++;unavailable.clear();directWaiting.clear();published.clear();},
 };
}
