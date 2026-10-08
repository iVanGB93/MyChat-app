import {publishRootMessageToast} from './rootMessageToast';
import {readRootNotificationPreferences} from './rootNotificationPreferences';
import {localAccount} from './localAccount';
import {rootConversationVisible} from './rootNotificationRoute';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {AppState} from 'react-native';
import notifee,{AndroidImportance,AndroidVisibility,AndroidStyle} from '@notifee/react-native';
import {validAccountId} from './identityProtocol';
import {verifyCustodyWake} from './custodyProtocol';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {rootWakeContext,rootWakeBlocked} from './rootCallWake';

const diagnostics={received:0,verified:0,previews:0,stage:'idle'};
function setStage(stage:string){diagnostics.stage=stage;console.info('[Axonic message wake]',stage);}
export const rootMessageWakeDiagnostics=()=>({...diagnostics});
export const rootMessageWakeFailed=()=>{setStage('failed');};
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const result=tail.then(work);tail=result.catch(()=>{});return result;}
function db(){return opening??=SQLite.openDatabaseAsync('axonic_root_message_wakes_v1.db',{useNewConnection:true}).then(async value=>{
 await value.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS notices(owner TEXT NOT NULL,sender TEXT NOT NULL,id TEXT NOT NULL,expires INTEGER NOT NULL,displayed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,sender,id));');return value;
}).catch(error=>{opening=undefined;throw error;});}
async function muted(owner:string,sender:string){
 const raw=await AsyncStorage.getItem('@axonic_root_chat_v1:'+owner);if(!raw)return false;
 const state=JSON.parse(raw);if(state.version!==1||!Array.isArray(state.contacts))throw Error('Contact policy unavailable');
 return state.contacts.some((c:{account:string;muted?:boolean})=>c.account===sender&&c.muted===true);
}
const notificationId=(owner:string,sender:string,id:string)=>'root-message:'+owner+':'+sender+':'+id;
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
 return [...ledger.messages,...(ledger.actions??[]),...(ledger.groupActions??[]),] .some((m:{id:string;peer:string;direction:string})=>m.id===id&&m.peer===sender&&m.direction==='incoming')||(ledger.groupSeen??[]).some((m:{id:string;peer:string})=>m.id===id&&m.peer===sender);
}
/** Signed hint only. Private keys and message content remain unavailable until local unlock. */
export async function receiveRootMessageWake(data:unknown,recover?:(account:string,sender:string,id:string,expires:number)=>Promise<void>){
 diagnostics.received++;setStage('context');
 const d=data as {type?:string;event?:string};if(d?.type!=='neuron_message'||typeof d.event!=='string'||d.event.length>2048)return;
 let sender:string;try{sender=JSON.parse(d.event).sender;}catch{return;}if(!validAccountId(sender))return;
 const owner=await rootWakeContext();if(!owner||await rootWakeBlocked(owner.account,sender))return;
 const record=await createMobileIdentityRecordStore(Date.now).read(sender);
 const event=record&&verifyCustodyWake(data,record,owner.account,owner.device,Date.now());if(!event)return;diagnostics.verified++;setStage('recovery');
 if(recover)await recover(owner.account,sender,event.id,event.expires).catch(()=>{setStage('recovery-failed');});
 await serial(async()=>{
  const current=await rootWakeContext();if(current?.account!==owner.account||current.device!==owner.device||event.expires<=Date.now())return;
  const database=await db();let admitted=false;
  await database.withExclusiveTransactionAsync(async tx=>{
   await tx.runAsync('DELETE FROM notices WHERE expires<=?',Date.now());
   const prior=await tx.getFirstAsync<{displayed:number}>('SELECT displayed FROM notices WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);
   if(prior?.displayed)return;
   if(!prior){const count=await tx.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM notices');if((count?.n??128)>=128)return;
    await tx.runAsync('INSERT INTO notices(owner,sender,id,expires) VALUES(?,?,?,?)',owner.account,sender,event.id,event.expires);}
   admitted=true;
  });
  if(!admitted)return;
  const id=notificationId(owner.account,sender,event.id);
  const suppress=await alreadyReceived(owner.account,sender,event.id)||await rootWakeBlocked(owner.account,sender)||await muted(owner.account,sender);
  if(suppress||AppState.currentState==='active'){
   await database.runAsync('UPDATE notices SET displayed=1 WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);
   if(suppress)await notifee.cancelNotification(id);return;
  }
  const latest=await rootWakeContext();if(latest?.account!==owner.account||latest.device!==owner.device||event.expires<=Date.now())return;
  const preferences=await readRootNotificationPreferences(owner.account);if(!preferences.messages)return;
  const channelId=await messageChannel(preferences.sound);
  setStage('generic');
  await notifee.displayNotification({id,title:'Axonic',body:'New message. Open Axonic to read it.',
   data:{type:'root_neuron_message',account:owner.account,sender,messageId:event.id},
   android:{channelId,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,smallIcon:'notification_icon',
    pressAction:{id:'root-message-open',launchActivity:'default'},timeoutAfter:Math.max(1,event.expires-Date.now())}});
  await database.runAsync('UPDATE notices SET displayed=1 WHERE owner=? AND sender=? AND id=?',owner.account,sender,event.id);
 });
}
/** Invoked only after durable inbox admission, including direct delivery racing a delayed hint. */
export type RootMessagePreview={name:string;text:string;at:number;group?:string;read?:boolean};
export async function finishRootMessageWake(owner:string,sender:string,id:string,preview?:RootMessagePreview){
 await serial(async()=>{
  const database=await db(),key=notificationId(owner,sender,id),current=await rootWakeContext();
  if(current?.account!==owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
  const preferences=await readRootNotificationPreferences(owner);
  const quiet=!preferences.messages||!preview||preview.read||await rootWakeBlocked(owner,sender)||await muted(owner,sender)||(AppState.currentState==='active'&&rootConversationVisible(sender,preview.group));
  if(quiet){await database.runAsync('UPDATE notices SET displayed=2 WHERE owner=? AND sender=? AND id=?',owner,sender,id);await notifee.cancelNotification(key);return;}
  const prior=await database.getFirstAsync<{displayed:number}>('SELECT displayed FROM notices WHERE owner=? AND sender=? AND id=?',owner,sender,id);if(prior?.displayed===2)return;
  await database.runAsync('DELETE FROM notices WHERE expires<=?',Date.now());
  const count=await database.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM notices');if(!prior&&(count?.n??128)>=128){
   await database.runAsync('DELETE FROM notices WHERE rowid IN (SELECT rowid FROM notices WHERE displayed=2 ORDER BY expires LIMIT 1)');
   const remaining=await database.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM notices');if((remaining?.n??128)>=128)return;
  }
  if(AppState.currentState==='active'&&publishRootMessageToast({account:owner,sender,...(preview.group?{group:preview.group}:{}),name:preview.name,text:preview.text})){
   await notifee.cancelNotification(key);diagnostics.previews++;setStage('preview');
   await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);return;
  }
  const channelId=await messageChannel(preferences.sound);
  // An unlock may end while the OS channel is being created.
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)return;
  await notifee.displayNotification({id:key,title:preview.name,body:preview.text,data:{type:'root_neuron_message',account:owner,sender,messageId:id,...(preview.group?{group:preview.group}:{})},
   android:{channelId,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,smallIcon:'notification_icon',color:'#7C3AED',
    pressAction:{id:'root-message-open',launchActivity:'default'},actions:[{title:'Reply',pressAction:{id:'root-reply'},input:{allowFreeFormInput:true,placeholder:'Reply…'}},{title:'Mark as read',pressAction:{id:'root-mark-read'}}],style:{type:AndroidStyle.MESSAGING,person:{name:'You'},group:!!preview.group,...(preview.group?{title:preview.name}:{}),messages:[{text:preview.text,timestamp:preview.at,person:{name:preview.name}}]}}});
  diagnostics.previews++;setStage('preview');
  await database.runAsync('INSERT INTO notices(owner,sender,id,expires,displayed) VALUES(?,?,?,?,2) ON CONFLICT(owner,sender,id) DO UPDATE SET displayed=2',owner,sender,id,Date.now()+7*86400000);
 });
}
