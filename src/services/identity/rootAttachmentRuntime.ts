import {selections,changeSelections,subscribeAttachmentSelections} from './rootAttachmentSelections';
import {createWssAttachmentStreams,type WssStreamNetwork,type WssStreamOutcome} from './wssAttachmentStreams';
import {hexToBytes,bytesToHex} from '@noble/hashes/utils.js';
import {createRootStreamTemporary,hashRootAttachmentFile} from './rootAttachmentFiles';
import {attachmentWorkDelay,createAttachmentReconcileGate} from './attachmentSchedule';
import {attachmentCanAdvance,attachmentRouteSnapshot} from './attachmentRouteSelection';
import {createRootAttachmentStreams,type AttachmentStreams} from './rootAttachmentStreams';
import type {AttachmentRequests} from './attachmentConnections';
import {ownChatRevision,subscribeOwnChatWrites} from '../../modules/storage/chatStore';
import {createWorkPump} from '../workPump';
import {startRootMediaExport} from './rootMediaExport';
import {indexAttachmentPolicy,createAttachmentSnapshot,readAttachmentAdmissionSnapshot} from './attachmentPolicy';
import {attachmentDigest} from './attachmentProtocol';
import {createAttachmentTiming} from './attachmentTiming';
import {rootGroupAllowed} from './rootGroups';

