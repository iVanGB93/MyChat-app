import {AppState} from 'react-native';
import Native from '../../../modules/axonic-nearby';
import {localAccount,localAccountSession} from './localAccount';
import {localRootChat} from './localRootChat';
import {startLocalAccountNetwork} from './localAccountNetwork';
let tail:Promise<unknown>=Promise.resolve();
/** Only verified wakes reach this bounded recovery path; locked-account policy is preserved. */
export function recoverRootMessage(account:string,sender:string,id:string,expires:number){
 const result=tail.then(async()=>{
  if(expires<=Date.now())return;
  if(!localAccount.status().account)await localAccount.inspect();
  if(localAccount.status().account!==account)return;
  if(localAccount.status().state==='locked')await localAccountSession.initialize();
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)return;
  const background=AppState.currentState!=='active';if(background&&!Native?.axonMessageWake)return;
  let network:ReturnType<typeof startLocalAccountNetwork>|undefined;
  try{
   console.info('[Axonic recovery] grant');if(background)Native!.axonMessageWake!(30000);console.info('[Axonic recovery] granted');
   network=startLocalAccountNetwork();network.resume();console.info('[Axonic recovery] resumed');const until=Math.min(expires,Date.now()+20000);
   while(Date.now()<until&&localAccount.status().state==='unlocked'&&localAccount.status().account===account){
    // Inbox persistence precedes the signed receipt exchange. Keep the bounded
    // lease alive so the courier can finish that exchange and drain queued mail.
    network.tick();
    if(background&&Native?.axonMessageWait)await Native.axonMessageWait(300);
    else await new Promise(resolve=>setTimeout(resolve,300));
   }
  }finally{console.info('[Axonic recovery] status',JSON.stringify({delivery:network?.recoveryStatus?.(),connections:network?.snapshot?.().pool?.connections.map(c=>({route:c.route,state:c.state})),retrying:network?.snapshot?.().pool?.retrying}));console.info('[Axonic recovery] releasing');network?.stop();console.info('[Axonic recovery] runtime-released');if(background)Native?.axonMessageWake?.(0);console.info('[Axonic recovery] released');}
 });tail=result.catch(()=>{});return result;
}
