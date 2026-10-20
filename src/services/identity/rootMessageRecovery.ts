import type {GroupCustodyPayload} from './groupCustodyProtocol';
import type {CustodyEnvelope} from './custodyProtocol';
import {AppState} from 'react-native';
import {deliveryDiagnosticEvent} from '../mobileDeliveryDiagnostics';
import Native from '../../../modules/axonic-nearby';
import {localAccount,startLocalAccount} from './localAccount';
import {startLocalAccountNetwork} from '../../composition/neuronRuntime';
import {acquireMessageWakeLease} from './messageWakeLease';
// Wakes share the runtime and native wake window, not a per-message FIFO.
// A missing relay receipt must not delay admission of the next inline message.
let pumping:Promise<number>|undefined;
let lastPumpAt=0;
function pump(network:ReturnType<typeof startLocalAccountNetwork>){
 if(pumping)return pumping;
 const work=Promise.resolve().then(async()=>{
  // Observe receipt completion promptly without rerunning every network service
  // at the 300ms observation cadence. Concurrent hints share this budget.
  const now=Date.now();
  if(now-lastPumpAt>=1000||now<lastPumpAt){lastPumpAt=now;network.tick();}
  const waitingAt=Date.now();
  if(Native?.axonMessageWait)await Native.axonMessageWait(300);
  else await new Promise<void>(resolve=>setTimeout(resolve,300));
  return Math.max(0,Date.now()-waitingAt-300);
 });
 pumping=work;void work.finally(()=>{if(pumping===work)pumping=undefined;}).catch(()=>{});
 return work;
}
function clockSnapshot(){try{return Native?.axonClockSnapshot?.();}catch{return undefined;}}
const pending=new Map<string,{work:Promise<void>;envelope?:CustodyEnvelope;listeners:Set<(milestone:string)=>void>}>();
/** Only verified wakes reach this bounded recovery path; locked-account policy is preserved. */
export function recoverRootMessage(account:string,_sender:string,_id:string,expires:number,progress?:(milestone:string)=>void,envelope?:CustodyEnvelope,custodian?:string,payload?:GroupCustodyPayload){
 const key=JSON.stringify([account,_sender,_id]),previous=pending.get(key);
 // Repeated hints share work, but an inline payload arriving after a metadata-only
 // hint still gets its own admission opportunity. No durable receipt is skipped.
 if(previous&&(!envelope||JSON.stringify(previous.envelope)===JSON.stringify(envelope))){
  if(progress)previous.listeners.add(progress);return previous.work;
 }
 const listeners=new Set<(milestone:string)=>void>();if(progress)listeners.add(progress);
 const notify=(milestone:string)=>{for(const listener of listeners){try{listener(milestone);}catch{/* Diagnostics must not stop recovery. */}}};
 const result=Promise.resolve().then(async()=>{
  if(expires<=Date.now())return;
  if(localAccount.status().account&&localAccount.status().account!==account)return;
  await startLocalAccount();
  if(expires<=Date.now())return;
  if(localAccount.status().account!==account)return;
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)return;
  notify('account-ready');
  const background=AppState.currentState!=='active';if(background&&!Native?.axonMessageWake)return;
  const started=Date.now(),until=Math.min(expires,started+20000),clocks=clockSnapshot();
  let setupMs=0,waitLagMs=0,reason='error';
  let network:ReturnType<typeof startLocalAccountNetwork>|undefined,releaseLease:(()=>void)|undefined;
  try{
   try{deliveryDiagnosticEvent(account,_sender,_id,'recovery_started');}catch{/* Observation cannot prevent recovery. */}
   // A foreground wake can become a background task during this lease.
   // Grant it now rather than relying on the app state captured before recovery.
   console.info('[Axonic recovery] grant');releaseLease=acquireMessageWakeLease();console.info('[Axonic recovery] granted');
   network=startLocalAccountNetwork();
   // Persist and notify through the normal verified inbox before waiting for a connection.
   // Relay polling still performs the signed receipt exchange, including after a restart.
   if(envelope){try{if(await network.receiveWakeEnvelope(envelope,custodian,payload))notify('inline-persisted');}catch{/* Fetch the durable relay copy if inline admission fails. */}}
   setupMs=Math.max(0,Date.now()-started);
   // Inline persistence is not interrupted. It consumes this recovery budget,
   // rather than granting another 20 seconds after a slow storage transaction.
   if(Date.now()<until){network.resume();console.info('[Axonic recovery] resumed');}
   reason='deadline';
   while(Date.now()<until&&localAccount.status().state==='unlocked'&&localAccount.status().account===account){
    // Only authenticated sessions count; dialing/retries are not progress.
    for(const session of network.snapshot?.().sessions??[])if(session.state==='connected'&&session.account)notify('connected:'+session.account);
    // Inbox persistence precedes the signed receipt exchange. Keep the bounded
    // lease alive so the courier can finish that exchange and drain queued mail.
    // Only a completed relay receipt exchange and drained poll can end recovery.
    // Unknown/older runtimes retain the existing bounded fallback.
    if(network.recoveryComplete?.(_sender,_id)){reason='receipt_complete';break;}
    waitLagMs=Math.max(waitLagMs,await pump(network));
   }
   if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)reason='account_changed';
  }catch(error){reason='error';throw error;}
  finally{
   // Release operational resources BEFORE best-effort observations. A throwing
   // snapshot/journal must never strand a shared network or native wake lease.
   try{network?.stop();}finally{releaseLease?.();}
   try{
    const end=clockSnapshot(),milliseconds=clocks&&end?Math.max(0,end.elapsedMs-clocks.elapsedMs):Math.max(0,Date.now()-started);
    deliveryDiagnosticEvent(account,_sender,_id,'recovery_finished',{milliseconds,setupMs,waitLagMs,overrunMs:Math.max(0,milliseconds-20000),reason,
     ...(clocks&&end?{sleepMs:Math.max(0,milliseconds-(end.uptimeMs-clocks.uptimeMs)),processCpuMs:Math.max(0,end.processCpuMs-clocks.processCpuMs)}:{})});
   }catch{/* Diagnostics cannot change delivery or cleanup. */}
  }
 });const entry={work:result,envelope,listeners};pending.set(key,entry);
 void result.finally(()=>{if(pending.get(key)===entry)pending.delete(key);listeners.clear();}).catch(()=>{});
 return result;
}
