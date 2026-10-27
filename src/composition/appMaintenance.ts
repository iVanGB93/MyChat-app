import {startMessageSounds} from './messageSounds';
import {startRingerModeListener,stopRingerModeListener} from '../services/ringerService';
import {AppState,Platform,Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getPlayUpdateInfoAsync,startPlayUpdateAsync,completePlayUpdateAsync,observePlayInstallState} from '../../modules/axonic-app-update';
import {createPlayUpdates} from '../services/playUpdates';
import {localAccountCalls} from './neuronRuntime';
import {rootVoiceRecordingActive} from '../services/identity/rootVoiceRecorder';
import {rootAttachmentProgress} from '../services/identity/rootAttachmentSelections';
import {queueIdentityLink} from '../services/identity/identityLinks';
let owners=0,stopSounds:(()=>void)|undefined;
const KEY='@axonic_play_prompt_v1';
export const appUpdates=createPlayUpdates({now:Date.now,foreground:()=>owners>0&&Platform.OS==='android'&&!__DEV__&&AppState.currentState==='active',
 safeToRestart:async()=>{if(!maintenanceIdle())return false;const transfers=await rootAttachmentProgress();return maintenanceIdle()&&!transfers.jobs.some(j=>!['complete','cancelled','expired'].includes(j.phase))&&!transfers.selections.length;},
 info:getPlayUpdateInfoAsync,start:startPlayUpdateAsync,complete:completePlayUpdateAsync,read:()=>AsyncStorage.getItem(KEY),write:value=>AsyncStorage.setItem(KEY,value)});
function maintenanceIdle(){const call=localAccountCalls()?.snapshot();return !rootVoiceRecordingActive()&&(!call||call.status==='ended');}
export function startAppMaintenance(){
 owners++;
 if(owners===1){startRingerModeListener();stopSounds=startMessageSounds();}
 let active=true,sawLink=false;const links=Linking.addEventListener('url',e=>{sawLink=true;queueIdentityLink(e.url);});void Linking.getInitialURL().then(url=>{if(active&&!sawLink)queueIdentityLink(url);}).catch(()=>{});
 const check=()=>{void appUpdates.check();};check();
 const lifecycle=AppState.addEventListener('change',next=>{if(next==='active')void appUpdates.check(['downloading','installing','available','ready'].includes(appUpdates.snapshot().status));});
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
 const offUpdates=appUpdates.subscribe(schedule),clockLifecycle=AppState.addEventListener('change',schedule);schedule();
 return()=>{if(!active)return;active=false;owners--;if(owners===0){stopRingerModeListener();stopSounds?.();stopSounds=undefined;}links.remove();clearTimeout(timer);offUpdates();clockLifecycle.remove();lifecycle.remove();install?.remove();};
}
