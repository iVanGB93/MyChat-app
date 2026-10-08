import {getMessaging,setBackgroundMessageHandler,onMessage} from '@react-native-firebase/messaging';
import notifee,{EventType} from '@notifee/react-native';
import {recoverRootMessage} from './rootMessageRecovery';
import {queueRootNotificationOpen} from './rootNotificationRoute';
import {receiveRootCallWake} from './rootCallWake';
import {receiveRootMessageWake,rootMessageWakeFailed} from './rootMessageWake';
import {handleRootNotificationAction} from './rootNotificationActions';
/** Loaded only by the fresh-account entry, including its Android headless launch. */
export function registerRootBackgroundHandlers(){
 const receive=async(message:{data?:unknown})=>{try{
  console.info('[Axonic background wake] received');
  if((message.data as {type?:string})?.type==='neuron_message')await receiveRootMessageWake(message.data,recoverRootMessage);
  else await receiveRootCallWake(message.data);
 }catch{rootMessageWakeFailed();/* Invalid or unavailable local state must not produce a notification. */}};
 setBackgroundMessageHandler(getMessaging(),receive);
 onMessage(getMessaging(),receive);
 notifee.onBackgroundEvent(async({type,detail})=>{if(type===EventType.PRESS)await queueRootNotificationOpen(detail.notification?.data);else if(type===EventType.ACTION_PRESS)await handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data,detail.input);});
}
