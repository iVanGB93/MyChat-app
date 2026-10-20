import {getMessaging,getToken,onTokenRefresh,deleteToken} from '@react-native-firebase/messaging';
import {createPushRegistration} from './pushRegistration';
import {FIRST_NEURON} from './internetAxonTransport';
import {createEventDeadlineTask} from './eventDeadlineTask';
/** Registration is authenticated by the axon; no Django migration ticket or user ID. */
export function startRootPushRegistration(current:()=>boolean,request:(peer:string,raw:string)=>Promise<string|null>){
 let status='waiting';
 const worker=createPushRegistration({current,now:Date.now,token:()=>getToken(getMessaging()),
  diagnostic:stage=>{status=stage;},rotateToken:()=>deleteToken(getMessaging()),request:raw=>request(FIRST_NEURON.account,raw)});
 const task=createEventDeadlineTask({now:Date.now,run:async()=>{await worker.tick();return worker.nextDeadline();}});
 task.changed();
 let unsubscribe=()=>{};
 try{unsubscribe=onTokenRefresh(getMessaging(),()=>{worker.invalidate();task.changed();});}catch{/* Devices without Firebase remain usable while open. */}
 return {tick:worker.tick,connected(){if(status!=='registered')worker.invalidate();task.changed();},snapshot:()=>({status}),stop(){task.stop();worker.stop();unsubscribe();},revoke:async()=>{task.stop();return worker.revoke();}};
}
