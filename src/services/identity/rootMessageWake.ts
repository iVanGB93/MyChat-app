import {verifyGroupCustodyPayload,matchesGroupGrant,type GroupCustodyPayload} from './groupCustodyProtocol';
import {deliveryDiagnosticEvent} from '../mobileDeliveryDiagnostics';
import {diagnosticJournal} from '../diagnosticJournal';
import {createMessageNotificationDeadline} from './messageNotificationDeadline';
import {rootMessageNotificationId,currentRootMessageNotification,cancelRootMessageNotification} from './rootMessageNotification';
import {publishRootMessageToast} from './rootMessageToast';
import {readRootNotificationPreferences} from './rootNotificationPreferences';
import {localAccount} from './localAccount';
import Native from '../../../modules/axonic-nearby';
import {rootConversationVisible} from './rootNotificationRoute';
import * as SQLite from 'expo-sqlite';
import {AppState} from 'react-native';
import notifee,{AndroidImportance,AndroidVisibility,AndroidStyle} from '@notifee/react-native';
import {validAccountId} from './identityProtocol';
import {verifyCustodyWake,custodyWakeEnvelope,type CustodyEnvelope} from './custodyProtocol';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {rootWakeContext,rootWakeBlocked} from './rootCallWake';
import {validWakeLookup} from './wakeSenderRecovery';
import type {createWakeSenderRecovery} from './wakeSenderRecovery';

