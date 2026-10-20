import {rootChatView} from './rootChatActions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {validAccountId} from './identityProtocol';
const listeners=new Set<()=>void>();
export function subscribeRootNotificationOpen(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
let tail:Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>){const work=tail.then(fn);tail=work.catch(()=>{});return work;}
const KEY='@axonic_root_notification_open_v1';
let visible:{peer?:string;group?:string}|null=null;
export function setRootVisibleConversation(value:typeof visible){visible=value;}
export function rootConversationVisible(sender:string,group?:string){return group?visible?.group===group:visible?.peer===sender;}
export type RootNotificationTarget={account:string;sender:string;group?:string;hintId?:string;inbox?:boolean;unavailable?:'not_received'|'removed'|'group_unknown'};
export function rootNotificationTarget(data:unknown):RootNotificationTarget|null{
 const d=data as {type?:string;account?:string;sender?:string;group?:string;hintId?:string;inbox?:boolean};
 return d?.type==='root_neuron_message'&&validAccountId(d.account)&&validAccountId(d.sender)&&(d.group===undefined||/^[a-f0-9]{64}$/.test(d.group))?{account:d.account,sender:d.sender,...(d.group?{group:d.group}:{}),...(typeof d.hintId==='string'&&/^[a-f0-9]{64}$/.test(d.hintId)?{hintId:d.hintId}:{})}:null;
}
export async function queueRootNotificationOpen(data:unknown){
 const d=data as {messageId?:string;messageAt?:string;messagePreviews?:string};
 const target=rootNotificationTarget(data);
 if(target){
  // Legacy generic alerts have a message ID but no decrypted preview metadata.
  if(d.messageId&&!d.messageAt&&!d.messagePreviews&&/^[a-f0-9]{64}$/.test(d.messageId))target.hintId=d.messageId;
  await serial(()=>AsyncStorage.setItem(KEY,JSON.stringify(target)));
  for(const fn of listeners)try{fn();}catch{};
 }
}
export async function pendingRootNotificationOpen(account:string){
 const raw=await AsyncStorage.getItem(KEY);if(!raw)return null;
 const target=rootNotificationTarget({type:'root_neuron_message',...JSON.parse(raw)});if(target?.account!==account)return null;
 if(!target.hintId)return target;
 // A signed wake identifies a delivery, not its conversation or unread status.
 const saved=await ownChatStore(account).read();
 const state=saved?JSON.parse(saved):null;
 const message=state?.version===1&&Array.isArray(state.messages)?state.messages.find((m:{id:string;peer:string;direction:string})=>m.id===target.hintId&&m.peer===target.sender&&m.direction==='incoming'):null;
 if(!message)return {...target,inbox:true,unavailable:'not_received' as const};
 if(message.deleted)return {...target,inbox:true,unavailable:'removed' as const};
 const current=rootChatView(account,{...state,messages:[message]}).messages[0];
 if(current.deleted)return {...target,inbox:true,unavailable:'removed' as const};
 const group=message.group?.id;
 if(group&&!state.groups?.some((g:{id:string})=>g.id===group))return {...target,inbox:true,unavailable:'group_unknown' as const};
 return {...target,...(group?{group}:{} )};
}
export async function finishRootNotificationOpen(expected?:RootNotificationTarget){await serial(async()=>{if(expected){const raw=await AsyncStorage.getItem(KEY);if(!raw)return;const actual=JSON.parse(raw);if(actual.account!==expected.account||actual.sender!==expected.sender||actual.hintId!==expected.hintId||actual.hintId===undefined&&actual.group!==expected.group)return;}await AsyncStorage.removeItem(KEY);});}
import {ownChatStore} from '../../modules/storage/chatStore';
