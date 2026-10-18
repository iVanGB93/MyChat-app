import type {CustodyEnvelope} from './custodyProtocol';
import {AppState} from 'react-native';
import {deliveryDiagnosticEvent} from '../mobileDeliveryDiagnostics';
import Native from '../../../modules/axonic-nearby';
import {localAccount,startLocalAccount} from './localAccount';
import {startLocalAccountNetwork} from '../../composition/neuronRuntime';
import {acquireMessageWakeLease} from './messageWakeLease';
// Wakes share the runtime and native wake window, not a per-message FIFO.
// A missing relay receipt must not delay admission of the next inline message.
let pumping:Promise<void>|undefined;
let lastPumpAt=0;
function pump(network:ReturnType<typeof startLocalAccountNetwork>){
 if(pumping)return pumping;
 const work=Promise.resolve().then(async()=>{
  // Observe receipt completion promptly without rerunning every network service
  // at the 300ms observation cadence. Concurrent hints share this budget.
  const now=Date.now();
  if(now-lastPumpAt>=1000||now<lastPumpAt){lastPumpAt=now;network.tick();}
  if(Native?.axonMessageWait)await Native.axonMessageWait(300);
  else await new Promise<void>(resolve=>setTimeout(resolve,300));
 });
 pumping=work;void work.finally(()=>{if(pumping===work)pumping=undefined;}).catch(()=>{});
 return work;
}
const pending=new Map<string,{work:Promise<void>;envelope?:CustodyEnvelope;listeners:Set<(milestone:string)=>void>}>();
/** Only verified wakes reach this bounded recovery path; locked-account policy is preserved. */
export function recoverRootMessage(account:string,_sender:string,_id:string,expires:number,progress?:(milestone:string)=>void,envelope?:CustodyEnvelope){
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
  deliveryDiagnosticEvent(account,_sender,_id,'recovery_started');
  let network:ReturnType<typeof startLocalAccountNetwork>|undefined,releaseLease:(()=>void)|undefined;
  try{
   // A foreground wake can become a background task during this lease.
   // Grant it now rather than relying on the app state captured before recovery.
   console.info('[Axonic recovery] grant');releaseLease=acquireMessageWakeLease();console.info('[Axonic recovery] granted');
   network=startLocalAccountNetwork();
   // Persist and notify through the normal verified inbox before waiting for a connection.
   // Relay polling still performs the signed receipt exchange, including after a restart.
   if(envelope){try{if(await network.receiveWakeEnvelope(envelope))notify('inline-persisted');}catch{/* Fetch the durable relay copy if inline admission fails. */}}
   network.resume();console.info('[Axonic recovery] resumed');const until=Math.min(expires,Date.now()+20000);
   while(Date.now()<until&&localAccount.status().state==='unlocked'&&localAccount.status().account===account){
    // Only authenticated sessions count; dialing/retries are not progress.
    for(const session of network.snapshot?.().sessions??[])if(session.state==='connected'&&session.account)notify('connected:'+session.account);
    // Inbox persistence precedes the signed receipt exchange. Keep the bounded
    // lease alive so the courier can finish that exchange and drain queued mail.
    // Only a completed relay receipt exchange and drained poll can end recovery.
    // Unknown/older runtimes retain the existing bounded fallback.
    if(network.recoveryComplete?.(_sender,_id))break;
    await pump(network);
   }
  }finally{deliveryDiagnosticEvent(account,_sender,_id,'recovery_finished');console.info('[Axonic recovery] status',JSON.stringify({delivery:network?.recoveryStatus?.(),connections:network?.snapshot?.().pool?.connections.map(c=>({route:c.route,state:c.state})),retrying:network?.snapshot?.().pool?.retrying}));console.info('[Axonic recovery] releasing');try{network?.stop();}finally{releaseLease?.();}console.info('[Axonic recovery] released');}
 });const entry={work:result,envelope,listeners};pending.set(key,entry);
 void result.finally(()=>{if(pending.get(key)===entry)pending.delete(key);listeners.clear();}).catch(()=>{});
 return result;
}
