import AsyncStorage from '@react-native-async-storage/async-storage';
import {validAccountId} from './identityProtocol';
const KEY='@axonic_call_notification_action_v1';
const listeners=new Set<()=>void>();
let tail:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const next=tail.then(work);tail=next.catch(()=>{});return next;}
export function subscribeRootCallNotificationAction(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function rootCallNotificationTarget(data:unknown){
 const d=data as {type?:string;account?:string;callId?:string;expiresAt?:string};
 if(d?.type!=='root_neuron_call'||!validAccountId(d.account)||typeof d.callId!=='string'||!/^[a-f0-9]{64}$/.test(d.callId))return null;
 const now=Date.now(),expiresAt=d.expiresAt===undefined?now+60000:Number(d.expiresAt);
 return Number.isSafeInteger(expiresAt)&&expiresAt>now?{account:d.account,callId:d.callId,expiresAt}:null;
}
function currentAction(value:{at:number;expiresAt?:number}){
 const now=Date.now();
 return Number.isFinite(value.at)&&now-value.at>=0&&now-value.at<60000&&
  (value.expiresAt===undefined||Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now);
}
export function hasPendingRootCallDecline(account:string,id:string){return serial(async()=>{
 const raw=await AsyncStorage.getItem(KEY);if(!raw)return false;
 const value=JSON.parse(raw);
 return value.action==='root-call-decline'&&value.account===account&&value.callId===id&&currentAction(value);
});}
export function queueRootCallNotificationAction(action:string,data:unknown){return serial(async()=>{
 if(!['root-call-open','root-call-answer','root-call-decline'].includes(action))return false;
 const d=rootCallNotificationTarget(data);if(!d)return false;
 const previous=await AsyncStorage.getItem(KEY);
 if(action==='root-call-open'&&previous){const prior=JSON.parse(previous);if(prior.account===d.account&&prior.callId===d.callId&&Date.now()-prior.at>=0&&Date.now()-prior.at<60000&&['root-call-answer','root-call-decline'].includes(prior.action))return true;}
 await AsyncStorage.setItem(KEY,JSON.stringify({action,...d,at:Date.now()}));
 for(const fn of listeners)try{fn();}catch{/* The stored action remains available. */}
 return true;
});}
export function takeRootCallNotificationAction(account:string,id:string,canApply=()=>true,expected?:string){return serial(async()=>{
 const raw=await AsyncStorage.getItem(KEY);if(!raw)return null;
 const value=JSON.parse(raw);
 if(value.account!==account||value.callId!==id||(expected&&value.action!==expected)||!canApply())return null;
 await AsyncStorage.removeItem(KEY);
 return currentAction(value)&&
  ['root-call-open','root-call-answer','root-call-decline'].includes(value.action)?value.action as string:null;
});}
