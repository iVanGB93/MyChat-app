import {AppRegistry,AppState} from 'react-native';
import Native from '../../../modules/axonic-nearby';
import {diagnosticJournal} from '../diagnosticJournal';
import {pushDeliveryObservation} from './pushDeliveryObservation';
import {getMessaging,setBackgroundMessageHandler,onMessage} from '@react-native-firebase/messaging';
import notifee,{EventType} from '@notifee/react-native';
import {recoverRootMessage} from './rootMessageRecovery';
import {recoverWakeSender} from './mobileWakeSenderRecovery';
import {queueRootNotificationOpen} from './rootNotificationRoute';
import {receiveRootCallWake} from './rootCallWake';
import {receiveRootMessageWake,rootMessageWakeFailed,restoreRootMessageNotices} from './rootMessageWake';
import {handleRootNotificationAction} from './rootNotificationActions';
/** Loaded only by the fresh-account entry, including its Android headless launch. */
export function registerRootBackgroundHandlers(){
 type Message={data?:unknown;sentTime?:number;priority?:number;originalPriority?:number};
 const process=async(message:Message,jobToken?:string)=>{try{
  if(jobToken&&!Native?.messageRecoveryCurrent?.(jobToken))return;
  console.info('[Axonic background wake] received');
  if((message.data as {type?:string})?.type==='neuron_message')await receiveRootMessageWake(message.data,(...args)=>recoverRootMessage(...args,jobToken),recoverWakeSender);
  else await receiveRootCallWake(message.data);
 }catch{rootMessageWakeFailed();/* Invalid or unavailable local state must not produce a notification. */}};
 const receive=async(message:Message)=>{
  try{const timing=pushDeliveryObservation(message,AppState.currentState,Date.now());diagnosticJournal.record('push_received',timing);console.info('[Axonic push timing]',timing);}catch{/* Observations cannot prevent recovery. */}
  // Enqueue immediately at FCM callback entry, before account/record/storage I/O.
  // Calls retain their own protected lifecycle; foreground messages need no job.
  if(AppState.currentState!=='active'&&(message.data as {type?:string})?.type==='neuron_message'){
   try{if(Native?.messageRecoveryEnqueue?.(JSON.stringify(message),message.priority===1))return;}catch{/* Older clients/quota exhaustion retain bounded recovery. */}
  }
  await process(message);
 };
 AppRegistry.registerHeadlessTask('AxonicMessageRecovery',()=>async(data:{message:string;token:string;queuedAt:number})=>{
  try{
   if(!Native?.messageRecoveryCurrent?.(data.token))return;
   console.info('[Axonic message job timing]',{queueMs:Math.max(0,Date.now()-data.queuedAt)});
   await process(JSON.parse(data.message),data.token);
  }finally{Native?.messageRecoveryComplete?.(data.token);}
 });
 AppRegistry.registerHeadlessTask('AxonicRestoreMessageNotices',()=>async()=>{
  try{await restoreRootMessageNotices();}catch{/* Keep unverified notices silent. */}
  finally{Native?.completeMessageNoticeRestore?.();}
 });
 setBackgroundMessageHandler(getMessaging(),receive);
 onMessage(getMessaging(),receive);
 notifee.onBackgroundEvent(async({type,detail})=>{if(type===EventType.PRESS){await handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data);await queueRootNotificationOpen(detail.notification?.data);}else if(type===EventType.ACTION_PRESS)await handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data,detail.input);else if(type===EventType.DISMISSED&&detail.notification?.id?.startsWith('root-conversation:')){
  const id=detail.notification.data?.messageId;
  if(typeof id==='string')await Native?.forgetMessageNoticeRestore?.(detail.notification.id,id);
 }});
}
