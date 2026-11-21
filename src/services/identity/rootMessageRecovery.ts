import type {GroupCustodyPayload} from './groupCustodyProtocol';
import type {CustodyEnvelope} from './custodyProtocol';
import {AppState} from 'react-native';
import {deliveryDiagnosticEvent} from '../mobileDeliveryDiagnostics';
import Native from '../../../modules/axonic-nearby';
import {localAccount,startLocalAccount} from './localAccount';
import {startLocalAccountNetwork} from '../../composition/neuronRuntime';
import {acquireMessageWakeLease} from './messageWakeLease';
import {subscribeRootChatCommitted} from './localRootChat';
import {subscribeAttachmentJobProgress,subscribeAttachmentReceiveProgress} from './mobileAttachmentJobs';
import {configuredWakeCustodian} from './internetAxonTransport';
import type {MessageWakeRecoveryOutcome} from './messageNotificationDeadline';
// Wakes share the runtime and native wake window, not a per-message FIFO.
// A missing relay receipt must not delay admission of the next inline message.
let pumping:Promise<number>|undefined;
let lastPumpAt=0;
let eventPending=false,finishEventWait:(()=>void)|undefined;
const TARGET_IDLE_MS=20000;
function recoveryChanged(){eventPending=true;finishEventWait?.();}
function pump(network:ReturnType<typeof startLocalAccountNetwork>,events=false){
 if(pumping)return pumping;
 const work=Promise.resolve().then(async()=>{
  // Durable completion events interrupt the wait. Retain a bounded native
  // safety check for receipt paths without a completion event; hints share it.
  const now=Date.now();
  if(now-lastPumpAt>=1000||now<lastPumpAt){lastPumpAt=now;network.tick();}
  if(events&&eventPending){eventPending=false;return 0;}
  const waitingAt=Date.now(),delay=events?1000:300;
  await new Promise<void>((resolve,reject)=>{
   let finished=false;
   const finish=()=>{if(finished)return;finished=true;if(finishEventWait===finish)finishEventWait=undefined;eventPending=false;resolve();};
   if(events)finishEventWait=finish;
   const sleep=Native?.axonMessageWait?Native.axonMessageWait(delay):new Promise<void>(r=>setTimeout(r,delay));
   void sleep.then(finish,error=>{if(finished)return;finished=true;if(finishEventWait===finish)finishEventWait=undefined;reject(error);});
  });
  return Math.max(0,Date.now()-waitingAt-delay);
 });
 pumping=work;void work.finally(()=>{if(pumping===work)pumping=undefined;}).catch(()=>{});
 return work;
}
function clockSnapshot(){try{return Native?.axonClockSnapshot?.();}catch{return undefined;}}
const pending=new Map<string,{work:Promise<MessageWakeRecoveryOutcome|void>;envelope?:CustodyEnvelope;listeners:Set<(milestone:string)=>void>}>();
/** Only verified wakes reach this bounded recovery path; locked-account policy is preserved. */
export function recoverRootMessage(account:string,_sender:string,_id:string,expires:number,progress?:(milestone:string)=>void,envelope?:CustodyEnvelope,custodian?:string,payload?:GroupCustodyPayload,jobToken?:string){
 const requestedPeer=configuredWakeCustodian(custodian)?.account;
 const key=JSON.stringify([account,_sender,_id,requestedPeer]),previous=pending.get(key);
 // Repeated hints share work, but an inline payload arriving after a metadata-only
 // hint still gets its own admission opportunity. A routed hint must never
 // inherit the outcome of a hint that could not reach that custodian.
 if(previous&&(!envelope||JSON.stringify(previous.envelope)===JSON.stringify(envelope))){
  if(progress)previous.listeners.add(progress);return previous.work;
 }
 const listeners=new Set<(milestone:string)=>void>();if(progress)listeners.add(progress);
 const notify=(milestone:string)=>{for(const listener of listeners){try{listener(milestone);}catch{/* Diagnostics must not stop recovery. */}}};
 const result=Promise.resolve().then(async():Promise<MessageWakeRecoveryOutcome|void>=>{
  if(expires<=Date.now())return;
  if(localAccount.status().account&&localAccount.status().account!==account)return;
  await startLocalAccount();
  if(expires<=Date.now())return;
  if(localAccount.status().account!==account)return;
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)return;
  const currentJob=()=>!jobToken||Native?.messageRecoveryCurrent?.(jobToken)===true;
  if(!currentJob())return;
  notify('account-ready');
  const background=AppState.currentState!=='active';if(background&&!Native?.axonMessageWake)return;
  const peer=background?requestedPeer:undefined;
  const route=background?(peer?'configured':custodian?'unsupported':'missing'):'foreground';
  console.info('[Axonic recovery route]',{route,inline:!!envelope,headlessJob:!!jobToken});
  if(background&&!peer&&!envelope){
   try{deliveryDiagnosticEvent(account,_sender,_id,'recovery_finished',{reason:'route_unavailable',route});}catch{/* Observation cannot prevent the recovery notice. */}
   return 'route-unavailable';
  }
  const budgetMs=jobToken?120000:20000;
  const started=Date.now(),until=Math.min(expires,started+budgetMs),clocks=clockSnapshot();
  let setupMs=0,waitLagMs=0,reason='error',waitReason='setup',attachmentState:string|undefined;
  let targetProgressAt=started,attachmentCursor=-1,streamBytes=0,receiptSeen=false,mediaSeen=false,checkedAdmittedContent=false;
  let network:ReturnType<typeof startLocalAccountNetwork>|undefined,releaseLease:(()=>void)|undefined;
  const offEvents:(()=>void)[]=[];
  const events=typeof subscribeRootChatCommitted==='function'&&typeof subscribeAttachmentJobProgress==='function';
  try{
   if(events){
    offEvents.push(subscribeRootChatCommitted(owner=>{if(owner===account)recoveryChanged();}));
    offEvents.push(subscribeAttachmentJobProgress(job=>{
     if(job.owner!==account||job.id!==_id)return;
     if(job.cursor>attachmentCursor){attachmentCursor=job.cursor;targetProgressAt=Date.now();}
     if(['complete','expired','cancelled'].includes(job.phase))recoveryChanged();
    }));
    offEvents.push(subscribeAttachmentReceiveProgress((owner,id,bytes)=>{
     if(owner===account&&id===_id&&bytes>streamBytes){streamBytes=bytes;targetProgressAt=Date.now();}
    }));
    offEvents.push(localAccount.subscribe(recoveryChanged));
   }
   try{deliveryDiagnosticEvent(account,_sender,_id,'recovery_started');}catch{/* Observation cannot prevent recovery. */}
   // A foreground wake can become a background task during this lease.
   // Grant it now rather than relying on the app state captured before recovery.
   console.info('[Axonic recovery] grant');releaseLease=acquireMessageWakeLease();console.info('[Axonic recovery] granted');
   network=startLocalAccountNetwork(background?{custodian:peer}:undefined);
   if(network.subscribeRecovery)offEvents.push(network.subscribeRecovery((sender,id)=>{if(sender===_sender&&id===_id)recoveryChanged();}));
   // Start inline admission and the authenticated inbox in the same wake. The
   // ledger serializes racing copies, and the relay still requires a signed receipt.
   const inline=envelope?network.receiveWakeEnvelope(envelope,background?peer:custodian,payload).catch(()=>null):undefined;
   if(Date.now()<until&&currentJob()){
    if(peer)network.resumeRecovery(peer);
    else if(!background)network.resume();
    if(peer||!background)console.info('[Axonic recovery] resumed');
   }
   const inlinePersisted=!!(await inline);
   if(inlinePersisted)notify('inline-persisted');
   // Fixed, content-free outcome; a wake arriving is not proof its ciphertext
   // was admitted. Media bytes still require the attachment worker separately.
   console.info('[Axonic recovery payload]',inlinePersisted?'inline-persisted':'fetch-required');
   setupMs=Math.max(0,Date.now()-started);
   targetProgressAt=Date.now();
   // Inline persistence is not interrupted. It consumes this recovery budget,
   // rather than granting another 20 seconds after a slow storage transaction.
   if(background&&!peer){
    if(!currentJob()||localAccount.status().account!==account)return;
    if(inlinePersisted&&await network.hasRecoveredContent(_sender,_id)){reason='inline_complete';return;}
    reason='route_unavailable';return 'route-unavailable';
   }
   reason='deadline';
   while(Date.now()<until&&currentJob()&&localAccount.status().state==='unlocked'&&localAccount.status().account===account){
    // Only authenticated sessions count; dialing/retries are not progress.
    for(const session of network.snapshot?.().sessions??[])if(session.state==='connected'&&session.account)notify('connected:'+session.account);
    // Inbox persistence precedes the signed receipt exchange. This wake owns a
    // lease for its target, not for unrelated relay inboxes or outgoing work.
    // Other wakes retain their own leases; target media still gates completion.
    // Unknown/older runtimes retain the existing bounded fallback.
    waitReason='receipt';
    const receiptConfirmed=network.recoveryComplete?.(_sender,_id);
    attachmentState=receiptConfirmed||jobToken?await network.attachmentRecoveryState?.(_sender,_id):undefined;
    if(receiptConfirmed&&(!attachmentState||attachmentState==='complete')){reason='receipt_complete';break;}
    if(receiptConfirmed&&attachmentState==='descriptor-missing'&&!checkedAdmittedContent){
     // The attachment index omits plain text. Check the exact committed inbox
     // entry once, so receipt-confirmed text can release the Android wake job.
     checkedAdmittedContent=true;
     if(await network.hasRecoveredContent(_sender,_id)){reason='receipt_complete';break;}
    }
    const pendingAttachment=attachmentState!==undefined&&!['complete','descriptor-missing','snapshot-unavailable','policy-held'].includes(attachmentState);
    if(pendingAttachment)mediaSeen=true;
    if(receiptConfirmed||pendingAttachment||receiptSeen&&attachmentState==='complete'){
     if(!receiptSeen){receiptSeen=true;targetProgressAt=Date.now();}
     waitReason='attachment';
    }
    // The custodian can wake us as soon as the descriptor is held. Its bytes
    // may still be uploading, and the custodian currently sends no second wake
    // when that upload finishes. Keep the bounded Android job on this route
    // once the verified local descriptor has eligible media. The relay ACK
    // can arrive independently of local admission and attachment recovery.
    const awaitingMedia=!!jobToken&&mediaSeen&&waitReason==='attachment';
    if(background&&!awaitingMedia&&Date.now()-targetProgressAt>=TARGET_IDLE_MS){reason='custodian_stalled';break;}
    waitLagMs=Math.max(waitLagMs,await pump(network,events));
   }
   if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)reason='account_changed';
   else if(!currentJob())reason='job_stopped';
   if(background&&(reason==='custodian_stalled'||reason==='deadline')&&Date.now()<expires
     &&!await network.hasRecoveredContent(_sender,_id))return 'stalled';
  }catch(error){reason='error';throw error;}
  finally{
   for(const off of offEvents)off();
   // Finish this message’s presentation before releasing its headless lease.
   try{await network?.waitForMessagePresentation?.(account,_sender,_id);}catch{/* Delivery is already committed. */}
   // Release operational resources BEFORE best-effort observations. A throwing
   // snapshot/journal must never strand a shared network or native wake lease.
   try{network?.stop();}finally{releaseLease?.();}
   try{
    const end=clockSnapshot(),milliseconds=clocks&&end?Math.max(0,end.elapsedMs-clocks.elapsedMs):Math.max(0,Date.now()-started);
    const waiting=reason==='deadline'||reason==='custodian_stalled'?{waitReason,...(attachmentState?{attachmentState}:{})}:{};
    console.info('[Axonic recovery timing]',{milliseconds,setupMs,waitLagMs,reason,route,...waiting});
    deliveryDiagnosticEvent(account,_sender,_id,'recovery_finished',{milliseconds,setupMs,waitLagMs,budgetMs,overrunMs:Math.max(0,milliseconds-budgetMs),reason,route,...waiting,
     ...(clocks&&end?{sleepMs:Math.max(0,milliseconds-(end.uptimeMs-clocks.uptimeMs)),processCpuMs:Math.max(0,end.processCpuMs-clocks.processCpuMs)}:{})});
   }catch{/* Diagnostics cannot change delivery or cleanup. */}
  }
 });const entry={work:result,envelope,listeners};pending.set(key,entry);
 void result.finally(()=>{if(pending.get(key)===entry)pending.delete(key);listeners.clear();}).catch(()=>{});
 return result;
}
