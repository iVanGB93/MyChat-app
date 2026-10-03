import { neuronCallsEnabled } from './neuronCallFeature';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import notifee, { AndroidCategory, AndroidImportance, AndroidVisibility, EventType, type Event } from '@notifee/react-native';
import { createMobileIdentityRecordStore } from './identityRecordStore';
import { createChatIdentityPinStore } from './chatIdentityPinStore';
import { callWakeSender, verifyCallWake } from './callWakeProtocol';
import { getCachedRooms } from '../localMessageStore';
import { ensureCallChannel } from '../callNotificationChannel';
import { useAppStore } from '../../store/appStore';
import type { CallControl } from './callControlProtocol';

const key='@axonic_neuron_call_wake_v1';
const enabled=neuronCallsEnabled;
let opening:Promise<SQLite.SQLiteDatabase>|undefined;
let tail:Promise<unknown>=Promise.resolve();
const serial=<T>(work:()=>Promise<T>)=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
const db=()=>opening??=SQLite.openDatabaseAsync('axonic_call_wakes_v1.db',{useNewConnection:true}).then(async database=>{
  await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS wakes(owner INTEGER NOT NULL, call_id TEXT NOT NULL, sequence INTEGER NOT NULL, expires INTEGER NOT NULL, raw TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner,call_id));');return database;
}).catch(error=>{opening=undefined;throw error;});
export async function registerCallWakeOwner(owner:number,account:string,device:string) {
  if(enabled())await AsyncStorage.setItem(key,JSON.stringify({owner,account,device}));
}
async function context() {
  const [cached,saved]=await Promise.all([AsyncStorage.getItem('@axonic_user_cache'),AsyncStorage.getItem(key)]);
  if(!cached||!saved)return null;
  const user=JSON.parse(cached),owner=JSON.parse(saved);
  return Number.isSafeInteger(user?.id)&&user.id===owner?.owner?owner as {owner:number;account:string;device:string}:null;
}
async function permitted(owner:number,account:string) {
  const persisted=JSON.parse(await AsyncStorage.getItem('axonic-app-store')??'{}');
  const blocked=persisted?.state?.blockedIds??{};
  const pins=createChatIdentityPinStore(owner);
  for(const room of await getCachedRooms(owner)) {
    if(room.room_type!=='direct'||room.members.length!==2||!room.members.includes(owner))continue;
    const user=room.members.find(id=>id!==owner);
    if(!user||blocked[user]||useAppStore.getState().blockedIds[user])continue;
    if(await pins.read(user)===account)return room.members_detail?.find(m=>m.id===user)?.display_name||room.members_detail?.find(m=>m.id===user)?.username||'Axonic caller';
  }
  return null;
}
/** Public-key-only headless verification. Never unlocks the identity or calls Django. */
export async function receiveNeuronCallWake(data:unknown) {
  if(!enabled())return;
  const owner=await context(),sender=callWakeSender(data);
  if(!owner||!sender)return;
  const record=await createMobileIdentityRecordStore(Date.now).read(sender);
  const raw=record&&verifyCallWake(data,record,owner.account,owner.device,Date.now());
  if(!raw)return;
  const name=await permitted(owner.owner,sender);if(!name)return;
  const event=JSON.parse(raw) as CallControl;
  await serial(async()=>{
    if((await context())?.owner!==owner.owner||event.expiresAt<=Date.now())return;
    const database=await db();let changed=false;
    await database.withExclusiveTransactionAsync(async tx=>{
      await tx.runAsync('DELETE FROM wakes WHERE expires <= ?',Date.now());
      const prior=await tx.getFirstAsync<{sequence:number}>('SELECT sequence FROM wakes WHERE owner=? AND call_id=?',owner.owner,event.callId);
      if(prior&&prior.sequence>=event.sequence)return;
      const count=await tx.getFirstAsync<{total:number}>('SELECT COUNT(*) AS total FROM wakes');
      if(!prior&&(count?.total??64)>=64)return;
      await tx.runAsync('INSERT INTO wakes(owner,call_id,sequence,expires,raw) VALUES (?,?,?,?,?) ON CONFLICT(owner,call_id) DO UPDATE SET sequence=excluded.sequence,expires=excluded.expires,raw=excluded.raw,dismissed=0',owner.owner,event.callId,event.sequence,event.expiresAt,raw);changed=true;
    });
    const id='neuron-call:'+event.callId;
    if(event.kind!=='invite'){await notifee.cancelNotification(id);return;}
    if(!changed||(AppState.currentState==='active'&&useAppStore.getState().user?.id===owner.owner)||event.expiresAt<=Date.now()||(await context())?.owner!==owner.owner)return;
    await ensureCallChannel();
    await notifee.displayNotification({id,title:name,body:`Incoming ${event.media} call`,data:{type:'neuron_call',neuronCallId:event.callId,owner:String(owner.owner)},
      android:{channelId:'incoming-calls-v2',category:AndroidCategory.CALL,importance:AndroidImportance.HIGH,visibility:AndroidVisibility.PRIVATE,
        smallIcon:'notification_icon',pressAction:{id:'neuron-open',launchActivity:'default'},fullScreenAction:{id:'neuron-open',launchActivity:'default'},
        timeoutAfter:Math.max(1,event.expiresAt-Date.now()),actions:[{title:'Open call',pressAction:{id:'neuron-open',launchActivity:'default'}},{title:'Decline',pressAction:{id:'neuron-decline',launchActivity:'default'}}]}});
  });
}
export async function handleNeuronCallNotification(event:Event):Promise<boolean> {
  const data=event.detail.notification?.data;
  if(data?.type!=='neuron_call')return false;
  if(event.type===EventType.ACTION_PRESS&&event.detail.pressAction?.id==='neuron-decline') {
    const owner=await context();
    if(owner&&String(owner.owner)===data.owner&&typeof data.neuronCallId==='string')await serial(async()=>{
      await (await db()).runAsync('UPDATE wakes SET dismissed=1 WHERE owner=? AND call_id=?',owner.owner,data.neuronCallId as string);
      await notifee.cancelNotification('neuron-call:'+data.neuronCallId);
    });
  }
  return true; // Never pass neuron actions to legacy Django call handlers.
}
export async function pendingCallWakes(owner:number):Promise<{raw:string;dismissed:number}[]> {
  if(!enabled()||(await context())?.owner!==owner)return [];
  return serial(async()=>(await db()).getAllAsync<{raw:string;dismissed:number}>('SELECT raw,dismissed FROM wakes WHERE owner=? AND expires>? AND dismissed<>2 ORDER BY sequence DESC LIMIT 8',owner,Date.now()));
}
export async function finishCallWake(owner:number,id:string) {
  await notifee.cancelNotification('neuron-call:'+id);
  // Keep the signed event as a replay tombstone until its original expiry.
  await serial(async()=>{await (await db()).runAsync('UPDATE wakes SET dismissed=2 WHERE owner=? AND call_id=?',owner,id);});
}