import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {localRootChat,subscribeRootChatCommitted} from './localRootChat';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {verifyRecord} from './identityProtocol';
import {createAttachmentTransfer,type AttachmentJob} from './attachmentTransfer';
import {createMobileAttachmentJobs} from './mobileAttachmentJobs';
import {prepareRootAttachment,readRootAttachmentChunk,readRootAttachmentChunks,writeRootAttachmentChunk,writeRootAttachmentChunks,commitRootAttachmentFile,rootAttachmentFile,removeRootAttachmentSource} from './rootAttachmentFiles';
import {AppState} from 'react-native';
let activeTimings:(()=>{startedAt:number;observedAt:number;stages:ReturnType<ReturnType<typeof createAttachmentTiming>['snapshot']>})|null=null;
let streamOutcomes:WssStreamOutcome[]=[];
export const rootAttachmentStreamDiagnostics=()=>localAccount.status().state==='unlocked'?streamOutcomes.map(row=>({...row})):[];
let inspectScheduler:(()=>ReturnType<ReturnType<typeof createWorkPump>['snapshot']>)|null=null;
export const rootAttachmentSchedulerDiagnostics=()=>inspectScheduler?.()??null;
/** Local aggregate diagnostics; no identities, paths or payloads. */
export const rootAttachmentTimings=()=>localAccount.status().state==='unlocked'?activeTimings?.()??null:null;
let activeControls:{cancel(digest:string):Promise<void>;retry(digest:string):Promise<void>}|null=null;
export async function controlRootAttachment(digest:string,action:'pause'|'retry'){
 if(!activeControls||localAccount.status().state!=='unlocked')throw Error('Unlock your account and wait for the network');
 await (action==='pause'?activeControls.cancel(digest):activeControls.retry(digest));
}
/** Own transfer jobs are separate from the temporary ciphertext this device holds for other people. */
export function startRootAttachmentRuntime(network:AttachmentRequests&{wss?:WssStreamNetwork;streams?:AttachmentStreams;lookup?(peer:string):Promise<unknown>}){
 const timingEnabled=(typeof __DEV__!=='undefined'&&__DEV__)||process.env.EXPO_PUBLIC_ATTACHMENT_TIMING==='1',timing=createAttachmentTiming(timingEnabled);
 streamOutcomes=[];const outcomes=streamOutcomes;
 const timingStarted=Date.now(),snapshotTimings=()=>({startedAt:timingStarted,observedAt:Date.now(),stages:timing.snapshot()});
 if(timingEnabled)activeTimings=snapshotTimings;
 const records=createMobileIdentityRecordStore(Date.now),journal=createMobileAttachmentJobs(Date.now,timing.measure);
 const store={...journal,save:(...args:Parameters<typeof journal.save>)=>timing.measure('checkpoint',()=>journal.save(...args)),
  ...(timingEnabled&&journal.isCurrent?{isCurrent:(...args:Parameters<NonNullable<typeof journal.isCurrent>>)=>timing.measure('leaseCheck',()=>journal.isCurrent!(...args))}:{})};let stopped=false,busy=false,epoch=0,selectionCursor=0;
 const accepted=new Set<string>();const owner=()=>!stopped&&localAccount.status().state==='unlocked'&&!localAccount.status().busy?localAccount.status().account:null;
 let allowedJob:(job:AttachmentJob)=>boolean=()=>false;
 const snapshots=createAttachmentSnapshot({owner,revision:ownChatRevision,read:()=>localRootChat().snapshot(),
  readVersioned:()=>{const account=owner();return account?localRootChat().revisionSnapshot(()=>ownChatRevision(account)):Promise.resolve(null);}});
 let policyRevision=-1;
 function applyPolicy(snapshot:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>,account:string,revision:number){
  allowedJob=indexAttachmentPolicy(snapshot,account);accepted.clear();for(const c of snapshot.contacts)if(c.accepted&&!c.blocked)accepted.add(c.account);
  for(const g of snapshot.groups??[])if(g.accepted&&!g.blocked&&g.members.includes(account))for(const peer of g.members)if(!snapshot.contacts.some(c=>c.account===peer&&c.blocked))accepted.add(peer);
  policyRevision=revision;
 }
 const streamLease=(job:AttachmentJob,live:()=>Promise<boolean>)=>async()=>{
  const deny=(reason:string)=>{if(timingEnabled)console.info('[Axonic stream lease]',reason);return false;};
  if(owner()!==job.owner)return deny('owner-context');const revision=ownChatRevision(job.owner);
  if(revision!==policyRevision){const generation=epoch,snapshot=await readAttachmentAdmissionSnapshot(snapshots.read,()=>owner()===job.owner&&epoch===generation);if(!snapshot)return deny('snapshot-invalidated');applyPolicy(snapshot.state,job.owner,snapshot.revision);}
  if(!allowedJob(job)||!accepted.has(job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient))return deny('policy');
  return await live()||deny('job-lease');
 };
 const streams=network.streams?createRootAttachmentStreams(network.streams,(...args)=>timing.measure('streamControl',()=>network.request(...args))):undefined;
 const wss=network.wss&&Native?.identityRandomBytes&&Native?.attachmentFileSha256&&Native?.attachmentStageStream?createWssAttachmentStreams({...network.wss,timing,random:async n=>hexToBytes(await Native!.identityRandomBytes!(n)),
  crypto:Native.attachmentStreamSeal&&Native.attachmentStreamOpen?{
   seal:(key,nonce,aad,plain)=>Native!.attachmentStreamSeal!(key,nonce,aad,plain),
   open:(key,nonce,aad,ciphertext)=>Native!.attachmentStreamOpen!(key,nonce,aad,ciphertext),
  }:undefined,
  outcome:timingEnabled?value=>{outcomes.push(value);if(outcomes.length>16)outcomes.shift();}:undefined,
  sleep:ms=>AppState.currentState!=='active'?Native?.axonMessageWait?.(Math.max(1,ms)):undefined,
  current:job=>owner()===job.owner&&allowedJob(job)&&accepted.has(job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient),
  files(job,id,role){let temporary:ReturnType<typeof createRootStreamTemporary>|undefined;
   return {reader:()=>{const h=rootAttachmentFile(job.owner,job.digest).open();return {read:(n:number)=>timing.measureSync('streamRead',()=>h.readBytes(n)),close:()=>h.close()};},
    writer:()=>{temporary=createRootStreamTemporary(job.owner,id);const h=temporary.open();return {write:(b:Uint8Array)=>timing.measureSync('streamWrite',()=>h.writeBytes(b)),close:()=>h.close()};},
    hash:()=>timing.measure('streamHash',()=>hashRootAttachmentFile(job.owner,role==='send'?job.digest:id,job.descriptor.manifest.bytes)),
    async commit(){if(!Native!.attachmentStageStream!(job.owner,id,job.digest,job.descriptor.manifest.bytes))throw Error('Stream staging failed');},
    discard(){if(temporary?.parentDirectory.exists)temporary.parentDirectory.delete();}};
  }}):undefined;
 // Updated peers pipeline the bounded window; older peers serialize it safely.
 const worker=createAttachmentTransfer({
 measureProcessing:timing.measureSync,
 decryptBlock:Native?.attachmentDecryptBlock?(ciphertext,key,aad)=>timing.measure('decryptBlock',()=>Native!.attachmentDecryptBlock!(ciphertext,bytesToHex(key),aad)):undefined,downloadWindow:4,
uploadWindow:4,
owner,
device:()=>localAccount.callDevice(),
now:Date.now,
hashLeaf:Native?.attachmentSha256?value=>Native!.attachmentSha256!(value):undefined,
record:async account=>timing.measure('jobIdentity',async()=>account===owner()?localAccount.publicRecord():records.read(account)),
allowed:peer=>accepted.has(peer),
allowedJob:job=>allowedJob(job),
signReceipt:async manifest=>timing.measure('receipt',async()=>localAccount.signAttachmentReceipt(manifest)),
stored:async(job,current)=>{if(current())await localRootChat().networkStored(job.descriptor.manifest.recipient,job.descriptor.manifest.id,job.descriptor.manifest.expires,true);},
completed:async(job:AttachmentJob,current)=>{if(!current())throw Error('Account locked');
   if(!rootAttachmentFile(job.owner,job.digest).exists)throw Error('Own attachment unavailable');
   const peer=job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient;
   if(!job.receipt||!await timing.measure('chat',()=>localRootChat().attachmentComplete(peer,job.descriptor.manifest.id,job.direction,job.receipt!,job.delivery)))throw Error('Attachment chat receipt unavailable');
   mediaExport.wake();
   if(timingEnabled)console.info('[Axonic attachment timing]',JSON.stringify({direction:job.direction,bytes:job.descriptor.manifest.bytes,stages:timing.snapshot()}));},
 storage:{jobs:store,files:{readChunk:(...args)=>timing.measure('readFile',()=>readRootAttachmentChunk(...args)),
readChunks:(...args)=>timing.measure('readFile',()=>readRootAttachmentChunks(...args)),
writeChunk:(...args)=>timing.measure('writeFile',()=>writeRootAttachmentChunk(...args)),
writeChunks:(...args)=>timing.measure('writeFile',()=>writeRootAttachmentChunks(...args)),
commitFile:(...args)=>timing.measure('verifyFile',()=>commitRootAttachmentFile(...args))}},
 connections:{sharedPeers:network.sharedPeers,
directStream:(job,live)=>timing.measure('directStream',async()=>{
 const lease=streamLease(job,live),m=job.descriptor.manifest;
 // Prefer an already open RTC lane. Otherwise use the authenticated WSS
 // session before attempting a second transport; each adapter rechecks its lease.
 const readyWss=!!wss&&network.wss?.peer(m.sender)?.device===m.senderDevice;
 if(readyWss&&!network.streams?.available(m.sender,m.senderDevice)){
  const result=await wss!.pull(job,lease);if(result!=='unavailable')return result;
  return await timing.measure('rtcStreamAttempt',async()=>await streams?.pull(job,lease)??'unavailable');
 }
 const result=await timing.measure('rtcStreamAttempt',async()=>await streams?.pull(job,lease)??'unavailable');
 return result==='unavailable'?(await wss?.pull(job,lease)??'unavailable'):result;
}),
serveStream:(job,live,id)=>id?(wss?.serve(job,streamLease(job,live),id)??Promise.resolve(false)):(streams?.serve(job,streamLease(job,live))??Promise.resolve(false)),
blockStreamPeers:network.blockStreamPeers,
bulkPeers:network.bulkPeers,
uploadBatchPeers:network.uploadBatchPeers,
batchChunks:network.batchChunks,
batchWindow:network.batchWindow,
bulkRequest:network.bulkRequest?(...args)=>timing.measure('network',()=>timing.measure('networkBulk',()=>network.bulkRequest!(...args))):undefined,
peers:network.peers,
request:(...args)=>{
   let op:string|undefined;try{op=JSON.parse(args[1]).operation;}catch{/* No payload recorded. */}
   const status=op==='status'||op==='direct-status';
   return timing.measure('network',()=>timing.measure(status?'networkStatus':'networkOther',()=>
    status?timing.measure(op==='direct-status'?'networkDirectStatus':'networkCustodyStatus',()=>network.request(...args)):network.request(...args)));
  }}
});
 const mediaExport=startRootMediaExport();
 const controls={async cancel(digest:string){await worker.cancel(digest);wake();},async retry(digest:string){await worker.retry(digest);wake();}};
 activeControls=controls;
 const reconciliation=createAttachmentReconcileGate();
 const unsubscribe=localAccount.subscribe(()=>{epoch++;snapshots.clear();worker.invalidate();accepted.clear();allowedJob=()=>false;policyRevision=-1;reconciliation.clear();wake();});
 let preparing=false;
 const lookupAfter=new Map<string,number>();
 async function prepareSelection(account:string,snapshot:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>,current:()=>boolean){
   const ledger=localRootChat();
   const queued=await selections(account);if(!current())return;const removed=queued.filter(s=>snapshot.hiddenChats?.includes(s.group?'group:'+s.group.id:s.peer));
   if(removed.length){await changeSelections(account,rows=>{for(let i=rows.length-1;i>=0;i--)if(removed.some(r=>r.id===rows[i].id))rows.splice(i,1);});for(const row of removed)removeRootAttachmentSource(account,row.id);for(const id of new Set(removed.map(r=>r.shared?.id).filter((id):id is string=>!!id)))if(!queued.some(r=>!removed.includes(r)&&r.shared?.id===id))removeRootAttachmentSource(account,id);}
   for(const peer of lookupAfter.keys())if(!queued.some(s=>s.peer===peer))lookupAfter.delete(peer);
   const eligible=queued.filter(s=>!removed.includes(s)&&!s.failed&&!snapshot.contacts.find(c=>c.account===s.peer)?.blocked);
   const pending=eligible.length?eligible[selectionCursor++%eligible.length]:null;
   if(pending){
    const batch=pending.shared?eligible.filter(s=>s.shared?.id===pending.shared!.id):[pending];
    // Do not publish a partial audience while another grant is failed or blocked.
    if(pending.shared&&batch.length!==queued.filter(s=>s.shared?.id===pending.shared!.id).length)return;
    try{
     const prepared=[];
     for(const row of batch){
      const record=await records.read(row.peer);if(!current())return;
      if(!record||!verifyRecord(record,Date.now())){
       if((lookupAfter.get(row.peer)??0)<=Date.now()){
        lookupAfter.set(row.peer,Date.now()+5000);
        try{await network.lookup?.(row.peer);}finally{if(current())lookupAfter.set(row.peer,Date.now()+5000);}
       }return;
      }
      if(row.group&&(!rootGroupAllowed(snapshot,account,row.peer,row.group)||!snapshot.groups?.find(g=>g.id===row.group!.id)?.accepted))throw Error('Group membership changed');
      const input=await timing.measure('prepare',()=>prepareRootAttachment({...row,recipient:record,current}));if(!current())return;
      prepared.push({input,reply:row.reply,group:row.group,selectedAt:row.createdAt});
     }
     // A connected recipient can request bytes as soon as the descriptor is
     // published. Persist every serving job before making the audience visible.
     for(const item of prepared){await worker.enqueue(item.input,'outgoing');if(!current())return;}
     if(batch.length===1)await ledger.enqueueAttachment(prepared[0].input,pending.reply,pending.group,pending.createdAt);
     else await ledger.enqueueAttachments(prepared);
     if(!current())return;
     const ids=new Set(batch.map(s=>s.id));
     await changeSelections(account,rows=>{for(let i=rows.length-1;i>=0;i--)if(ids.has(rows[i].id))rows.splice(i,1);});
     for(const row of batch)removeRootAttachmentSource(account,row.id);
     if(pending.shared)removeRootAttachmentSource(account,pending.shared.id);
     return true;
    }catch{if(current())await changeSelections(account,rows=>{for(const row of rows)if(batch.some(s=>s.id===row.id))row.failed=true;});}
   }

 }
 async function tick(){const account=owner(),generation=epoch;if(!account||busy)return;busy=true;
  const current=()=>!stopped&&epoch===generation&&owner()===account;
  try{
   await timing.measure('queueMaintenance',async()=>store.retire?.(account,current));if(!current())return;
   const cached=await timing.measure('historySnapshot',()=>snapshots.read());if(!cached||!current())return;const snapshot=cached.state;if(policyRevision!==cached.revision)applyPolicy(snapshot,account,cached.revision);
   // Preparation/identity lookup has its own single flight. Slow remote lookups
   // and local encryption must not hold the download/receipt worker hostage.
   if(!preparing){preparing=true;void prepareSelection(account,snapshot,current)
    .then(progressed=>{if(progressed&&current())wake();})
    .catch(()=>{/* Durable selections remain retryable. */}).finally(()=>{preparing=false;});}
   // A changed ledger wakes us immediately. Periodic reconciliation can restore
   // a missing checkpoint, without revalidating every descriptor on every burst.
   if(reconciliation.needed(cached.revision,Date.now())){
    for(const message of snapshot.messages){if(!current())return;if(message.attachment&&message.networkCancelledAt===undefined&&message.status==='pending'&&accepted.has(message.peer)&&(!message.group||rootGroupAllowed(snapshot,account,message.peer,message.group))){
    const m=message.attachment.manifest;if(m.expires>Date.now())await timing.measure('reconcile',()=>worker.enqueue(message.attachment!,message.direction));
    }}
    if(current())reconciliation.complete(cached.revision,Date.now());
   }
   if(current())return await worker.tick({maxSteps:32,maxMilliseconds:50});
  }finally{busy=false;}
 }
 // Progress yields between bursts. Empty queues sleep; pending work has deadlines.
 const pump=createWorkPump({run:tick,idleMilliseconds:200,maximumIdleMilliseconds:5000,nextDelay:async()=>{
  const account=owner();if(!account)return Infinity;
  const now=Date.now(),jobs=await store.list(account);
  // Idle stores sleep. Pending jobs retain bounded retries; disconnected jobs
  // wake on topology changes or their expiry, rather than querying empty routes.
  const routes=attachmentRouteSnapshot(network,!!streams||!!wss);
  let next=attachmentWorkDelay(jobs,now,job=>allowedJob(job)&&attachmentCanAdvance(job,routes,now));
  if((await selections(account)).some(s=>!s.failed))next=Math.min(next,15000);
  return next;
 }});
 inspectScheduler=pump.snapshot;
 // Background frame timers may pause even after an in-flight checkpoint.
 // Real events retain immediate dispatch through that checkpoint boundary.
 function wake(){if(AppState?.currentState==='background')pump.wakeNow();else pump.wake();}
 const wakeOwner=(account:string)=>{if(account===owner())wake();};
 const offWrites=subscribeOwnChatWrites(wakeOwner);const offSelections=subscribeAttachmentSelections(wakeOwner);
 const offCommitted=subscribeRootChatCommitted((account,revision,state)=>{if(snapshots.committed(account,revision,state))wake();});
 return {runDue:pump.runDue,async recoveryComplete(sender:string,id:string){
  const account=owner(),generation=epoch;if(!account)return true;
  const cached=await readAttachmentAdmissionSnapshot(snapshots.read,()=>owner()===account&&epoch===generation);if(!cached)return false;
  const message=cached.state.messages.find(m=>m.direction==='incoming'&&m.peer===sender&&m.id===id);
  if(!message?.attachment)return true;
  const job=await store.get(account,attachmentDigest(message.attachment.manifest));
  return owner()!==account||epoch!==generation||!!job&&['complete','cancelled','expired'].includes(job.phase);
 },receiveWssBinary:(raw:Uint8Array,peer:import('./identityClient').IdentityPeer)=>wss?.receiveBinary(raw,peer)??false,receiveWss:(raw:string,peer:import('./identityClient').IdentityPeer)=>wss?.receive(raw,peer)??false,wake,receive:(...args:Parameters<typeof worker.receive>)=>timing.measure('serve',async()=>{
  const account=owner(),generation=epoch;if(!account)return null;
  // New descriptors and blocking decisions can arrive between pump turns.
  // Refresh only on a changed revision, before admitting a serving request.
  if(ownChatRevision(account)!==policyRevision){
   const cached=await timing.measure('historySnapshot',()=>readAttachmentAdmissionSnapshot(snapshots.read,()=>owner()===account&&epoch===generation));if(!cached)return null;
   applyPolicy(cached.state,account,cached.revision);
  }
  if(owner()!==account||epoch!==generation)return null;
  const result=await worker.receive(...args);wake();return result;
 }),stop(){if(inspectScheduler===pump.snapshot)inspectScheduler=null;if(activeTimings===snapshotTimings)activeTimings=null;if(activeControls===controls)activeControls=null;stopped=true;snapshots.clear();streams?.stop();wss?.stop();mediaExport.stop();epoch++;pump.stop();offWrites();offSelections();offCommitted();unsubscribe();worker.stop();},cancel:controls.cancel};
}

