import {trialReference} from '../../services/identity/trialCredits';
import {mobileTrialCredits,subscribeTrialCredits} from '../../services/identity/mobileTrialCredits';
import {useEffect,useState} from 'react';
import type {GroupCallRoom} from '../../services/identity/groupCallRoom';
import {watchGroupCallPresence,groupCallIsActive,subscribeGroupCallPresence} from '../../composition/neuronRuntime';
import {AppState} from 'react-native';
import {useStore} from 'zustand';
import {notificationPreferencesState} from '../../services/identity/rootNotificationPreferences';
import {callMediaState,clearCallMediaState} from '../../services/identity/callMediaState';
export {beginCallMediaState} from '../../services/identity/callMediaState';
import {createObservedState} from '../../services/identity/sharedState';
import {localAccount} from '../identity';
import {localAccountScorecard,localAccountNetworkSnapshot,subscribeLocalNetworkChanges,localAccountDirectorySnapshot,subscribeLocalAccountCalls,localAccountCalls} from '../../composition/neuronRuntime';

export const trialCreditsState=createObservedState(()=>{const s=localAccount.status();return s.state==='unlocked'&&s.account?mobileTrialCredits(s.account).snapshot():null;},changed=>{const a=localAccount.subscribe(changed),b=subscribeTrialCredits(changed);return()=>{a();b();};});
export function useTrialCredits(){return useStore(trialCreditsState,s=>s.value);}
/** One modal action retains one reference even if its callback is retried. */
export function prepareTrialTopUp(owner:string){
 const reference=trialReference(owner,Date.now()+':'+Math.random(),'trial-top-up');
 return async()=>{const current=localAccount.status();if(current.state!=='unlocked'||current.account!==owner)return false;return mobileTrialCredits(owner).addTrialCredits(reference);};
}

export const accountState=createObservedState(()=>localAccount.status(),localAccount.subscribe);
export const lifecycleState=createObservedState(()=>AppState.currentState,changed=>{const sub=AppState.addEventListener('change',changed);return()=>sub.remove();});
function networkView(){
 const unlocked=localAccount.status().state==='unlocked',network=unlocked?localAccountNetworkSnapshot():null;
 return {network,scorecard:unlocked?localAccountScorecard():null,directory:unlocked?localAccountDirectorySnapshot():null,
  liveConnections:(network?.pool?.connections??[]).filter(c=>c.state==='connected'&&c.expiresAt!==null&&c.expiresAt>Date.now())};
}
export const networkState=createObservedState(networkView,changed=>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 const refresh=()=>{clearTimeout(timer);changed();
  const deadlines=networkState.getState().value.liveConnections.map(c=>c.expiresAt!).filter(t=>t>Date.now());
  if(deadlines.length&&AppState.currentState==='active')timer=setTimeout(refresh,Math.max(1,Math.min(...deadlines)-Date.now()));
 };
 const off=subscribeLocalNetworkChanges(refresh),account=localAccount.subscribe(refresh),app=AppState.addEventListener('change',refresh);
 // Initial read by createObservedState follows source attachment.
 timer=setTimeout(refresh,0);
 return()=>{clearTimeout(timer);off();account();app.remove();};
});
export const callState=createObservedState(()=>localAccountCalls()?.snapshot()??null,changed=>subscribeLocalAccountCalls(()=>changed()));
export const useAccountState=()=>useStore(accountState,s=>s.value);
export const useForeground=()=>useStore(lifecycleState,s=>s.value==='active');
export function useNetworkState<T>(select:(value:ReturnType<typeof networkState.getState>['value'])=>T){return useStore(networkState,s=>select(s.value));}
export const useCallState=()=>useStore(callState,s=>s.value);
export const useCallMediaState=()=>useStore(callMediaState,s=>s.value);
localAccount.subscribe(()=>{if(localAccount.status().state!=='unlocked')clearCallMediaState();});
export const useNotificationPreferenceState=(owner:string)=>useStore(notificationPreferencesState,s=>s.values[owner]);

export function useGroupCallAvailable(room?:GroupCallRoom){
 const [available,setAvailable]=useState(false);
 useEffect(()=>{if(!room){setAvailable(false);return;}const refresh=()=>setAvailable(groupCallIsActive(room.id));const off=subscribeGroupCallPresence(refresh),watch=watchGroupCallPresence(room);refresh();return()=>{watch();off();};},[room?.id,room?.revision]);
 return available;
}

export {observeConversationReady,hasConversationIndex} from './conversationState';
