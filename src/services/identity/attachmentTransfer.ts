import type {AttachmentDescriptor,AttachmentPhase,AttachmentJob} from './attachmentTypes.ts';
export type {AttachmentDescriptor,AttachmentPhase,AttachmentJob} from './attachmentTypes.ts';
import type {AttachmentTransferStorage,AttachmentTransferConnections} from './attachmentTransferPorts.ts';
export type {AttachmentJobStore} from './attachmentTransferPorts.ts';
import {deliveryEvidence,validDeliveryEvidence,type DeliveryEvidence} from './deliveryEvidence.ts';
import {createOrderedReadAhead} from './orderedReadAhead.ts';
import {createAttachmentWorkSelection,createAttachmentReadinessProbe} from './attachmentSchedule.ts';
import {attachmentRouteSnapshot,attachmentRouteCandidates,attachmentRouteNeedsSelection,selectAttachmentCustodian,
 selectAttachmentReceiptPeer,attachmentStreamEligible,attachmentBlockRoute} from './attachmentRouteSelection.ts';
import type {AttachmentEncoding} from './attachmentEncoding.ts';
import {hexToBytes} from '@noble/hashes/utils.js';
import {attachmentContentDigest,attachmentDigest,attachmentChecksumCommitment,validAttachmentManifest,verifyAttachmentManifest,decryptAttachmentChunkAsync,type AttachmentBlockDecrypt,
 verifyAttachmentReceipt,attachmentBlockBytes,type AttachmentManifest,type AttachmentChunk,type AttachmentReceipt,type AttachmentLeafHash} from './attachmentProtocol.ts';
import {validAccountId,type IdentityRecord} from './identityProtocol.ts';
import type {IdentityPeer} from './identityClient.ts';
import {ATTACHMENT_BATCH_CHUNKS,ATTACHMENT_STREAM_FRAME_BYTES,validAttachmentRange,packAttachmentBatch,unpackAttachmentBatch} from './attachmentBatch.ts';

