import {AppState,Platform,Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getPlayUpdateInfoAsync,startPlayUpdateAsync,completePlayUpdateAsync,observePlayInstallStatus} from '../../modules/axonic-app-update';
import {createPlayUpdates} from '../services/playUpdates';
import {localAccountCalls} from './neuronRuntime';
import {rootVoiceRecordingActive} from '../services/identity/rootVoiceRecorder';
import {rootAttachmentProgress} from '../services/identity/rootAttachmentRuntime';
import {queueIdentityLink} from '../services/identity/identityLinks';
let owners=0;
const KEY='@axonic_play_prompt_v1';
export const appUpdates=createPlayUpdates({now:Date.now,foreground:()=>owners>0&&Platform.OS==='android'&&!__DEV__&&AppState.currentState==='active',
 safeToRestart:async()=>{if(!maintenanceIdle())return false;const transfers=await rootAttachmentProgress();return maintenanceIdle()&&!transfers.jobs.some(j=>!['complete','cancelled','expired'].includes(j.phase))&&!transfers.selections.length;},
 info:getPlayUpdateInfoAsync,start:startPlayUpdateAsync,complete:completePlayUpdateAsync,read:()=>AsyncStorage.getItem(KEY),write:value=>AsyncStorage.setItem(KEY,value)});
function maintenanceIdle(){const call=localAccountCalls()?.snapshot();return !rootVoiceRecordingActive()&&(!call||call.status==='ended');}
export function startAppMaintenance(){
 owners++;
 let active=true,sawLink=false;const links=Linking.addEventListener('url',e=>{sawLink=true;queueIdentityLink(e.url);});void Linking.getInitialURL().then(url=>{if(active&&!sawLink)queueIdentityLink(url);}).catch(()=>{});
 const check=()=>{void appUpdates.check();};check();
 const lifecycle=AppState.addEventListener('change',next=>{if(next==='active')void appUpdates.check(['downloading','available'].includes(appUpdates.snapshot().status));});
 const install=observePlayInstallStatus(()=>{void appUpdates.check(true);});
 let ticks=0;const timer=setInterval(()=>{const status=appUpdates.snapshot().status;if(status==='downloading'||['available','error'].includes(status)&&++ticks%6===0)void appUpdates.check(true);},10000);
 return()=>{if(!active)return;active=false;owners--;links.remove();clearInterval(timer);lifecycle.remove();install?.remove();};
}
