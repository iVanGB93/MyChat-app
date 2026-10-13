import {AppState} from 'react-native';
import {deliveryDiagnosticEvent} from '../mobileDeliveryDiagnostics';
import Native from '../../../modules/axonic-nearby';
import {localAccount,startLocalAccount} from './localAccount';
import {startLocalAccountNetwork} from '../../composition/neuronRuntime';
let tail:Promise<unknown>=Promise.resolve();
/** Only verified wakes reach this bounded recovery path; locked-account policy is preserved. */
export function recoverRootMessage(account:string,_sender:string,_id:string,expires:number,progress?:(milestone:string)=>void){
 const result=tail.then(async()=>{
  if(expires<=Date.now())return;
  if(localAccount.status().account&&localAccount.status().account!==account)return;
  await startLocalAccount();
  if(localAccount.status().account!==account)return;
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)return;
  progress?.('account-ready');
  const background=AppState.currentState!=='active';if(background&&!Native?.axonMessageWake)return;
  deliveryDiagnosticEvent(account,_sender,_id,'recovery_started');
  let network:ReturnType<typeof startLocalAccountNetwork>|undefined;
  try{
   // A foreground wake can become a background task during this lease.
   // Grant it now rather than relying on the app state captured before recovery.
   console.info('[Axonic recovery] grant');Native?.axonMessageWake?.(30000);console.info('[Axonic recovery] granted');
   network=startLocalAccountNetwork();network.resume();console.info('[Axonic recovery] resumed');const until=Math.min(expires,Date.now()+20000);
   while(Date.now()<until&&localAccount.status().state==='unlocked'&&localAccount.status().account===account){
    // Only authenticated sessions count; dialing/retries are not progress.
    for(const session of network.snapshot?.().sessions??[])if(session.state==='connected'&&session.account)progress?.('connected:'+session.account);
    // Inbox persistence precedes the signed receipt exchange. Keep the bounded
    // lease alive so the courier can finish that exchange and drain queued mail.
    // Only a completed relay receipt exchange and drained poll can end recovery.
    // Unknown/older runtimes retain the existing bounded fallback.
    if(network.recoveryComplete?.(_sender,_id))break;
    network.tick();
    if(Native?.axonMessageWait)await Native.axonMessageWait(300);
    else await new Promise(resolve=>setTimeout(resolve,300));
   }
  }finally{deliveryDiagnosticEvent(account,_sender,_id,'recovery_finished');console.info('[Axonic recovery] status',JSON.stringify({delivery:network?.recoveryStatus?.(),connections:network?.snapshot?.().pool?.connections.map(c=>({route:c.route,state:c.state})),retrying:network?.snapshot?.().pool?.retrying}));console.info('[Axonic recovery] releasing');network?.stop();console.info('[Axonic recovery] runtime-released');Native?.axonMessageWake?.(0);console.info('[Axonic recovery] released');}
 });tail=result.catch(()=>{});return result;
}
