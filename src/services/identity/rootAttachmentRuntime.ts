import {assertAttachmentFits} from './rootChatLedger';
import {selections,changeSelections,subscribeAttachmentSelections} from './rootAttachmentSelections';
import {createWssAttachmentStreams,type WssStreamNetwork,type WssStreamOutcome} from './wssAttachmentStreams';
import {hexToBytes,bytesToHex} from '@noble/hashes/utils.js';
import {createRootStreamTemporary,hashRootAttachmentFile,reuseRootAttachmentFile,reuseRootStickerFile} from './rootAttachmentFiles';
import {loadImportedStickers} from '../imported-stickers';
import {IMPORTED_STICKER_CONTENT} from '../sticker-file-format';
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
import {rootChatView} from './rootChatActions';

import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {localRootChat,subscribeRootChatCommitted} from './localRootChat';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {verifyRecord} from './identityProtocol';
import {createAttachmentTransfer,type AttachmentJob} from './attachmentTransfer';
import {createMobileAttachmentJobs,publishAttachmentReceiveProgress} from './mobileAttachmentJobs';
import {prepareRootAttachment,readRootAttachmentChunk,readRootAttachmentChunks,writeRootAttachmentChunk,writeRootAttachmentChunks,commitRootAttachmentFile,rootAttachmentFile,removeRootAttachmentSource} from './rootAttachmentFiles';
import {AppState} from 'react-native';
let activeTimings:(()=>{startedAt:number;observedAt:number;stages:ReturnType<ReturnType<typeof createAttachmentTiming>['snapshot']>})|null=null;
let streamOutcomes:WssStreamOutcome[]=[];
export const rootAttachmentStreamDiagnostics=()=>localAccount.status().state==='unlocked'?streamOutcomes.map(row=>({...row})):[];
let preparationDiagnostics={prepared:0,invalidated:0,rejected:0,stateWriteErrors:0};
export const rootAttachmentPreparationDiagnostics=()=>({...preparationDiagnostics});
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
export function startRootAttachmentRuntime(network:AttachmentRequests&{wss?:WssStreamNetwork;streams?:AttachmentStreams;lookup?(peer:string):Promise<unknown>;outgoingCustodian?(job:AttachmentJob):Promise<string|null|undefined>;canStoreOutgoing?(peer:string):boolean}){
 const timingEnabled=true,timing=createAttachmentTiming(timingEnabled);
 streamOutcomes=[];const outcomes=streamOutcomes;
 preparationDiagnostics={prepared:0,invalidated:0,rejected:0,stateWriteErrors:0};
 const timingStarted=Date.now(),snapshotTimings=()=>({startedAt:timingStarted,observedAt:Date.now(),stages:timing.snapshot()});
 if(timingEnabled)activeTimings=snapshotTimings;
 let reuseCandidates:{owner:string;revision:number;checksum:string;bytes:number;digests:Promise<string[]>}|undefined;
 const records=createMobileIdentityRecordStore(Date.now),journal=createMobileAttachmentJobs(Date.now,timing.measure,wake);
 const store={...journal,save:(...args:Parameters<typeof journal.save>)=>timing.measure('checkpoint',()=>journal.save(...args)),
  ...(timingEnabled&&journal.isCurrent?{isCurrent:(...args:Parameters<NonNullable<typeof journal.isCurrent>>)=>timing.measure('leaseCheck',()=>journal.isCurrent!(...args))}:{})};let stopped=false,busy=false,epoch=0,selectionCursor=0;
 const accepted=new Set<string>();const owner=()=>!stopped&&localAccount.status().state==='unlocked'&&!localAccount.status().busy?localAccount.status().account:null;
 let allowedJob:(job:Pick<AttachmentJob,'owner'|'digest'>)=>boolean=()=>false;
 const snapshots=createAttachmentSnapshot({owner,revision:ownChatRevision,read:()=>localRootChat().snapshot(),
  readVersioned:()=>{const account=owner();return account?localRootChat().attachmentRevisionSnapshot(()=>ownChatRevision(account)):Promise.resolve(null);}});
 let policyRevision=-1,admissionRetryAt=Infinity;
 function applyPolicy(snapshot:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>,account:string,revision:number){
  allowedJob=indexAttachmentPolicy(snapshot,account);accepted.clear();for(const c of snapshot.contacts)if(c.accepted&&!c.blocked)accepted.add(c.account);
  for(const g of snapshot.groups??[])if(g.accepted&&!g.blocked&&g.members.includes(account))for(const peer of g.members)if(!snapshot.contacts.some(c=>c.account===peer&&c.blocked))accepted.add(peer);
  policyRevision=revision;
 }
 const streamLease=(job:AttachmentJob,live:()=>Promise<boolean>)=>async()=>{
  const deny=(reason:string)=>{if(typeof __DEV__!=='undefined'&&__DEV__)console.info('[Axonic stream lease]',reason);return false;};
  if(owner()!==job.owner)return deny('owner-context');const revision=ownChatRevision(job.owner);
  if(revision!==policyRevision){const generation=epoch,snapshot=await readAttachmentAdmissionSnapshot(snapshots.read,()=>owner()===job.owner&&epoch===generation);if(!snapshot)return deny('snapshot-invalidated');applyPolicy(snapshot.state,job.owner,snapshot.revision);}
  if(!allowedJob(job)||!accepted.has(job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient))return deny('policy');
  return await live()||deny('job-lease');
 };
 function reportReceiveProgress(job:AttachmentJob){
  let reportedAt=0;
  return (bytes:number)=>{
   const now=Date.now();
   if(now-reportedAt>=1000||bytes===job.descriptor.manifest.bytes){
    reportedAt=now;publishAttachmentReceiveProgress(job.owner,job.descriptor.manifest.id,bytes,job.digest);
   }
  };
 }
 const streams=network.streams?createRootAttachmentStreams(network.streams,(...args)=>timing.measure('streamControl',()=>network.request(...args)),wake,reportReceiveProgress):undefined;
 const wss=network.wss&&Native?.identityRandomBytes&&Native?.attachmentFileSha256&&Native?.attachmentStageStream?createWssAttachmentStreams({...network.wss,timing,changed:wake,random:async n=>hexToBytes(await Native!.identityRandomBytes!(n)),
  crypto:Native.attachmentStreamSeal&&Native.attachmentStreamOpen?{
   seal:(key,nonce,aad,plain)=>Native!.attachmentStreamSeal!(key,nonce,aad,plain),
   open:(key,nonce,aad,ciphertext)=>Native!.attachmentStreamOpen!(key,nonce,aad,ciphertext),
  }:undefined,
  outcome:timingEnabled?value=>{outcomes.push(value);if(outcomes.length>16)outcomes.shift();}:undefined,
  sleep:ms=>AppState.currentState!=='active'?Native?.axonMessageWait?.(Math.max(1,ms)):undefined,
  current:job=>owner()===job.owner&&allowedJob(job)&&accepted.has(job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient),
  files(job,id,role){let temporary:ReturnType<typeof createRootStreamTemporary>|undefined;
   return {reader:()=>{const h=rootAttachmentFile(job.owner,job.digest).open();return {read:(n:number)=>timing.measureSync('streamRead',()=>h.readBytes(n)),close:()=>h.close()};},
    writer:()=>{temporary=createRootStreamTemporary(job.owner,id);const h=temporary.open();const report=reportReceiveProgress(job);let bytes=0;
     return {write:(b:Uint8Array)=>{
      timing.measureSync('streamWrite',()=>h.writeBytes(b));
      bytes+=b.length;report(bytes);
     },close:()=>h.close()};},
    hash:()=>timing.measure('streamHash',()=>hashRootAttachmentFile(job.owner,role==='send'?job.digest:id,job.descriptor.manifest.bytes)),
    async commit(){if(!Native!.attachmentStageStream!(job.owner,id,job.digest,job.descriptor.manifest.bytes))throw Error('Stream staging failed');},
    discard(){if(temporary?.parentDirectory.exists)temporary.parentDirectory.delete();}};
  }}):undefined;
 // Updated peers pipeline the bounded window; older peers serialize it safely.
 const sendingStream=(job:AttachmentJob)=>streams?.sending(job)===true||wss?.sending(job)===true;
 const worker=createAttachmentTransfer({
 incomingLanes:{limit:2,changed:wake},
 outgoingCustodian:network.outgoingCustodian,
 canStoreOutgoing:network.canStoreOutgoing,
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
signReceipt:async (manifest,route)=>timing.measure('receipt',async()=>localAccount.signAttachmentReceipt(manifest,route)),
firstRelayBlock:(job,relay)=>{if(__DEV__)console.info('[Axonic first verified relay block]',{bytes:job.descriptor.manifest.bytes,relay});},
stored:async(job,current,relay)=>{
 if(!current())return;
 await localRootChat().networkStored(job.descriptor.manifest.recipient,job.descriptor.manifest.id,job.descriptor.manifest.expires,true,relay);
 if(__DEV__)console.info('[Axonic relay storage observed]',{bytes:job.descriptor.manifest.bytes,relay,slot:job.descriptor.manifest.shared?.slot});
},
completed:async(job:AttachmentJob,current)=>{if(!current())throw Error('Account locked');
   // A verified recipient receipt completes an outgoing transfer even if the
   // sender removed its local source after upload. Incoming completion still
   // requires our own durable file; the ledger verifies the signed receipt below.
   if(job.direction==='incoming'&&!rootAttachmentFile(job.owner,job.digest).exists)throw Error('Own attachment unavailable');
   const peer=job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient;
   if(!job.receipt||!await timing.measure('chat',()=>localRootChat().attachmentComplete(peer,job.descriptor.manifest.id,job.direction,job.receipt!,job.delivery)))throw Error('Attachment chat receipt unavailable');
   mediaExport.wake();
   if(timingEnabled)console.info('[Axonic attachment timing]',JSON.stringify({direction:job.direction,bytes:job.descriptor.manifest.bytes,stages:timing.snapshot()}));},
 storage:{jobs:store,files:{reuseFile:async(job,current)=>{
  return timing.measure('localReuse',async()=>{
   // Clear a stale library link before allowing ordinary file publication.
   const stickers=job.descriptor.name===IMPORTED_STICKER_CONTENT?await loadImportedStickers(job.owner).catch(()=>[]):[];
   if(await reuseRootStickerFile(job,stickers,current))return true;
   if(!current())return false;
   const owner=job.owner,revision=ownChatRevision(owner),checksum=job.descriptor.checksum,bytes=job.descriptor.manifest.bytes;
   if(reuseCandidates?.owner!==owner||reuseCandidates.revision!==revision||reuseCandidates.checksum!==checksum||reuseCandidates.bytes!==bytes){
    const digests=localRootChat().mediaSnapshot({checksum,bytes}).then(state=>rootChatView(owner,{...state,messages:state.messages.filter(m=>!m.deleted)}).messages.flatMap(m=>{
     const a=m.attachment;
     return m.deleted||!a||a.checksum!==checksum||a.manifest.bytes!==bytes||m.direction==='incoming'&&m.status!=='delivered'?[]:[attachmentDigest(a.manifest)];
    }));
    reuseCandidates={owner,revision,checksum,bytes,digests};
   }
   const candidates=reuseCandidates;
   let digests;try{digests=await candidates.digests;}catch{if(reuseCandidates===candidates)reuseCandidates=undefined;return false;}
   const unchanged=()=>current()&&ownChatRevision(owner)===revision;
   if(!unchanged())return false;
   try{return await reuseRootAttachmentFile(job,[...new Set(digests)],unchanged);}
   catch(error){if(current()&&!unchanged())return false;throw error;}
  });
 },readChunk:(...args)=>timing.measure('readFile',()=>readRootAttachmentChunk(...args)),
readChunks:(...args)=>timing.measure('readFile',()=>readRootAttachmentChunks(...args)),
writeChunk:(...args)=>timing.measure('writeFile',()=>writeRootAttachmentChunk(...args)),
writeChunks:(...args)=>timing.measure('writeFile',()=>writeRootAttachmentChunks(...args)),
commitFile:(...args)=>timing.measure('verifyFile',()=>commitRootAttachmentFile(...args))}},
 connections:{sharedPeers:network.sharedPeers,sendingStream,
directStream:(job,live)=>timing.measure('directStream',async()=>{
 const lease=streamLease(job,live),m=job.descriptor.manifest;
 const rtc=()=>timing.measure('rtcStreamAttempt',async()=>await streams?.pull(job,lease)??'unavailable');
 const websocket=async()=>await wss?.pull(job,lease)??'unavailable';
 // Prefer an already open RTC lane, then an authenticated WSS route.
 const preferWss=!!wss&&network.wss?.peer(m.sender)?.device===m.senderDevice&&!network.streams?.available(m.sender,m.senderDevice);
 let received=false;
 try{
  const first=await (preferWss?websocket():rtc());
  const result=first==='unavailable'?await (preferWss?rtc():websocket()):first;
  received=result===true;
  return result;
 }finally{if(!received)publishAttachmentReceiveProgress(job.owner,m.id,0,job.digest);}
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
 const unsubscribe=localAccount.subscribe(()=>{epoch++;snapshots.clear();worker.invalidate();accepted.clear();allowedJob=()=>false;policyRevision=-1;admissionRetryAt=Infinity;reconciliation.clear();wake();});
 let preparing=false;
 const lookupAfter=new Map<string,number>();
 const lookingUp=new Set<string>();
 async function prepareSelection(account:string,snapshot:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>,current:()=>boolean){
   const ledger=localRootChat();
   const queued=await selections(account);if(!current())return;const removed=queued.filter(s=>snapshot.hiddenChats?.includes(s.group?'group:'+s.group.id:s.peer));
   if(removed.length){await changeSelections(account,rows=>{for(let i=rows.length-1;i>=0;i--)if(removed.some(r=>r.id===rows[i].id))rows.splice(i,1);});for(const row of removed)removeRootAttachmentSource(account,row.id);for(const id of new Set(removed.map(r=>r.shared?.id).filter((id):id is string=>!!id)))if(!queued.some(r=>!removed.includes(r)&&r.shared?.id===id))removeRootAttachmentSource(account,id);}
   for(const peer of lookupAfter.keys())if(!queued.some(s=>s.peer===peer))lookupAfter.delete(peer);
   const blocked=queued.filter(s=>!s.failed&&snapshot.contacts.some(c=>c.account===s.peer&&c.blocked));
   if(blocked.length){await changeSelections(account,rows=>{for(const row of rows)if(blocked.some(b=>b.id===row.id||b.shared&&b.shared.id===row.shared?.id)){row.failed=true;row.reason='audience';}});return true;}
   const eligible=queued.filter(s=>!removed.includes(s)&&!s.failed&&!snapshot.contacts.find(c=>c.account===s.peer)?.blocked);
   const pending=eligible.length?eligible[selectionCursor++%eligible.length]:null;
   if(pending){
    const batch=pending.shared?eligible.filter(s=>s.shared?.id===pending.shared!.id):[pending];
    // Do not publish a partial audience while another grant is failed or blocked.
    if(pending.shared&&batch.length!==queued.filter(s=>s.shared?.id===pending.shared!.id).length){
     await changeSelections(account,rows=>{for(const row of rows)if(row.shared?.id===pending.shared!.id){row.failed=true;row.reason='audience';}});return;
    }
    try{
     const prepared=[];
     for(const row of batch){
      const record=await records.read(row.peer);if(!current())return;
      if(!record||!verifyRecord(record,Date.now())){
       if(row.reason!=='identity')await changeSelections(account,rows=>{for(const item of rows)if(batch.some(b=>b.id===item.id))item.reason='identity';});
       if(!lookingUp.has(row.peer)&&(lookupAfter.get(row.peer)??0)<=Date.now()){
        lookupAfter.set(row.peer,Date.now()+5000);
        lookingUp.add(row.peer);
        void Promise.resolve().then(()=>network.lookup?.(row.peer)).catch(()=>{}).finally(()=>{
         lookingUp.delete(row.peer);if(current()){lookupAfter.set(row.peer,Date.now()+5000);wake();}
        });
       }return;
      }
      if(row.group&&(!rootGroupAllowed(snapshot,account,row.peer,row.group)||!snapshot.groups?.find(g=>g.id===row.group!.id)?.accepted))throw Error('Group membership changed');
      const input=await timing.measure('prepare',()=>prepareRootAttachment({...row,recipient:record,current}));preparationDiagnostics.prepared++;if(!current()){preparationDiagnostics.invalidated++;return;}
      prepared.push({input,reply:row.reply,group:row.group,selectedAt:row.createdAt});
     }
     // A connected recipient can request bytes as soon as the descriptor is
     // published. Persist every serving job before making the audience visible.
     for(const item of prepared)assertAttachmentFits(item.input,item.reply,item.group);
     for(const item of prepared){await worker.enqueue(item.input,'outgoing');if(!current())return;}
     if(batch.length===1)await ledger.enqueueAttachment(prepared[0].input,pending.reply,pending.group,pending.createdAt);
     else await ledger.enqueueAttachments(prepared);
     if(!current())return;
     const ids=new Set(batch.map(s=>s.id));
     await changeSelections(account,rows=>{for(let i=rows.length-1;i>=0;i--)if(ids.has(rows[i].id))rows.splice(i,1);},batch);
     for(const row of batch)removeRootAttachmentSource(account,row.id);
     if(pending.shared)removeRootAttachmentSource(account,pending.shared.id);
     return true;
    }catch(error){preparationDiagnostics.rejected++;
     const reason=error instanceof Error&&error.message==='Attachment description is too large; shorten the caption'?'caption' as const:'preparation' as const;
     if(current())await changeSelections(account,rows=>{for(const row of rows)if(batch.some(s=>s.id===row.id)){row.failed=true;row.reason=reason;}});
    }
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
    .catch(()=>{preparationDiagnostics.stateWriteErrors++;/* Durable selections remain retryable. */}).finally(()=>{preparing=false;});}
   // A changed ledger wakes us immediately. Periodic reconciliation can restore
   // a missing checkpoint, without revalidating every descriptor on every burst.
   if(reconciliation.needed(cached.revision,Date.now())){
    let retryAdmission=false;
    for(const message of snapshot.messages){
     if(!current())return;
     const attachment=message.attachment;
     if(!attachment||message.networkCancelledAt!==undefined||message.status!=='pending'||!accepted.has(message.peer)
      ||message.group&&!rootGroupAllowed(snapshot,account,message.peer,message.group)||attachment.manifest.expires<=Date.now())continue;
     try{await timing.measure('reconcile',()=>worker.enqueue(attachment,message.direction));}
     catch{retryAdmission=true;}
    }
    // One failed admission must not prevent ready jobs from running. Retry on
    // the next ledger change or normal reconciliation window.
    if(current())reconciliation.complete(cached.revision,Date.now());
    if(current())admissionRetryAt=retryAdmission?Date.now()+30000:Infinity;
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
  let next=attachmentWorkDelay(jobs.filter(job=>worker.canSchedule(job)),now,job=>allowedJob(job)&&(!sendingStream(job)||!!job.receipt)&&attachmentCanAdvance(job,routes,now),worker.scheduleAt);
  if((await selections(account)).some(s=>!s.failed))next=Math.min(next,15000);
  return Math.min(next,Math.max(0,admissionRetryAt-now));
 }});
 inspectScheduler=pump.snapshot;
 // Background frame timers may pause even after an in-flight checkpoint.
 // Real events retain immediate dispatch through that checkpoint boundary.
 function wake(){if(AppState?.currentState==='background')pump.wakeNow();else pump.wake();}
 const wakeOwner=(account:string)=>{if(account===owner())wake();};
 const offWrites=subscribeOwnChatWrites(wakeOwner);const offSelections=subscribeAttachmentSelections(wakeOwner);
 const offCommitted=subscribeRootChatCommitted((account,revision,state)=>{if(snapshots.committed(account,revision,state))wake();});
 return {runDue:pump.runDue,async recoveryState(sender:string,id:string){
  const account=owner(),generation=epoch;if(!account)return 'complete' as const;
  const cached=await readAttachmentAdmissionSnapshot(snapshots.read,()=>owner()===account&&epoch===generation);if(!cached)return 'snapshot-unavailable' as const;
  const message=cached.state.messages.find(m=>m.direction==='incoming'&&m.peer===sender&&m.id===id);
  if(!message)return 'descriptor-missing' as const;
  if(!message.attachment)return 'complete' as const;
  const digest=attachmentDigest(message.attachment.manifest);
  if(policyRevision!==cached.revision)applyPolicy(cached.state,account,cached.revision);
  if(!accepted.has(sender)||!allowedJob({owner:account,digest}))return 'policy-held' as const;
  const job=await store.get(account,digest);
  if(owner()!==account||epoch!==generation||job&&['complete','cancelled','expired'].includes(job.phase))return 'complete' as const;
  if(!job)return 'job-missing' as const;
  if(!attachmentCanAdvance(job,attachmentRouteSnapshot(network,!!streams||!!wss),Date.now()))return 'route-unavailable' as const;
  if(job.next>Date.now())return 'retry-pending' as const;
  return 'ready' as const;
 },receiveWssBinary:(raw:Uint8Array,peer:import('./identityClient').IdentityPeer)=>wss?.receiveBinary(raw,peer)??false,receiveWss:(raw:string,peer:import('./identityClient').IdentityPeer)=>wss?.receive(raw,peer)??false,wake,receive:(...args:Parameters<typeof worker.receive>)=>timing.measure('serve',async()=>{
  const account=owner(),generation=epoch;if(!account)return null;
  // New descriptors and blocking decisions can arrive between pump turns.
  // Refresh only on a changed revision, before admitting a serving request.
  if(ownChatRevision(account)!==policyRevision){
   const cached=await timing.measure('historySnapshot',()=>readAttachmentAdmissionSnapshot(snapshots.read,()=>owner()===account&&epoch===generation));if(!cached)return null;
   applyPolicy(cached.state,account,cached.revision);
  }
  if(owner()!==account||epoch!==generation)return null;
  // Read-only status and block requests do not need another queue scan.
  // The journal wakes on a committed receipt; stream adapters emit their own events.
  return worker.receive(...args);
 }),stop(){if(inspectScheduler===pump.snapshot)inspectScheduler=null;if(activeTimings===snapshotTimings)activeTimings=null;if(activeControls===controls)activeControls=null;stopped=true;snapshots.clear();streams?.stop();wss?.stop();mediaExport.stop();epoch++;pump.stop();offWrites();offSelections();offCommitted();unsubscribe();worker.stop();},cancel:controls.cancel};
}



