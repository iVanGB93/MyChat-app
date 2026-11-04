import AsyncStorage from '@react-native-async-storage/async-storage';
import {validAccountId} from './identityProtocol';
const KEY='@axonic_call_notification_action_v1';
const listeners=new Set<()=>void>();
let tail:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const next=tail.then(work);tail=next.catch(()=>{});return next;}
export function subscribeRootCallNotificationAction(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function queueRootCallNotificationAction(action:string,data:unknown){return serial(async()=>{
 if(!['root-call-open','root-call-answer','root-call-decline'].includes(action))return false;
 const d=data as {type?:string;account?:string;callId?:string};
 if(d?.type!=='root_neuron_call'||!validAccountId(d.account)||typeof d.callId!=='string'||!/^[a-f0-9]{64}$/.test(d.callId))return false;
 const previous=await AsyncStorage.getItem(KEY);
 if(action==='root-call-open'&&previous){const prior=JSON.parse(previous);if(prior.account===d.account&&prior.callId===d.callId&&Date.now()-prior.at>=0&&Date.now()-prior.at<60000&&['root-call-answer','root-call-decline'].includes(prior.action))return true;}
 await AsyncStorage.setItem(KEY,JSON.stringify({action,account:d.account,callId:d.callId,at:Date.now()}));
 for(const fn of listeners)fn();return true;
});}
export function takeRootCallNotificationAction(account:string,id:string){return serial(async()=>{
 const raw=await AsyncStorage.getItem(KEY);if(!raw)return null;
 const value=JSON.parse(raw);
 if(value.account!==account||value.callId!==id)return null;
 await AsyncStorage.removeItem(KEY);
 return Number.isFinite(value.at)&&Date.now()-value.at>=0&&Date.now()-value.at<60000&&['root-call-open','root-call-answer','root-call-decline'].includes(value.action)?value.action as string:null;
});}