function setStage(stage:string){console.info('[Axonic message wake]',stage);}
export const rootMessageWakeFailed=()=>{setStage('failed');if(localAccount.status().state==='unlocked')diagnosticJournal.record('wake_failed');};
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const result=tail.then(work);tail=result.catch(()=>{});return result;}
function db(){return opening??=SQLite.openDatabaseAsync('axonic_root_message_wakes_v1.db',{useNewConnection:true}).then(async value=>{
 await value.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS notices(owner TEXT NOT NULL,sender TEXT NOT NULL,id TEXT NOT NULL,expires INTEGER NOT NULL,displayed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,sender,id)); CREATE INDEX IF NOT EXISTS notices_expiry ON notices(expires);');return value;
}).catch(error=>{opening=undefined;throw error;});}
async function muted(owner:string,sender:string,group?:string){
 const raw=await ownChatStore(owner).read();if(!raw)return false;
 const state=JSON.parse(raw);if(state.version!==1||!Array.isArray(state.contacts))throw Error('Contact policy unavailable');
 return !!group&&state.groups?.some((g:{id:string;muted?:boolean})=>g.id===group&&g.muted===true)||state.contacts.some((c:{account:string;muted?:boolean})=>c.account===sender&&c.muted===true);
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
/** Give bounded recovery time without manufacturing an alert from routing metadata. */
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
/** Signed hint with optional ciphertext. Plaintext remains unavailable until local unlock. */
export async function receiveRootMessageWake(data:unknown,recover?:(account:string,sender:string,id:string,expires:number,progress?:(milestone:string)=>void,envelope?:CustodyEnvelope,custodian?:string,payload?:GroupCustodyPayload)=>Promise<void>,recoverSender?:ReturnType<typeof createWakeSenderRecovery>){
 setStage('context');
 const reject=(reason:string)=>{setStage(reason);diagnosticJournal.record('wake_failed',{reason});};
 const d=data as {type?:string;event?:string};if(d?.type!=='neuron_message'||typeof d.event!=='string'||d.event.length>2048){reject('invalid-payload');return;}
 let sender:string;try{sender=JSON.parse(d.event).sender;}catch{reject('invalid-event');return;}if(!validAccountId(sender)){reject('invalid-sender');return;}
 const owner=await rootWakeContext();if(!owner){reject('owner-unavailable');return;}if(await rootWakeBlocked(owner.account,sender)){reject('sender-blocked');return;}
 if(!validWakeLookup(data,owner,Date.now())){reject('invalid-routing-or-expiry');return;}
 const records=createMobileIdentityRecordStore(Date.now);let record=await records.read(sender);
 if(!record){
  setStage('sender-record-missing');
  if(!recoverSender){reject('sender-lookup-unavailable');return;}
  const result=await recoverSender(data,owner);setStage('sender-lookup-'+result);
  if(result!=='recovered'){reject('sender-lookup-'+result);return;}
  record=await records.read(sender);
 }
 const current=await rootWakeContext();if(current?.account!==owner.account||current.device!==owner.device||await rootWakeBlocked(owner.account,sender)){reject('context-changed');return;}
 const event=record&&verifyCustodyWake(data,record,owner.account,owner.device,Date.now());if(!event){reject('signature-or-record-invalid');return;}setStage('recovery');deliveryDiagnosticEvent(owner.account,sender,event.id,'wake_verified');
 const deadline=createMessageNotificationDeadline();
 const hint=(data as {custodian?:unknown})?.custodian;
 const custodian=typeof hint==='string'&&validAccountId(hint)?hint:undefined;
 let envelope=custodyWakeEnvelope(data,event,Date.now())??undefined,payload:GroupCustodyPayload|undefined;
 const rawPayload=(data as {payload?:unknown}).payload;
 if(rawPayload!==undefined){try{const parsed=typeof rawPayload==='string'&&rawPayload.length<=3500?JSON.parse(rawPayload):null;if(envelope&&await verifyGroupCustodyPayload(parsed,records,Date.now())&&matchesGroupGrant(parsed,envelope))payload=parsed;else envelope=undefined;}catch{envelope=undefined;}}
 const recovery=Promise.resolve().then(()=>recover?.(owner.account,sender,event.id,event.expires,deadline.progress,envelope,custodian,payload)).then(()=>{},()=>{setStage('recovery-failed');});
 // Three seconds without new progress, capped at ten seconds overall. A preview
 // publishes independently; retries and repeated milestones cannot extend this.
 await waitForRecovery(recovery,10000,deadline.remaining);
 await serial(async()=>{
  const current=await rootWakeContext();if(current?.account!==owner.account||current.device!==owner.device||event.expires<=Date.now())return;
  const database=await db();
  if(event.wakeMode==='silent'){
   // Presentation intent is covered by the sender's wake signature, even while locked.
   await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner.account,sender,event.id,event.expires);
   await cancelRootMessageNotification(owner.account,sender,event.id);setStage('silent-control');return;
  }
  // A verified routing hint is not proof of a new user-visible message.
  // Only finishRootMessageWake may notify, after durable decrypted admission.
  // Retire legacy generic alerts without touching a real preview or consuming
  // this delivery: a later successful recovery must still be able to notify.
  const notice=await currentRootMessageNotification(owner.account,sender);
  if(notice&&!notice.data?.messagePreviews)await cancelRootMessageNotification(owner.account,sender,event.id);
  setStage('awaiting-verified-message');
 });
 // Keep the headless task alive for bounded recovery; hints remain silent.
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
 const began=Date.now();
 await serial(async()=>{
  console.info('[Axonic notification timing] queue-ms',Date.now()-began);
  // These reads are independent; avoid one bridge round trip after another on a
  // cold headless task. Account and lock checks still gate all presentation.
  const [database,current]=await Promise.all([db(),rootWakeContext()]);
  const key=rootMessageNotificationId(owner,sender,preview?.group);
  if(current?.account!==owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
  const [preferences,blocked,isMuted]=await Promise.all([readRootNotificationPreferences(owner),rootWakeBlocked(owner,sender),muted(owner,sender,preview?.group)]);
  const quiet=!preferences.messages||!preview||preview.read||blocked||isMuted||(AppState.currentState==='active'&&rootConversationVisible(sender,preview.group));
  if(quiet){if(preview?.group)await cancelRootMessageNotification(owner,sender,id);
   // Direct delivery can finish before the first wake creates a notice row.
   // Remember consumed control/read/muted packets too, so a delayed hint cannot
   // manufacture a new-message alert for a packet with no unread conversation.
   await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);
   await cancelRootMessageNotification(owner,sender,id,preview?.group);return;}
  const prior=await database.getFirstAsync<{displayed:number}>('SELECT displayed FROM notices WHERE owner=? AND sender=? AND id=?',owner,sender,id);if(prior?.displayed===2)return;
  await database.runAsync('DELETE FROM notices WHERE expires<=?',Date.now());
  if(AppState.currentState==='active'&&publishRootMessageToast({account:owner,sender,...(preview.group?{group:preview.group}:{}),name:preview.name,text:preview.text})){
   if(preview.group)await cancelRootMessageNotification(owner,sender,id);
   await cancelRootMessageNotification(owner,sender,id,preview?.group);setStage('preview');
   await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);return;
  }
  const channelId=await messageChannel(preferences.sound);
  console.info('[Axonic notification timing] policy-channel-ms',Date.now()-began);
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
  console.info('[Axonic notification timing] displayed-ms',Date.now()-began);
  if(localAccount.status().state==='unlocked'&&localAccount.status().account===owner)diagnosticJournal.record('notification_preview_posted',{milliseconds:Date.now()-began});
  await Native?.notificationReadActionInShade?.(key);
  console.info('[Axonic notification timing] shade-action-ms',Date.now()-began);
  deliveryDiagnosticEvent(owner,sender,id,'notification_requested');
  if(AppState.currentState==='active'&&rootConversationVisible(sender,preview.group))await cancelRootMessageNotification(owner,sender,id,preview.group);
  setStage('preview');
  await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);
 });
}
import {ownChatStore} from '../../modules/storage/chatStore';
