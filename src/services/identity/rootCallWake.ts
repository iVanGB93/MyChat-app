import {readRootNotificationPreferences} from './rootNotificationPreferences';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {AppState} from 'react-native';
import notifee,{AndroidCategory,AndroidImportance,AndroidVisibility} from '@notifee/react-native';
import {callWakeSender,verifyCallWake} from './callWakeProtocol';
import {validAccountId} from './identityProtocol';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {ensureCallChannel} from '../callNotificationChannel';
import type {CallControl} from './callControlProtocol';
import type {NeuronCallView} from './neuronCallCoordinator';
import {DEVICE_REMOVAL_KEY} from './deviceRemoval';
const KEY='@axonic_root_call_wake_owner_v1';
let opening:Promise<SQLite.SQLiteDatabase>|undefined;
let tail:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>){const result=tail.then(work);tail=result.catch(()=>{});return result;}
function db(){return opening??=SQLite.openDatabaseAsync('axonic_root_call_wakes_v1.db',{useNewConnection:true}).then(async value=>{
 await value.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS wakes(owner TEXT NOT NULL, call_id TEXT NOT NULL, sequence INTEGER NOT NULL, expires INTEGER NOT NULL, raw TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner,call_id));');return value;
}).catch(error=>{opening=undefined;throw error;});}
export async function registerRootCallWakeOwner(account:string,device:string){
 if(!validAccountId(account)||!/^[a-f0-9]{64}$/.test(device))throw Error('Invalid wake identity');
 await AsyncStorage.setItem(KEY,JSON.stringify({account,device}));
}
export async function rootWakeContext(){
 if(await AsyncStorage.getItem(DEVICE_REMOVAL_KEY))return null;
 const [raw,vault]=await Promise.all([AsyncStorage.getItem(KEY),AsyncStorage.getItem('@axonic_local_account_v1')]);
 if(!raw||!vault)return null;const owner=JSON.parse(raw),record=JSON.parse(vault).record;
 return validAccountId(owner.account)&&record?.account===owner.account&&record.devices?.some((d:{id:string})=>d.id===owner.device)?owner as {account:string;device:string}:null;
}
export async function rootWakeBlocked(owner:string,sender:string){
 const raw=await AsyncStorage.getItem('@axonic_root_chat_v1:'+owner);if(!raw)return false;
 const ledger=JSON.parse(raw);if(ledger.version!==1||!Array.isArray(ledger.contacts))throw Error('Contact policy unavailable');
 return ledger.contacts.some((c:{account:string;blocked:boolean})=>c.account===sender&&c.blocked);
}
const context=rootWakeContext,blocked=rootWakeBlocked;
/** Caller names come only from this account's saved nicknames, after verification. */
async function callerName(owner:string,sender:string){
 try{
  const raw=await AsyncStorage.getItem('@axonic_root_chat_v1:'+owner);
  const ledger=raw?JSON.parse(raw):null;
  if(ledger?.version!==1||!Array.isArray(ledger.contacts))return 'Unknown caller';
  const contact=ledger.contacts.find((c:{account:string})=>c?.account===sender);
  if(typeof contact?.alias!=='string'||contact.alias.length>80)return 'Unknown caller';
  return contact.alias.trim().replace(/\s+/g,' ')||'Unknown caller';
 }catch{return 'Unknown caller';}
}
let liveNotice:string|null=null;
/** Called only with the verified coordinator view, including direct axon delivery. */
export async function syncRootCallNotification(account:string,view:NeuronCallView<string>|null){
 return serial(async()=>{
  const ringing=view&&!view.outgoing&&view.status==='ringing'&&AppState.currentState!=='active';
  const id=view?'root-call:'+view.id:null;
  if(liveNotice&&(!ringing||liveNotice!==id)){await notifee.cancelNotification(liveNotice);liveNotice=null;}
  if(!ringing){if(id)await notifee.cancelNotification(id);return false;}
  if((await context())?.account!==account||await blocked(account,view.peerUser))return false;
  if(!(await readRootNotificationPreferences(account)).calls)return false;
  const settings=await notifee.getNotificationSettings?.();
  if(settings&&settings.authorizationStatus<1)return false;
  if(liveNotice===id)return true;
  const name=await callerName(account,view.peerUser);
  await ensureCallChannel();
  const channel=await notifee.getChannel?.('incoming-calls-v2');if(channel?.blocked)return false;
  if(AppState.currentState==='active'||(await context())?.account!==account)return false;
  await notifee.displayNotification({id:id!,title:name,body:'Incoming '+view.media+' call. Open Axonic to answer.',
   data:{type:'root_neuron_call',callId:view.id,account},
   android:{channelId:'incoming-calls-v2',category:AndroidCategory.CALL,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,smallIcon:'notification_icon',
    pressAction:{id:'root-call-open',launchActivity:'default'},timeoutAfter:60000}});
  liveNotice=id;
  return true;
 });
}
/** Signed wake metadata and local contact labels are read while locked; no private keys. */
export async function receiveRootCallWake(data:unknown){

 const owner=await context(),sender=callWakeSender(data);if(!owner||!sender||await blocked(owner.account,sender))return;

 const record=await createMobileIdentityRecordStore(Date.now).read(sender),raw=record&&verifyCallWake(data,record,owner.account,owner.device,Date.now());if(!raw)return;

 const event=JSON.parse(raw) as CallControl;
 await serial(async()=>{
  const current=await context();if(current?.account!==owner.account||current.device!==owner.device||event.expiresAt<=Date.now())return;
  const database=await db();let changed=false;
  await database.withExclusiveTransactionAsync(async tx=>{
   await tx.runAsync('DELETE FROM wakes WHERE expires<=?',Date.now());
   const prior=await tx.getFirstAsync<{sequence:number}>('SELECT sequence FROM wakes WHERE owner=? AND call_id=?',owner.account,event.callId);
   if(prior&&prior.sequence>=event.sequence)return;
   const count=await tx.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM wakes');if(!prior&&(count?.n??64)>=64)return;
   await tx.runAsync('INSERT INTO wakes(owner,call_id,sequence,expires,raw) VALUES (?,?,?,?,?) ON CONFLICT(owner,call_id) DO UPDATE SET sequence=excluded.sequence,expires=excluded.expires,raw=excluded.raw,consumed=0',owner.account,event.callId,event.sequence,event.expiresAt,raw);changed=true;
  });
  const id='root-call:'+event.callId;
  if(event.kind!=='invite'){await notifee.cancelNotification(id);return;}
  if(!(await readRootNotificationPreferences(owner.account)).calls)return;
  if(!changed||AppState.currentState==='active'||event.expiresAt<=Date.now()||await blocked(owner.account,sender))return;
  const name=await callerName(owner.account,sender);
  if((await context())?.account!==owner.account)return;
  await ensureCallChannel();

  await notifee.displayNotification({id,title:name,body:'Incoming '+event.media+' call. Open Axonic to answer.',data:{type:'root_neuron_call',callId:event.callId,account:owner.account},
   android:{channelId:'incoming-calls-v2',category:AndroidCategory.CALL,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,smallIcon:'notification_icon',
    pressAction:{id:'root-call-open',launchActivity:'default'},timeoutAfter:Math.max(1,event.expiresAt-Date.now())}});

 });
}
export async function pendingRootCallWakes(account:string){
 if((await context())?.account!==account)return [];
 return serial(async()=>(await db()).getAllAsync<{raw:string}>('SELECT raw FROM wakes WHERE owner=? AND expires>? AND consumed=0 ORDER BY sequence DESC LIMIT 8',account,Date.now()));
}
export async function finishRootCallWake(account:string,id:string,keepNotification=false){
 await serial(async()=>{await(await db()).runAsync('UPDATE wakes SET consumed=1 WHERE owner=? AND call_id=?',account,id);});
 if(!keepNotification)await notifee.cancelNotification('root-call:'+id);
}