export class AttachmentFileReset extends Error {}
/** A route or authenticated source is temporarily not ready, not invalid data. */
class AttachmentSourceUnavailable extends Error {}
export const attachmentDescriptorFingerprint=(d:AttachmentDescriptor)=>JSON.stringify([attachmentDigest(d.manifest),d.key,d.checksum,d.name,d.mime,...(d.caption!==undefined?[d.caption]:[])]);
const terminal=(phase:AttachmentPhase)=>['complete','expired','cancelled'].includes(phase);
const total=(job:AttachmentJob)=>Math.ceil(job.descriptor.manifest.bytes/attachmentBlockBytes(job.descriptor.manifest));
export function validAttachmentDescriptor(value:unknown):value is AttachmentDescriptor {
 const d=value as AttachmentDescriptor;
 return !!d&&(Object.keys(d).sort().join(',')==='checksum,key,manifest,mime,name'||Object.keys(d).sort().join(',')==='caption,checksum,key,manifest,mime,name'&&typeof d.caption==='string'&&new TextEncoder().encode(d.caption).length<=1600)&&validAttachmentManifest(d.manifest,d.manifest?.expires-1)&&Object.keys(d.manifest).length===(!!d.manifest.shared?13:12)&&typeof d.key==='string'&&/^[a-f0-9]{64}$/.test(d.key)
  &&typeof d.checksum==='string'&&/^[a-f0-9]{64}$/.test(d.checksum)&&attachmentChecksumCommitment(d.checksum,d.key)===d.manifest.checksum&&typeof d.name==='string'&&d.name.length>0&&d.name.length<=120
  &&!/[\x00-\x1f\x7f/\\]/.test(d.name)&&typeof d.mime==='string'&&d.mime.length<=100&&/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(d.mime);
}
export function validAttachmentJob(job:unknown):job is AttachmentJob {
 const j=job as AttachmentJob;if(!j||j.version!==1||!validAttachmentDescriptor(j.descriptor)||!validAccountId(j.owner)
  ||!['incoming','outgoing'].includes(j.direction)||j.digest!==attachmentDigest(j.descriptor.manifest)
  ||j.owner!==(j.direction==='outgoing'?j.descriptor.manifest.sender:j.descriptor.manifest.recipient)
  ||!Number.isSafeInteger(j.revision)||j.revision<0||!Number.isSafeInteger(j.cursor)||j.cursor<0||j.cursor>total(j)
  ||!['queued','uploading','downloading','confirming','complete','expired','cancelled'].includes(j.phase)
  ||!Number.isSafeInteger(j.next)||j.next<0||!Number.isSafeInteger(j.failures)||j.failures<0||j.failures>32
  ||j.receivedSources!==undefined&&(!Array.isArray(j.receivedSources)||j.receivedSources.length>10||j.receivedSources.some(p=>!validAccountId(p))||new Set(j.receivedSources).size!==j.receivedSources.length)
  ||j.sourceCoverage!==undefined&&typeof j.sourceCoverage!=='boolean'
  ||j.delivery!==undefined&&!validDeliveryEvidence(j.delivery)
  ||j.relay!==null&&!validAccountId(j.relay)
  ||!Array.isArray(j.custodians)||j.custodians.length>10||j.custodians.some(p=>!validAccountId(p))||new Set(j.custodians).size!==j.custodians.length
  ||!Array.isArray(j.acknowledged)||j.acknowledged.some(p=>!j.custodians.includes(p))||new Set(j.acknowledged).size!==j.acknowledged.length)return false;
 return j.receipt===null||!!j.receipt&&j.receipt.version===1&&j.receipt.id===j.descriptor.manifest.id&&j.receipt.digest===j.digest
  &&j.receipt.recipient===j.descriptor.manifest.recipient&&j.receipt.device===j.descriptor.manifest.recipientDevice
  &&j.receipt.expires===j.descriptor.manifest.expires&&/^[a-f0-9]{128}$/.test(j.receipt.signature);
}
/** Durable resumable jobs. Platform adapters own file I/O; no Django IDs, URLs or access tokens. */
export function createAttachmentTransfer(d:{
 owner():string|null;device():string|null;now():number;
 storage:AttachmentTransferStorage;connections:AttachmentTransferConnections;
 hashLeaf?:AttachmentLeafHash;encoding?:AttachmentEncoding;decryptBlock?:AttachmentBlockDecrypt;
 measureProcessing?<T>(stage:'decodeBlock'|'verifyDecryptBlock',work:()=>T):T;
 downloadWindow?:number;uploadWindow?:number;
 record(account:string):Promise<IdentityRecord|null>;
 allowed(peer:string):boolean;allowedJob?(job:AttachmentJob):boolean;
 signReceipt(manifest:AttachmentManifest):Promise<AttachmentReceipt>;
 stored?(job:AttachmentJob,current:()=>boolean):Promise<void>;
 completed(job:AttachmentJob,current:()=>boolean):Promise<void>;
}){
 const processing=d.measureProcessing??((_stage,work)=>work());
 const downloadWindow=d.downloadWindow??1,uploadWindow=d.uploadWindow??1;
 if(!Number.isSafeInteger(uploadWindow)||uploadWindow<1||uploadWindow>4)throw Error('Invalid attachment upload window');
 if(!Number.isSafeInteger(downloadWindow)||downloadWindow<1||downloadWindow>4)throw Error('Invalid attachment download window');
 let stopped=false,busy=false,generation=0,requests=0,bulkRequests=0;
 const selectWork=createAttachmentWorkSelection(),readiness=createAttachmentReadinessProbe();
 const unavailable=new Map<string,number>();
 const directWaiting=new Map<string,number>();
 const streamRetry=new Map<string,number>();
 const published=new Set<string>();
 const storedPublished=new Set<string>();
 const routes=()=>attachmentRouteSnapshot(d.connections,!!d.connections.directStream);
 // The worker owns retry clocks; selection receives only this job's observations.
 const routeCooldowns=(job:AttachmentJob,peers:readonly string[])=>new Map(peers.map(peer=>[peer,unavailable.get(job.digest+':'+peer)??0]));
 async function publish(job:AttachmentJob,current:()=>boolean){
  const key=job.owner+':'+job.direction+':'+job.digest;
  if(published.has(key))return;
  await d.completed(job,current);
  if(current()){if(published.size>=128)published.clear();published.add(key);}
 }

 // Custody publication is durable and idempotent. Polling a held file must not
 // reread the whole chat ledger on every receipt check. Failed callbacks and
 // lifecycle changes never populate this bounded, process-local memo.
 async function publishStored(job:AttachmentJob,current:()=>boolean){
  const key=generation+':'+job.owner+':'+job.digest;
  if(storedPublished.has(key))return;
  await d.stored?.(job,current);
  if(current()){if(storedPublished.size>=128)storedPublished.clear();storedPublished.add(key);}
 }

 async function request(peer:string,operation:string,job:AttachmentJob,extra:object={}){
  const raw=await d.connections.request(peer,JSON.stringify({version:1,operation,digest:job.digest,...extra}));
  if(!raw)throw new AttachmentSourceUnavailable('Attachment route unavailable');
  if(raw.length>14000)throw Error('Invalid attachment response');return JSON.parse(raw);
 }
 async function run(initial:AttachmentJob,epoch:number){
  let job=initial;const manifest=job.descriptor.manifest;
  const other=job.direction==='outgoing'?manifest.recipient:manifest.sender;
  const current=()=>!stopped&&generation===epoch&&d.owner()===job.owner&&d.allowed(other)&&(d.allowedJob?.(job)??true);
  async function live(){
   if(!current())return false;
   if(d.storage.jobs.isCurrent)return await d.storage.jobs.isCurrent(job.owner,job.digest,job.revision)&&current();
   const saved=await d.storage.jobs.get(job.owner,job.digest);return current()&&saved?.revision===job.revision&&!terminal(saved.phase);
  }
  async function save(patch:Partial<AttachmentJob>){
   const next={...job,...patch,revision:job.revision+1};if(!current()||!await d.storage.jobs.save(next,job.revision,current))throw Error('Attachment job changed');job=next;
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
   if(job.direction==='outgoing'&&job.phase==='queued'&&!job.custodians.length&&d.connections.peers().includes(peer)){
    // A ready recipient pulls over authenticated DTLS, or encrypted blocks if
    // that stream is unavailable. The status response itself grants no access.
    // Only defer the first custody offer: after custody starts, a stale direct
    // peer must not impose another request timeout before every relay block.
    // A newly connected recipient can still pull the stream independently.
    const response=await readiness.read(peer,()=>request(peer,'direct-status',job));
    if(!await live())return;
    if(response?.status==='ready'){await save({next:d.now()+2000});return;}
    // Give the encrypted descriptor time to reach a connected recipient before creating custody.
    if(response&&!job.custodians.length&&job.cursor===0){
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
    const connected=d.connections.peers();
    const relay=selectAttachmentReceiptPeer(pending,connected,d.now(),routeCooldowns(job,connected));if(!relay)return;
    if(job.relay!==relay)await save({relay});
    const r=await request(relay,relay===manifest.sender?'direct-receipt':'receipt',job,{receipt:job.receipt});if(!await live())return;
    if(r.status!=='completed')throw Error('Attachment receipt not accepted');
    const acknowledged=[...job.acknowledged,relay];await save({acknowledged,phase:acknowledged.length===job.custodians.length?'complete':'confirming',next:0,failures:0});return;
   }
   // Selection uses one current observation. Retry deadlines and durable route
   // transitions remain worker-owned; adapters still bind the exact device.
   const observation=routes();
   const peers=attachmentRouteCandidates(job,observation,d.now(),routeCooldowns(job,observation.peers),streamRetry.get(job.digest)??0);
   if(attachmentRouteNeedsSelection(job,peers)){
    if(!peers.length)return;
    let selected=peers[0];
    if(job.direction==='outgoing'&&!!manifest.shared){
     // All grants for the same encrypted media prefer one custodian. The relay's
     // shared-prefix check then skips bytes already uploaded by a sibling job.
     const content=attachmentContentDigest(manifest),siblings=(await d.storage.jobs.list(job.owner)).filter(v=>v.direction==='outgoing'&&!!v.descriptor.manifest.shared&&attachmentContentDigest(v.descriptor.manifest)===content);
     if(!await live())return;
     selected=selectAttachmentCustodian(peers,siblings.map(v=>({recipient:v.descriptor.manifest.recipient,relay:v.relay})))!;
    }

    await save({relay:selected,phase:job.direction==='outgoing'?'queued':job.receipt?'confirming':'downloading',cursor:job.direction==='outgoing'?0:job.cursor});
   }
   const relay=job.relay!;
   if(job.direction==='outgoing'){
    if(job.phase==='queued'){
     const r=await request(relay,'offer',job,{manifest});if(!await live())return;
     if(!['held','completed'].includes(r.status))throw Error('Attachment custodian refused');
     const custodians=job.custodians.includes(relay)?job.custodians:[...job.custodians,relay];
     if(custodians.length>9)throw Error('Too many attachment custodians');
     const received=Number.isSafeInteger(r.received)&&r.received>=0&&r.received<=total(job)?r.received:0;
     if(received===total(job)&&r.status==='held')await publishStored(job,current);
     await save({phase:r.status==='completed'||received===total(job)?'confirming':'uploading',cursor:received,custodians,failures:0,next:0});return;
    }
    if(job.phase==='uploading'&&job.cursor<total(job)){
     // Another recipient's job may already have uploaded this shared prefix.
     if(!!manifest.shared){const held=await request(relay,'status',job);if(!await live())return;
      if(held.status==='held'&&Number.isSafeInteger(held.received)&&held.received>job.cursor&&held.received<=total(job)){
       if(held.received===total(job))await publishStored(job,current);
       await save({cursor:held.received,phase:held.received===total(job)?'confirming':'uploading',next:0,failures:0});return;
      }
     }
     if(d.connections.bulkRequest&&attachmentBlockRoute(routes(),relay,'outgoing')){
      const start=job.cursor,negotiated=1;
      if(!Number.isSafeInteger(negotiated)||negotiated<1||negotiated>ATTACHMENT_BATCH_CHUNKS)throw Error('Invalid upload batch size');
      const count=Math.min(negotiated,total(job)-start),chunks:AttachmentChunk[]=d.storage.files.readChunks?await d.storage.files.readChunks(job,start,count):[];
      for(let n=0;!d.storage.files.readChunks&&n<count;n++){
       if(!await live()||manifest.expires<=d.now())return;
       chunks.push(await d.storage.files.readChunk(job,start+n));
       if((n+1)%16===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      if(chunks.length!==count)throw Error('Incomplete upload batch');
      const data=packAttachmentBatch(manifest,start,chunks,d.hashLeaf,d.encoding);
      if(!await live()||manifest.expires<=d.now())return;
      const raw=await d.connections.bulkRequest(relay,JSON.stringify({version:1,operation:'put-batch',digest:job.digest,index:start,count,data}));
      if(!await live())return;
      if(!raw)throw new AttachmentSourceUnavailable('Attachment upload batch unavailable');
      if(raw.length>14000)throw Error('Invalid upload batch response');const result=JSON.parse(raw);
      if(result.status==='completed'){await save({phase:'confirming',next:0,failures:0});return;}
      if(result.status!=='held'||result.index!==start||result.count!==count||!Number.isSafeInteger(result.received)||result.received<count||result.received>total(job))throw Error('Attachment upload batch refused');
      const next=start+count;
      if(next===total(job)){await publishStored(job,current);if(!await live())return;}
      await save({cursor:next,phase:next===total(job)?'confirming':'uploading',failures:0,next:0});return;
     }
     return; // No scalar upload fallback: wait for a capable block-stream peer.
    }
    const r=await request(relay,'status',job);if(!await live())return;
    if(r.status==='held'){if(job.cursor===total(job))await publishStored(job,current);if(!await live())return;await save({next:d.now()+2000});return;}
    const recipient=await d.record(manifest.recipient);
    if(r.status!=='completed'||!recipient||!verifyAttachmentReceipt(r.receipt,manifest,recipient,d.now()))throw Error('No verified attachment receipt');
    if(!await live())return;
    await save({receipt:r.receipt,delivery:deliveryEvidence('receipt',d.now(),relay),next:0,failures:0});
    await publish(job,current);if(!await live())return;
    await save({phase:'complete'});return;
   }
   if(d.connections.directStream&&attachmentStreamEligible(job,relay,true,d.now(),streamRetry.get(job.digest)??0)){
    // A sender can connect after custody download has begun. Stream into an
    // isolated temporary file; failure must preserve the verified chunk prefix.
    // A failed stream must not loop ahead of the reliable encrypted fallback.
    if(streamRetry.size>=128)streamRetry.clear();streamRetry.set(job.digest,d.now()+60000);
    let received:boolean|'unavailable'=false;
    try{received=await d.connections.directStream(job,async()=>manifest.expires>d.now()&&await live(),
     {digest:job.digest,bytes:manifest.bytes,checksum:job.descriptor.checksum});}catch{}
    // No stream was started. Keep chunk fallback moving, but do not suppress
    // a newly ready media lane for the failure cooldown.
    if(received==='unavailable')streamRetry.set(job.digest,d.now()+1000);
    if(!await live())return;
    if(received===true){
     const custodians=[...new Set([...job.custodians,relay])];
     if(custodians.length>10)throw Error('Too many attachment sources');
     // A crash here is safe: the normal final hash check runs again after restart.
     await save({cursor:total(job),custodians,receivedSources:[relay],sourceCoverage:true,next:0,failures:0});
    }
   }
   if(job.cursor<total(job)){
    // Fetch a bounded window concurrently, but commit only a verified contiguous prefix.
    // Wait for every request to settle before returning so retries cannot accumulate in-flight reads.
    if(!d.connections.bulkRequest||!attachmentBlockRoute(routes(),relay,'incoming'))return;
    const start=job.cursor,negotiated=1,window=Math.min(2,d.connections.batchWindow?.(relay)??2);
    if(!Number.isSafeInteger(window)||window<1)throw Error('Invalid block window');
    // At most two 3 MB ciphertext envelopes buffered; commit only verified blocks.
    const count=Math.min(window,total(job)-start);
    const reads=createOrderedReadAhead(Math.ceil(count/negotiated),window,async batch=>{
      if(!current()||manifest.expires<=d.now())throw Error('Attachment unavailable');
      const index=start+batch*negotiated,length=Math.min(negotiated,count-batch*negotiated);
      const raw=await d.connections.bulkRequest!(relay,JSON.stringify({version:1,operation:relay===manifest.sender?'direct-get-batch':'get-batch',digest:job.digest,index,count:length}));
      if(!raw)throw new AttachmentSourceUnavailable('Attachment batch route unavailable');
      if(raw.length>ATTACHMENT_STREAM_FRAME_BYTES-1024)throw Error('Invalid attachment batch');
      const response=JSON.parse(raw);
      if(response.status==='unavailable')throw new AttachmentSourceUnavailable('Attachment source not ready');
      if(response.status!=='ok'||response.index!==index||response.count!==length)throw Error('Attachment batch unavailable');
      return processing('decodeBlock',()=>unpackAttachmentBatch(manifest,index,length,response.data,d.encoding)).map(chunk=>({status:'ok',chunk,custodians:response.custodians}));
    });
    let verifiedCursor=start,custodians=job.custodians;
    const pendingPlain:Uint8Array[]=[];
    // A local write batch is independent of the wire protocol. Bound retained
    // plaintext to one 3 MB block and never checkpoint partially written batches.
    const writeCount=d.storage.files.writeChunks?Math.min(32,negotiated):1;
    const clearPlain=()=>{for(const plain of pendingPlain)plain.fill(0);pendingPlain.length=0;};
    try{for(let offset=0;offset<count;offset++){
     if(!await live())return;
     if(manifest.expires<=d.now())throw Error('Attachment expired');
     const index=start+offset;let r:any;
     const batch=await reads.get(offset);if(batch.status==='rejected')throw batch.reason;r=batch.value[0];
     // decryptAttachmentChunk verifies the sender-authorized block signature before decrypting.
     // Keep the requested-index check here; do not hash the same proof twice.
     if(r.status==='unavailable')throw new AttachmentSourceUnavailable('Attachment source not ready');
     if(r.status!=='ok'||!r.chunk||r.chunk.index!==index)throw Error('Attachment chunk unavailable');
     const key=hexToBytes(job.descriptor.key);let plain:Uint8Array|undefined;
     try{plain=await processing('verifyDecryptBlock',()=>decryptAttachmentChunkAsync(manifest,r.chunk,key,d.hashLeaf,d.encoding,d.decryptBlock));if(!await live())return;
      if(d.storage.files.writeChunks){pendingPlain.push(plain);plain=undefined;
       if(pendingPlain.length===writeCount||offset===count-1){
        await d.storage.files.writeChunks(job,verifiedCursor,pendingPlain,current);
        if(!await live())return;
        verifiedCursor=index+1;clearPlain();
       }
      }else await d.storage.files.writeChunk(job,index,plain,current);
     }
     finally{key.fill(0);plain?.fill(0);}
     if(!await live())return;
     const prior=relay===manifest.sender&&Array.isArray(r.custodians)?r.custodians.filter((p:unknown)=>validAccountId(p)&&p!==job.owner).slice(0,9):[];
     custodians=[...new Set<string>([...custodians,relay,...prior])];if(custodians.length>10)throw Error('Too many attachment sources');
     if(!d.storage.files.writeChunks)verifiedCursor=index+1;
     if((offset+1)%16===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }}finally{
     clearPlain();
     // Files are written at fixed offsets. A crash before this checkpoint safely
     // replays at most one bounded burst; a failed chunk preserves its verified prefix.
     await reads?.stop();
     if(verifiedCursor>start&&await live())await save({cursor:verifiedCursor,custodians,receivedSources:[...new Set([...(job.receivedSources??[]),relay])].slice(0,10),sourceCoverage:start===0||job.sourceCoverage===true,next:0,failures:0});
    }
    // Finish a fully written file in this turn instead of waiting for another
    // scheduler pass. Partial windows still yield to the other transfer jobs.
    if(job.cursor<total(job)||!await live())return;
   }
   if(!job.receipt){
    await d.storage.files.commitFile(job,current);if(!await live())return;
    const receipt=await d.signReceipt(manifest),recipient=await d.record(manifest.recipient);
    if(!recipient||!verifyAttachmentReceipt(receipt,manifest,recipient,d.now())||!await live())return;
    const sources=job.receivedSources??[],relays=sources.filter(p=>p!==manifest.sender);
    const delivery:DeliveryEvidence|undefined=sources.length?{version:1,scope:'payload',method:relays.length?(sources.includes(manifest.sender)?'mixed':'custody'):'peer',relays,at:d.now(),partial:job.sourceCoverage!==true}:undefined;
    await save({receipt,phase:'confirming',...(delivery?{delivery}:{})});
    // Persist the verified receipt before publishing. Remote receipt cleanup
    // remains resumable and does not delay showing the locally verified file.
    if(await live())await publish(job,current);
   }
  }catch(error){
   if(!await live())return;
   const failures=Math.min(32,job.failures+1);
   const delay=Math.min(30000,500*2**Math.min(failures,6));
   // A short readiness race must not silently add a ten-second peer ban.
   // Repeated unavailability still backs off; malformed data retains the ban.
   const cooldown=error instanceof AttachmentSourceUnavailable?delay:Math.max(10000,delay);
   if(job.relay){if(unavailable.size>=128)unavailable.clear();unavailable.set(job.digest+':'+job.relay,d.now()+cooldown);}
   await save({relay:null,phase:job.direction==='outgoing'?'queued':job.receipt?'confirming':'downloading',cursor:job.direction==='outgoing'||error instanceof AttachmentFileReset?0:job.cursor,...(error instanceof AttachmentFileReset?{receivedSources:[],sourceCoverage:true}:{}),failures,next:d.now()+delay}).catch(()=>{});
  }
 }
 return {
  /** Own-file requests are scoped to the authenticated intended endpoint, never arbitrary peers. */
  async receive(raw:string,peer:IdentityPeer):Promise<string|null>{
   let input;try{if(raw.length>13000)return null;input=JSON.parse(raw);}catch{return null;}
   if(!['direct-status','direct-get-batch','direct-receipt','direct-stream'].includes(input?.operation))return null;
   const bulk=input.operation==='direct-get-batch';if(bulk&&bulkRequests>=4)return JSON.stringify({status:'unavailable'});
   const reply=(status:string,extra:object={})=>JSON.stringify({status,...extra});
   let admittedJob:AttachmentJob|null=null;
   const owner=d.owner(),epoch=generation,current=()=>!stopped&&generation===epoch&&d.owner()===owner&&d.allowed(peer.account)&&peer.expiresAt>d.now()&&(!admittedJob||(d.allowedJob?.(admittedJob)??true));
   if(!owner||requests>=8||input.version!==1||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||!current())return reply('rejected');requests++;if(bulk)bulkRequests++;
   try{
    const job=await d.storage.jobs.get(owner,input.digest);if(!job||!current()||!(d.allowedJob?.(job)??true)||['cancelled','expired'].includes(job.phase))return reply('unavailable');
    admittedJob=job;
    const m=job.descriptor.manifest,sender=await d.record(m.sender),recipient=await d.record(m.recipient);
    if(!sender||!recipient||!verifyAttachmentManifest(m,sender,d.now())||!current())return reply('rejected');
    if(input.operation==='direct-status')return job.direction==='incoming'&&peer.account===m.sender&&peer.device===m.senderDevice&&d.device()===m.recipientDevice&&job.failures===0?reply('ready'):reply('unavailable');
    if(job.direction!=='outgoing'||peer.account!==m.recipient||peer.device!==m.recipientDevice||d.device()!==m.senderDevice)return reply('rejected');
    if(input.operation==='direct-stream'){
     const wss=input.transport==='wss-v1'&&typeof input.id==='string'&&/^[a-f0-9]{64}$/.test(input.id);
     if(Object.keys(input).sort().join(',')!==(wss?'digest,id,operation,transport,version':'digest,operation,version')||!d.connections.serveStream)return reply('unavailable');
     const fingerprint=attachmentDescriptorFingerprint(job.descriptor);
     const live=async()=>{
      if(!current()||m.expires<=d.now()||d.device()!==m.senderDevice)return false;
      const saved=await d.storage.jobs.get(owner,input.digest);
      return current()&&!!saved&&!['cancelled','expired'].includes(saved.phase)&&
       attachmentDescriptorFingerprint(saved.descriptor)===fingerprint&&(d.allowedJob?.(saved)??true);
     };
     return await live()&&await d.connections.serveStream(job,live,wss?input.id:undefined)?reply('streaming'):reply('unavailable');
    }
    if(bulk){
     if(!validAttachmentRange(m,input.index,input.count))return reply('rejected');
     const chunks:AttachmentChunk[]=d.storage.files.readChunks?await d.storage.files.readChunks(job,input.index,input.count):[];
     if(d.storage.files.readChunks&&chunks.length!==input.count)return reply('unavailable');
     for(let offset=0;!d.storage.files.readChunks&&offset<input.count;offset++){
      if(!current()||m.expires<=d.now())return reply('unavailable');
      chunks.push(await d.storage.files.readChunk(job,input.index+offset));
      if((offset+1)%16===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
     }
     const saved=await d.storage.jobs.get(owner,input.digest);
     // Outgoing polling may advance revision while we read. Only cancellation,
     // expiry or changed content invalidates these immutable encrypted bytes.
     if(!current()||!saved||attachmentDescriptorFingerprint(saved.descriptor)!==attachmentDescriptorFingerprint(job.descriptor)||['cancelled','expired'].includes(saved.phase)||m.expires<=d.now())return reply('unavailable');
     const latestSender=await d.record(m.sender);if(!latestSender||!verifyAttachmentManifest(m,latestSender,d.now())||!current())return reply('unavailable');
     const data=packAttachmentBatch(m,input.index,chunks,d.hashLeaf,d.encoding);
     return current()&&m.expires>d.now()?reply('ok',{index:input.index,count:input.count,data,custodians:saved.custodians.slice(0,9)}):reply('unavailable');
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
     if(await d.storage.jobs.save({...latest,revision:latest.revision+1,receipt:input.receipt,delivery:deliveryEvidence('receipt',d.now()),next:0},latest.revision,current))return reply('completed');
     const refreshed=await d.storage.jobs.get(owner,input.digest);if(!refreshed)return reply('unavailable');latest=refreshed;
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
   const existing=await d.storage.jobs.get(owner,job.digest);
   if(existing){if(attachmentDescriptorFingerprint(existing.descriptor)!==attachmentDescriptorFingerprint(job.descriptor)||existing.direction!==direction)throw Error('Attachment ID conflict');return existing;}
   if(!await d.storage.jobs.save(job,null,current))throw Error('Attachment could not be saved');return job;
  },
  async tick(options:{maxSteps?:number;maxMilliseconds?:number}={}){
   const steps=options.maxSteps??1,milliseconds=options.maxMilliseconds??50;
   if(!Number.isSafeInteger(steps)||steps<1||steps>32||!Number.isFinite(milliseconds)||milliseconds<1||milliseconds>100)throw Error('Invalid attachment work budget');
   const owner=d.owner(),epoch=generation;if(!owner||busy||stopped)return false;busy=true;
   const active=()=>!stopped&&generation===epoch&&d.owner()===owner;
   let progressed=false;const started=Date.now(),idle=new Set<string>();
   try{await d.storage.jobs.retire?.(owner,active);
    // Re-read durable checkpoints between steps; never race pause, lock or receipt updates.
    // Rotate jobs within a bounded burst so a large file cannot monopolize the worker.
    for(let step=0;step<steps&&active();step++){
     const jobs=await d.storage.jobs.list(owner);if(!jobs.every(validAttachmentJob))throw Error('Invalid own attachment jobs');
     const pending=jobs.filter(j=>!terminal(j.phase)&&j.next<=d.now()&&!idle.has(j.digest));if(!pending.length)break;
     const job=selectWork(pending)!;await run(job,epoch);if(!active())break;
     const saved=await d.storage.jobs.get(owner,job.digest);
     if(!saved||saved.revision===job.revision)idle.add(job.digest);
     else if(saved.failures===0&&(saved.cursor>job.cursor||saved.phase!==job.phase))progressed=true;
     if(Date.now()-started>=milliseconds)break;
    }
    return active()&&progressed;
   }finally{busy=false;}
  },
  async cancel(digest:string){const owner=d.owner();if(!owner||stopped)throw Error('Unlock your account first');generation++;const epoch=generation;const job=await d.storage.jobs.get(owner,digest);
   if(!job||terminal(job.phase)||job.receipt)throw Error('This transfer is already stopped or received');
   if(!await d.storage.jobs.save({...job,revision:job.revision+1,phase:'cancelled'},job.revision,()=>!stopped&&generation===epoch&&d.owner()===owner))throw Error('Transfer changed. Try again');
  },
  async retry(digest:string){const owner=d.owner();if(!owner||stopped)throw Error('Unlock your account first');generation++;const epoch=generation;const job=await d.storage.jobs.get(owner,digest);
   if(!job||job.phase==='complete')throw Error('Transfer is already complete');
   if(job.descriptor.manifest.expires<=d.now())throw Error('This attachment expired. Ask the sender to send it again');
   const peer=job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient;
   if(!d.allowed(peer))throw Error('Accept or unblock this identity first');
   unavailable.clear();directWaiting.clear();
   if(!await d.storage.jobs.save({...job,revision:job.revision+1,phase:job.receipt?'confirming':job.direction==='outgoing'?'queued':'downloading',cursor:job.direction==='outgoing'?0:job.cursor,relay:null,next:0,failures:0},job.revision,()=>!stopped&&generation===epoch&&d.owner()===owner&&d.allowed(peer)))throw Error('Transfer changed. Try again');
  },
  invalidate(){generation++;unavailable.clear();directWaiting.clear();published.clear();storedPublished.clear();},stop(){readiness.clear();stopped=true;generation++;unavailable.clear();directWaiting.clear();published.clear();storedPublished.clear();},
 };
}
