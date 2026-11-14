import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
export type TrialObservation={kind:'relay-receipt'|'media-receipt'|'relay-use'|'direct-delivery';reference:string;chat?:'private'|'group'};
type TrialEvent=TrialObservation|{kind:'trial-top-up';reference:string;chat?:never};
export const trialReference=(sender:string,id:string,recipient:string)=>bytesToHex(sha256(utf8ToBytes(JSON.stringify([sender,id,recipient]))));
export interface TrialTransaction {get(key:string):unknown;put(key:string,value:unknown):void}
export interface TrialStore {transaction<T>(work:(tx:TrialTransaction)=>T):Promise<T>}
export type TrialBalance={version:1;balance:number;earned:number;spent:number;topUps:number;entries:number;allowance:100};
const initial=():TrialBalance=>({version:1,balance:100,earned:0,spent:0,topUps:0,entries:1,allowance:100});
const initialMetrics=()=>({privateRelayDebits:0,groupRelayDebits:0,directDeliveries:0,zeroBalanceEvents:0,automaticRefills:0,manualRefills:0});
const validEvent=(event:TrialEvent)=>['relay-receipt','media-receipt','relay-use','direct-delivery','trial-top-up'].includes(event.kind)&&/^[a-f0-9]{64}$/.test(event.reference)&&(event.chat===undefined||event.chat==='private'||event.chat==='group');
function checked(raw:unknown):TrialBalance{const s=raw as TrialBalance,topUps=s?.topUps??0;if(!s||s.version!==1||s.allowance!==100||![s.balance,s.earned,s.spent,s.entries,topUps].every(Number.isSafeInteger)||s.earned<0||s.spent<0||topUps<0||topUps%50!==0||s.entries!==1+s.earned+s.spent+topUps/50||s.balance!==100+s.earned-s.spent+topUps)throw Error('Trial ledger requires review');return {version:1,balance:s.balance,earned:s.earned,spent:s.spent,topUps,entries:s.entries,allowance:100};}
/** Indexed, append-only observations + an atomic materialized balance. No scans or timers.
 * This ledger is provisional local accounting, not consensus or redeemable value. */
export function createTrialCredits(store:TrialStore,changed:()=>void=()=>{},now=Date.now){
 let cached:TrialBalance|null=null,status:'loading'|'ready'|'unavailable'='loading';
 let metrics=initialMetrics(),writeFailures=0,recoveredWrites=0,droppedRetries=0;
 const pending=new Map<string,TrialObservation>();
 const notify=()=>{try{changed();}catch{}};
 async function apply(event?:TrialEvent){try{const result=await store.transaction(tx=>{
  const raw=tx.get('balance');let state:TrialBalance;
  if(raw==null){if(tx.get('allowance:v1'))throw Error('Trial balance missing');state=initial();tx.put('allowance:v1',{version:1,kind:'allowance',amount:100,at:now()});tx.put('balance',state);}else {if(!tx.get('allowance:v1'))throw Error('Trial allowance missing');state=checked(raw);}
  const counts={...initialMetrics(),...tx.get('metrics') as Partial<ReturnType<typeof initialMetrics>>|undefined};
  if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid trial metrics');
  let metricsChanged=false;
  if(event){
   const key=event.kind+':'+event.reference;
   if(!tx.get(key)){
    if(event.kind==='direct-delivery'){counts.directDeliveries++;metricsChanged=true;tx.put(key,{version:1,kind:event.kind,at:now()});}
    else{
     const topUp=event.kind==='trial-top-up',amount=topUp?50:event.kind==='relay-use'?-1:1;
     if(topUp){counts.manualRefills++;metricsChanged=true;}
     if(event.kind==='relay-use'){
      if(event.chat){counts[event.chat==='group'?'groupRelayDebits':'privateRelayDebits']++;metricsChanged=true;}
      if(state.balance===1){counts.zeroBalanceEvents++;metricsChanged=true;}
     }
     state=checked({...state,balance:state.balance+amount,earned:state.earned+(topUp?0:Math.max(0,amount)),topUps:state.topUps+(topUp?50:0),spent:state.spent+Math.max(0,-amount),entries:state.entries+1});
     tx.put(key,{version:1,kind:event.kind,reference:event.reference,amount,at:now(),evidence:topUp?'trial-top-up':'local-observation'});tx.put('balance',state);
    }
   }
  }
  // Settle the refill in the same transaction as spending. On first load,
  // bring an older negative ledger above zero in the same 50-credit increments.
  while(state.balance<=0){
   const key='trial-auto-top-up:'+state.entries;
   if(tx.get(key))throw Error('Trial refill already recorded');
   state=checked({...state,balance:state.balance+50,topUps:state.topUps+50,entries:state.entries+1});
   tx.put(key,{version:1,kind:'trial-top-up',amount:50,at:now(),evidence:'automatic-trial-top-up'});
   tx.put('balance',state);
   counts.automaticRefills++;metricsChanged=true;
  }
  if(metricsChanged)tx.put('metrics',counts);
  return {state,counts};
 });cached=result.state;metrics=result.counts;status='ready';return true;}catch{writeFailures++;status='unavailable';return false;}}
 // Serialize observations even if an adapter exposes concurrent transactions.
 let tail=Promise.resolve(true);const enqueue=(e?:TrialEvent)=>{const copy=e?{...e}:undefined;const run=tail.then(async()=>{
  if(copy&&!validEvent(copy))return false;
  // Replay older observations first so their original order determines refills.
  for(const [key,event] of [...pending].slice(0,8)){if(!await apply(event))break;pending.delete(key);recoveredWrites++;}
  const ok=pending.size===0&&await apply(copy);
  if(copy&&copy.kind!=='trial-top-up'){
   const key=copy.kind+':'+copy.reference;
   if(ok){if(pending.delete(key))recoveredWrites++;}
   else if(pending.size<128||pending.has(key))pending.set(key,copy);
   else droppedRetries++;
  }
  notify();return ok;
 });tail=run;return run;};
 return {load:()=>enqueue(),observe:(event:TrialObservation)=>enqueue(event),addTrialCredits:(reference:string)=>enqueue({kind:'trial-top-up',reference}),snapshot:()=>({status,...(cached??{}),metrics:{...metrics,unclassifiedRelayDebits:(cached?.spent??0)-metrics.privateRelayDebits-metrics.groupRelayDebits,unclassifiedRefills:(cached?.topUps??0)/50-metrics.automaticRefills-metrics.manualRefills,writeFailures,recoveredWrites,pendingRetries:pending.size,droppedRetries},trial:true as const,serviceRestricted:false as const,policyVersion:1})};
}
