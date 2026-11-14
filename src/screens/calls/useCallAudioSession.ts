import {t} from '../../localization/language';
import {useEffect,useRef,useState} from 'react';
import {AppState,DeviceEventEmitter} from 'react-native';
import {useKeepAwake} from 'expo-keep-awake';
import {localAccountCalls,startRootCallLease,stopRootCallLease} from '../../modules/calls';
import {startCallAudio,getCallAudioRoutes,selectCallAudioRoute,observeCallAudioRoutes,restoreCallAudio,type CallAudioRoutes} from '../../services/call-audio-route';

/** Exactly one OS/audio owner per call, regardless of participant count. */
export function useCallAudioSession(id:string,video:boolean){
 useKeepAwake('root-call-session');
 const [audioRoutes,setAudioRoutes]=useState<CallAudioRoutes|null>(null),[error,setError]=useState(''),[foreground,setForeground]=useState(AppState.currentState==='active');
 const busy=useRef(false),epoch=useRef(0);
 useEffect(()=>{
  const generation=++epoch.current;let active=true;
  const update=(routes:CallAudioRoutes)=>{if(active)setAudioRoutes(routes);};
  const hangUp=DeviceEventEmitter.addListener('AxonicCallHangUp',(callId:string)=>{
   const calls=localAccountCalls(),current=calls?.snapshot();
   if(active&&callId===id&&current?.id===id&&current.status!=='ended')void calls?.end(id).catch(()=>{});
  });
  void startRootCallLease(id,video?'video':'voice');
  const listener=observeCallAudioRoutes(update);
  void startCallAudio(video).then(update).catch(e=>{if(active)setError(e instanceof Error?e.message:t("Unable to select audio output."));});
  const state=AppState.addEventListener('change',s=>{setForeground(s==='active');if(s==='active')void getCallAudioRoutes().then(r=>{if(r)update(r);}).catch(()=>{});});
  return()=>{active=false;if(epoch.current===generation)epoch.current++;hangUp.remove();listener.remove();state.remove();stopRootCallLease(id);restoreCallAudio();};
 },[id,video]);
 const routeAudio=async(route:string)=>{if(busy.current)return;busy.current=true;const generation=epoch.current;setError('');try{const routes=await selectCallAudioRoute(route);if(epoch.current===generation)setAudioRoutes(routes);}catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:t("Unable to change audio output."));}finally{busy.current=false;}};
 return {audioRoutes,routeAudio,audioError:error,foreground};
}
