import notifee,{AuthorizationStatus} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState} from 'react-native';
const KEY='@axonic_notification_permission_requested_v1';
let pending:Promise<void>|null=null;
/** Ask once in the foreground, before account creation; settings remain available for later changes. */
export function requestInitialNotificationPermission():Promise<void>{
 if(AppState.currentState!=='active')return Promise.resolve();
 if(pending)return pending;
 pending=(async()=>{
  if(await AsyncStorage.getItem(KEY)||AppState.currentState!=='active')return;
  const settings=await notifee.getNotificationSettings();
  if(AppState.currentState!=='active')return;
  if(settings.authorizationStatus<AuthorizationStatus.AUTHORIZED)await notifee.requestPermission();
  await AsyncStorage.setItem(KEY,'1');
 })().finally(()=>{pending=null;});
 return pending;
}
