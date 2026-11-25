import {startMessageSounds} from './messageSounds';
import {startRingerModeListener,stopRingerModeListener} from '../services/ringerService';
import {AppState,Platform,Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getPlayUpdateInfoAsync,startPlayUpdateAsync,completePlayUpdateAsync,observePlayInstallState} from '../../modules/axonic-app-update';
import {createPlayUpdates} from '../services/playUpdates';
import {openAppDestination} from '../services/appDestinations';
import {localAccountCalls} from './neuronRuntime';
import {localAccountSession} from '../modules/identity';
import {rootVoiceRecordingActive} from '../services/identity/rootVoiceRecorder';
import {queueIdentityLink} from '../services/identity/identityLinks';
let owners=0,stopMaintenance:(()=>void)|undefined;
const KEY='@axonic_play_prompt_v1';
export const appUpdates=createPlayUpdates({now:Date.now,foreground:()=>owners>0&&Platform.OS==='android'&&!__DEV__&&AppState.currentState==='active',
 // Attachment jobs and selections are durable and resume after restart.
 safeToRestart:async()=>{
  if(!maintenanceIdle())return false;
  await localAccountSession.settle();
  return maintenanceIdle();
 },
 info:getPlayUpdateInfoAsync,start:startPlayUpdateAsync,complete:completePlayUpdateAsync,read:()=>AsyncStorage.getItem(KEY),write:value=>AsyncStorage.setItem(KEY,value),
 openStore:()=>openAppDestination('store')});
function maintenanceIdle(){const call=localAccountCalls()?.snapshot();return !rootVoiceRecordingActive()&&(!call||call.status==='ended');}
function startMaintenance(){
 startRingerModeListener();const stopSounds=startMessageSounds();
 let active=true,sawLink=false;const links=Linking.addEventListener('url',e=>{sawLink=true;queueIdentityLink(e.url);});void Linking.getInitialURL().then(url=>{if(active&&!sawLink)queueIdentityLink(url);}).catch(()=>{});
 const check=()=>{void appUpdates.check();};check();
 const install=observePlayInstallState(state=>{if(!__DEV__)appUpdates.installState(state);});
 // Native install events are primary. A bounded fallback exists only while an
 // update or retry is pending; idle/current/background states have no timer.
 let timer:ReturnType<typeof setTimeout>|undefined;
 const schedule=()=>{
  if(timer!==undefined)clearTimeout(timer);timer=undefined;
  if(!active||AppState.currentState!=='active')return;
  const status=appUpdates.snapshot().status;
  const delay=['downloading','installing'].includes(status)?10000:['available','error'].includes(status)?60000:0;
  if(delay)timer=setTimeout(()=>{timer=undefined;void appUpdates.check(true).finally(schedule);},delay);
 };
 const offUpdates=appUpdates.subscribe(schedule);
 const lifecycle=AppState.addEventListener('change',next=>{
  if(next==='active')void appUpdates.check(['downloading','installing','available','ready'].includes(appUpdates.snapshot().status));
  schedule();
 });
 schedule();
 return()=>{active=false;stopRingerModeListener();stopSounds?.();links.remove();clearTimeout(timer);offUpdates();lifecycle.remove();install?.remove();};
}
export function startAppMaintenance(){
 if(++owners===1)stopMaintenance=startMaintenance();
 let active=true;
 return()=>{
  if(!active)return;
  active=false;
  if(--owners===0){stopMaintenance?.();stopMaintenance=undefined;}
 };
}
