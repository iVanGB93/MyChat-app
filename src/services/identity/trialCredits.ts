import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
export type TrialObservation={kind:'relay-receipt'|'media-receipt'|'relay-use';reference:string};
type TrialEvent=TrialObservation|{kind:'trial-top-up';reference:string};
export const trialReference=(sender:string,id:string,recipient:string)=>bytesToHex(sha256(utf8ToBytes(JSON.stringify([sender,id,recipient]))));
export interface TrialTransaction {get(key:string):unknown;put(key:string,value:unknown):void}
export interface TrialStore {transaction<T>(work:(tx:TrialTransaction)=>T):Promise<T>}
export type TrialBalance={version:1;balance:number;earned:number;spent:number;topUps:number;entries:number;allowance:100};
const initial=():TrialBalance=>({version:1,balance:100,earned:0,spent:0,topUps:0,entries:1,allowance:100});
function checked(raw:unknown):TrialBalance{const s=raw as TrialBalance,topUps=s?.topUps??0;if(!s||s.version!==1||s.allowance!==100||![s.balance,s.earned,s.spent,s.entries,topUps].every(Number.isSafeInteger)||s.earned<0||s.spent<0||topUps<0||topUps%50!==0||s.entries!==1+s.earned+s.spent+topUps/50||s.balance!==100+s.earned-s.spent+topUps)throw Error('Trial ledger requires review');return {version:1,balance:s.balance,earned:s.earned,spent:s.spent,topUps,entries:s.entries,allowance:100};}
/** Indexed, append-only observations + an atomic materialized balance. No scans or timers.
 * This ledger is provisional local accounting, not consensus or redeemable value. */
export function createTrialCredits(store:TrialStore,changed:()=>void=()=>{},now=Date.now){
 let cached:TrialBalance|null=null,status:'loading'|'ready'|'unavailable'='loading';
 const notify=()=>{try{changed();}catch{}};
 async function apply(event?:TrialEvent){try{const result=await store.transaction(tx=>{
  const raw=tx.get('balance');let state:TrialBalance;
  if(raw==null){if(tx.get('allowance:v1'))throw Error('Trial balance missing');state=initial();tx.put('allowance:v1',{version:1,kind:'allowance',amount:100,at:now()});tx.put('balance',state);}else {if(!tx.get('allowance:v1'))throw Error('Trial allowance missing');state=checked(raw);}
  if(event){if(!['relay-receipt','media-receipt','relay-use','trial-top-up'].includes(event.kind)||!/^[a-f0-9]{64}$/.test(event.reference))throw Error('Invalid trial observation');
   const key=event.kind+':'+event.reference;
   if(!tx.get(key)){const topUp=event.kind==='trial-top-up',amount=topUp?50:event.kind==='relay-use'?-1:1;state={...state,balance:state.balance+amount,earned:state.earned+(topUp?0:Math.max(0,amount)),topUps:state.topUps+(topUp?50:0),spent:state.spent+Math.max(0,-amount),entries:state.entries+1};checked(state);tx.put(key,{version:1,kind:event.kind,reference:event.reference,amount,at:now(),evidence:topUp?'trial-top-up':'local-observation'});tx.put('balance',state);}
  }return state;
 });cached=result;status='ready';notify();return true;}catch{status='unavailable';notify();return false;}}
 // Serialize observations even if an adapter exposes concurrent transactions.
 let tail=Promise.resolve(true);const enqueue=(e?:TrialEvent)=>{const copy=e?{...e}:undefined;const run=tail.then(()=>apply(copy));tail=run;return run;};
 return {load:()=>enqueue(),observe:(event:TrialObservation)=>enqueue(event),addTrialCredits:(reference:string)=>enqueue({kind:'trial-top-up',reference}),snapshot:()=>({status,...(cached??{}),trial:true as const,serviceRestricted:false as const,policyVersion:1})};
}
