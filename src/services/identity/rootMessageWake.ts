import {deliveryDiagnosticEvent} from '../mobileDeliveryDiagnostics';
import {createMessageNotificationDeadline} from './messageNotificationDeadline';
import {rootMessageNotificationId,currentRootMessageNotification,cancelRootMessageNotification} from './rootMessageNotification';
import {publishRootMessageToast} from './rootMessageToast';
import {readRootNotificationPreferences} from './rootNotificationPreferences';
import {localAccount} from './localAccount';
import Native from '../../../modules/axonic-nearby';
import {rootConversationVisible} from './rootNotificationRoute';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {AppState} from 'react-native';
import notifee,{AndroidImportance,AndroidVisibility,AndroidStyle} from '@notifee/react-native';
import {validAccountId} from './identityProtocol';
import {verifyCustodyWake} from './custodyProtocol';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {rootWakeContext,rootWakeBlocked} from './rootCallWake';

function setStage(stage:string){console.info('[Axonic message wake]',stage);}
export const rootMessageWakeFailed=()=>{setStage('failed');};
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const result=tail.then(work);tail=result.catch(()=>{});return result;}
function db(){return opening??=SQLite.openDatabaseAsync('axonic_root_message_wakes_v1.db',{useNewConnection:true}).then(async value=>{
 await value.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS notices(owner TEXT NOT NULL,sender TEXT NOT NULL,id TEXT NOT NULL,expires INTEGER NOT NULL,displayed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,sender,id)); CREATE INDEX IF NOT EXISTS notices_expiry ON notices(expires);');return value;
}).catch(error=>{opening=undefined;throw error;});}
async function muted(owner:string,sender:string,group?:string){
 const raw=await AsyncStorage.getItem('@axonic_root_chat_v1:'+owner);if(!raw)return false;
 const state=JSON.parse(raw);if(state.version!==1||!Array.isArray(state.contacts))throw Error('Contact policy unavailable');
 return !!group&&state.groups?.some((g:{id:string;muted?:boolean})=>g.id===group&&g.muted===true)||state.contacts.some((c:{account:string;muted?:boolean})=>c.account===sender&&c.muted===true);
}
async function unresolvedMutedGroup(owner:string,sender:string){
 const raw=await AsyncStorage.getItem('@axonic_root_chat_v1:'+owner);if(!raw)return false;
 const state=JSON.parse(raw);return Array.isArray(state.groups)&&state.groups.some((g:{muted?:boolean;members?:string[]})=>g.muted===true&&g.members?.includes(sender));
}
async function messageChannel(sound:boolean){
 // Android channel sound is immutable. The old channel was created without one.
 // Retain an explicit OS block instead of bypassing it with the corrected channel.
 const old=await notifee.getChannel('root-messages-v1');
 if(old?.blocked||old?.importance===0)return 'root-messages-v1';
 const id=sound?'root-messages-audible-v2':'root-messages-silent-v2';
 await notifee.createChannel({id,name:sound?'Messages':'Messages (silent)',importance:old?.importance??AndroidImportance.HIGH,
  ...(sound?{sound:old?.soundURI||'default'}:{}),vibration:sound});
 return id;
}
async function alreadyReceived(owner:string,sender:string,id:string){
 const raw=await AsyncStorage.getItem('@axonic_root_chat_v1:'+owner);if(!raw)return false;
 const ledger=JSON.parse(raw);if(ledger.version!==1||!Array.isArray(ledger.messages))throw Error('Chat state unavailable');
 return [...ledger.messages,...(ledger.actions??[]),...(ledger.groupActions??[]),...(ledger.removedMessages??[])] .some((m:{id:string;peer:string;direction:string})=>m.id===id&&m.peer===sender&&m.direction==='incoming')||(ledger.groupSeen??[]).some((m:{id:string;peer:string})=>m.id===id&&m.peer===sender);
}
/** A stalled account/network startup must not withhold an already authenticated alert. */
async function waitForRecovery(work:Promise<void>,ms:number,remaining?:()=>number){
 // React Native frame timers may stop with the display off. Native completions
 // still reach the headless task while its FCM execution window is active.
 if(Native?.axonMessageWait){
  let finished=false;const until=Date.now()+ms;
  const deadline=(async()=>{while(!finished&&Date.now()<until&&(!remaining||remaining()>0)){
   await Native.axonMessageWait!(Math.max(1,Math.min(500,until-Date.now(),remaining?.()??ms)));
  }})();
  try{await Promise.race([work,deadline]);}finally{finished=true;}
  return;
 }
 let timer:ReturnType<typeof setTimeout>|undefined,finished=false;
 const until=Date.now()+ms;
 const deadline=(async()=>{while(!finished&&Date.now()<until&&(!remaining||remaining()>0))await new Promise<void>(resolve=>{timer=setTimeout(resolve,Math.max(1,Math.min(500,until-Date.now(),remaining?.()??ms)));});})();
 try{await Promise.race([work,deadline]);}
 finally{finished=true;if(timer!==undefined)clearTimeout(timer);}
}
/** Signed hint only. Private keys and message content remain unavailable until local unlock. */
export async function receiveRootMessageWake(data:unknown,recover?:(account:string,sender:string,id:string,expires:number,progress?:(milestone:string)=>void)=>Promise<void>){
 setStage('context');
 const d=data as {type?:string;event?:string};if(d?.type!=='neuron_message'||typeof d.event!=='string'||d.event.length>2048)return;
 let sender:string;try{sender=JSON.parse(d.event).sender;}catch{return;}if(!validAccountId(sender))return;
 const owner=await rootWakeContext();if(!owner||await rootWakeBlocked(owner.account,sender))return;
 const record=await createMobileIdentityRecordStore(Date.now).read(sender);
 const event=record&&verifyCustodyWake(data,record,owner.account,owner.device,Date.now());if(!event)return;setStage('recovery');deliveryDiagnosticEvent(owner.account,sender,event.id,'wake_verified');
 const deadline=createMessageNotificationDeadline();
 const recovery=Promise.resolve().then(()=>recover?.(owner.account,sender,event.id,event.expires,deadline.progress)).then(()=>{},()=>{setStage('recovery-failed');});
 // Three seconds without new progress, capped at ten seconds overall. A preview
 // publishes independently; retries and repeated milestones cannot extend this.
 await waitForRecovery(recovery,10000,deadline.remaining);
 await serial(async()=>{
  const current=await rootWakeContext();if(current?.account!==owner.account||current.device!==owner.device||event.expires<=Date.now())return;
  const database=await db();let admitted=false,previouslyAlerted=false;
  await database.withExclusiveTransactionAsync(async tx=>{
   await tx.runAsync('DELETE FROM notices WHERE expires<=?',Date.now());
   const prior=await tx.getFirstAsync<{displayed:number}>('SELECT displayed FROM notices WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);
   if(prior?.displayed){previouslyAlerted=prior.displayed===1;setStage('already-notified');return;}
   if(!prior){
    await tx.runAsync('INSERT INTO notices(owner,sender,id,expires) VALUES(?,?,?,?)',owner.account,sender,event.id,event.expires);}
   admitted=true;
  });
  if(!admitted){
   // A repeated relay hint may outlive its inbox delivery. Retire only the
   // matching generic alert; never erase a decrypted preview or a newer hint.
   if(previouslyAlerted&&await alreadyReceived(owner.account,sender,event.id)){
    const current=await currentRootMessageNotification(owner.account,sender);
    if(!current?.data?.messagePreviews)await cancelRootMessageNotification(owner.account,sender,event.id);
   }
   return;
  }
  const id=rootMessageNotificationId(owner.account,sender);
  const suppress=await alreadyReceived(owner.account,sender,event.id)||await rootWakeBlocked(owner.account,sender)||await muted(owner.account,sender);
  if(suppress||AppState.currentState==='active'){
   setStage(suppress?'policy-or-received':'foreground');
   await database.runAsync('UPDATE notices SET displayed=1 WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);
   if(suppress)await cancelRootMessageNotification(owner.account,sender,event.id);return;
  }
  const latest=await rootWakeContext();if(latest?.account!==owner.account||latest.device!==owner.device||event.expires<=Date.now())return;
  const preferences=await readRootNotificationPreferences(owner.account);if(!preferences.messages)return;
  // Until decryption identifies the conversation, do not ring for a possibly muted group.
  // Keep the hint pending: verified direct-message previews still notify normally.
  if(await unresolvedMutedGroup(owner.account,sender))return;
  const channelId=await messageChannel(preferences.sound);
  // A metadata-only hint must not replace an already decrypted preview.
  if(await currentRootMessageNotification(owner.account,sender)){
   await database.runAsync('UPDATE notices SET displayed=1 WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);return;
  }
  setStage('generic');
  deliveryDiagnosticEvent(owner.account,sender,event.id,'notification_requested');
  await notifee.displayNotification({id,title:'Axonic',body:'You may have new messages. Open Axonic to check.',
   data:{type:'root_neuron_message',account:owner.account,sender,messageId:event.id},
   android:{channelId,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,smallIcon:'notification_icon',
    pressAction:{id:'root-message-open',launchActivity:'default'},timeoutAfter:Math.max(1,event.expires-Date.now())}});
  await database.runAsync('UPDATE notices SET displayed=1 WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);
 });
 // Keep the headless task alive for bounded recovery after the alert is visible.
 await waitForRecovery(recovery,25000);
}
/** Invoked only after durable inbox admission, including direct delivery racing a delayed hint. */
export type RootMessagePreview={orderId?:string;name:string;text:string;at:number;group?:string;read?:boolean;senderName?:string};
type NotificationMessage={orderId?:string;id:string;sender:string;name:string;text:string;at:number};
function notificationMessages(raw:unknown,next:NotificationMessage){
 let messages:NotificationMessage[]=[];
 try{const parsed=typeof raw==='string'?JSON.parse(raw):null;
  if(Array.isArray(parsed))messages=parsed.filter(m=>typeof m?.id==='string'&&typeof m.sender==='string'&&(m.orderId===undefined||typeof m.orderId==='string'&&/^[a-f0-9]{64}$/.test(m.orderId))&&typeof m.name==='string'&&typeof m.text==='string'&&Number.isFinite(m.at));
 }catch{/* An older client has no retained previews. */}
 messages=messages.filter(m=>m.id!==next.id||m.sender!==next.sender);
 messages.push(next);
 // Match Android MessagingStyle's retained-message limit and keep Binder payloads bounded.
 return messages.sort((a,b)=>a.at-b.at||((a.orderId??a.id)<(b.orderId??b.id)?-1:(a.orderId??a.id)>(b.orderId??b.id)?1:0)||(a.sender<b.sender?-1:a.sender>b.sender?1:0)).slice(-25);
}
export async function finishRootMessageWake(owner:string,sender:string,id:string,preview?:RootMessagePreview){
 await serial(async()=>{
  const database=await db(),key=rootMessageNotificationId(owner,sender,preview?.group),current=await rootWakeContext();
  if(current?.account!==owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
  const preferences=await readRootNotificationPreferences(owner);
  const quiet=!preferences.messages||!preview||preview.read||await rootWakeBlocked(owner,sender)||await muted(owner,sender,preview?.group)||(AppState.currentState==='active'&&rootConversationVisible(sender,preview.group));
  if(quiet){if(preview?.group)await cancelRootMessageNotification(owner,sender,id);await database.runAsync('UPDATE notices SET displayed=2 WHERE owner=? AND sender=? AND id=?',owner,sender,id);await cancelRootMessageNotification(owner,sender,id,preview?.group);return;}
  const prior=await database.getFirstAsync<{displayed:number}>('SELECT displayed FROM notices WHERE owner=? AND sender=? AND id=?',owner,sender,id);if(prior?.displayed===2)return;
  await database.runAsync('DELETE FROM notices WHERE expires<=?',Date.now());
  if(AppState.currentState==='active'&&publishRootMessageToast({account:owner,sender,...(preview.group?{group:preview.group}:{}),name:preview.name,text:preview.text})){
   await cancelRootMessageNotification(owner,sender,id,preview?.group);setStage('preview');
   await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);return;
  }
  const channelId=await messageChannel(preferences.sound);
  // An unlock may end while the OS channel is being created.
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)return;
  // Group membership is known only after decryption; retire this message's generic hint.
  if(preview.group)await cancelRootMessageNotification(owner,sender,id);
  const existing=await currentRootMessageNotification(owner,sender,preview.group);
  // Preserve the last preview when updating a notice created by the previous client.
  const previous=existing?.data?.messagePreviews??(existing?.body&&existing.data?.messageId&&existing.data.sender&&Number.isFinite(Number(existing.data.messageAt))?JSON.stringify([{id:existing.data.messageId,sender:existing.data.sender,name:existing.title||preview.name,text:existing.body,at:Number(existing.data.messageAt)}]):undefined);
  const messages=notificationMessages(previous,{id,...(preview.orderId?{orderId:preview.orderId}:{}),sender,name:preview.senderName||preview.name,text:preview.text,at:preview.at}),latest=messages[messages.length-1];
  await notifee.displayNotification({id:key,title:preview.name,body:latest.text,data:{type:'root_neuron_message',account:owner,sender:latest.sender,messageId:latest.id,messageAt:String(latest.at),messagePreviews:JSON.stringify(messages),...(preview.group?{group:preview.group}:{})},
   android:{channelId,onlyAlertOnce:existing?.data?.messageId===latest.id,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,smallIcon:'notification_icon',color:'#7C3AED',
    pressAction:{id:'root-message-open',launchActivity:'default'},actions:[{title:'Reply',pressAction:{id:'root-reply'},input:{allowFreeFormInput:true,placeholder:'Reply…'}},{title:'Mark as read',pressAction:{id:'root-mark-read'}}],style:{type:AndroidStyle.MESSAGING,person:{name:'You'},group:!!preview.group,...(preview.group?{title:preview.name}:{}),messages:messages.map(m=>({text:m.text,timestamp:m.at,person:{name:m.name,key:m.sender}}))}}});
  await Native?.notificationReadActionInShade?.(key);
  deliveryDiagnosticEvent(owner,sender,id,'notification_requested');
  if(AppState.currentState==='active'&&rootConversationVisible(sender,preview.group))await cancelRootMessageNotification(owner,sender,id,preview.group);
  setStage('preview');
  await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);
 });
}
