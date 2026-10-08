import {AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import Native from '../../../modules/axonic-nearby';
import {localAccount,localAccountSession} from './localAccount';
import {localRootChat} from './localRootChat';
import {startLocalAccountNetwork} from './localAccountNetwork';
import {rootNotificationTarget,queueRootNotificationOpen} from './rootNotificationRoute';
import {rootChatView} from './rootChatActions';
let tail:Promise<unknown>=Promise.resolve();
/** OS actions operate only on a message already admitted into this device's own inbox. */
export function handleRootNotificationAction(action:string,data:unknown,input?:string){
 if(!['root-reply','root-mark-read'].includes(action))return Promise.resolve();
 const task=tail.then(async()=>{
  const target=rootNotificationTarget(data),messageId=(data as {messageId?:string})?.messageId;
  if(!target||!messageId||!/^[a-f0-9]{64}$/.test(messageId))return;
  if(!localAccount.status().account)await localAccount.inspect();
  if(localAccount.status().account!==target.account)return;
  if(localAccount.status().state==='locked')await localAccountSession.initialize();
  if(localAccount.status().state!=='unlocked'){await queueRootNotificationOpen(data);return;}
  const current=()=>localAccount.status().state==='unlocked'&&localAccount.status().account===target.account;
  const ledger=localRootChat(),state=rootChatView(target.account,await ledger.snapshot());
  if(!current())return;
  const message=state.messages.find(m=>m.direction==='incoming'&&m.peer===target.sender&&m.id===messageId&&m.group?.id===target.group);
  const contact=state.contacts.find(c=>c.account===target.sender),group=target.group?state.groups?.find(g=>g.id===target.group):undefined;
  if(!message||message.deleted||contact?.blocked||(!target.group&&!contact?.accepted)||(target.group&&(!group?.accepted||group.blocked||!group.members.includes(target.account))))return;
  const text=input?.trim()??'';
  if(action==='root-reply'&&(!text||new TextEncoder().encode(text).length>1600))return;
  const key='@axonic_root_notice_actions_v1:'+target.account;
  const raw=await AsyncStorage.getItem(key),saved=raw?JSON.parse(raw):{version:1,rows:[]};
  if(saved.version!==1||!Array.isArray(saved.rows)||saved.rows.length>64||saved.rows.some((r:{key:string;id:string;text:string;done:boolean})=>typeof r.key!=='string'||!/^[a-f0-9]{64}$/.test(r.id)||typeof r.text!=='string'||typeof r.done!=='boolean'))throw Error('Notification action state unavailable');
  const eventKey=action+':'+target.sender+':'+messageId;let record=saved.rows.find((r:{key:string})=>r.key===eventKey);
  if(record?.done)return;
  if(!record){if(saved.rows.length>=64){const i=saved.rows.findIndex((r:{done:boolean})=>r.done);if(i<0)return;saved.rows.splice(i,1);}record={key:eventKey,id:await Native!.identityRandomBytes!(32),text,done:false};saved.rows.push(record);await AsyncStorage.setItem(key,JSON.stringify(saved));}
  if(!current())return;
  if(action==='root-reply'){
   if(target.group)await ledger.enqueueGroup(target.group,record.id,record.text,{id:message.group!.messageId,author:target.sender});
   else await ledger.enqueue(target.sender,record.id,record.text,{id:messageId,author:target.sender});
  }else if(!message.read){
   if(target.group)await ledger.markGroupRead(target.group);
   else await ledger.act(target.sender,record.id,{id:messageId,author:target.sender},'read');
  }
  if(!current())return;
  record.done=true;await AsyncStorage.setItem(key,JSON.stringify(saved));
  await notifee.cancelNotification('root-message:'+target.account+':'+target.sender+':'+messageId);
  // Persist first. The existing delivery queue retains the reply if no peer is reachable.
  const background=AppState.currentState!=='active';if(background&&!Native?.axonMessageWake)return;
  let runtime:ReturnType<typeof startLocalAccountNetwork>|undefined;
  try{if(background)Native!.axonMessageWake!(30000);runtime=startLocalAccountNetwork();if(background)await new Promise(resolve=>setTimeout(resolve,5000));}
  finally{runtime?.stop();if(background)Native?.axonMessageWake?.(0);}
 });tail=task.catch(()=>{});return task;
}
