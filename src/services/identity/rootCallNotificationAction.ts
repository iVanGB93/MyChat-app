import AsyncStorage from '@react-native-async-storage/async-storage';
import {validAccountId} from './identityProtocol';
const KEY='@axonic_call_notification_action_v1';
const listeners=new Set<()=>void>();
export function subscribeRootCallNotificationAction(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export async function queueRootCallNotificationAction(action:string,data:unknown){
 if(!['root-call-answer','root-call-decline'].includes(action))return false;
 const d=data as {type?:string;account?:string;callId?:string};
 if(d?.type!=='root_neuron_call'||!validAccountId(d.account)||typeof d.callId!=='string'||!/^[a-f0-9]{64}$/.test(d.callId))return false;
 await AsyncStorage.setItem(KEY,JSON.stringify({action,account:d.account,callId:d.callId,at:Date.now()}));
 for(const fn of listeners)fn();return true;
}
export async function takeRootCallNotificationAction(account:string,id:string){
 const raw=await AsyncStorage.getItem(KEY);if(!raw)return null;
 const value=JSON.parse(raw);
 if(value.account!==account||value.callId!==id)return null;
 await AsyncStorage.removeItem(KEY);
 return Number.isFinite(value.at)&&Date.now()-value.at>=0&&Date.now()-value.at<60000&&['root-call-answer','root-call-decline'].includes(value.action)?value.action as string:null;
}
