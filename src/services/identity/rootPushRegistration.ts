import {getMessaging,getToken,onTokenRefresh,deleteToken} from '@react-native-firebase/messaging';
import {createPushRegistration} from './pushRegistration';
import {FIRST_NEURON} from './internetAxonTransport';
/** Registration is authenticated by the axon; no Django migration ticket or user ID. */
export function startRootPushRegistration(current:()=>boolean,request:(peer:string,raw:string)=>Promise<string|null>){
 let status='waiting';
 const worker=createPushRegistration({current,now:Date.now,token:()=>getToken(getMessaging()),
  diagnostic:stage=>{status=stage;},rotateToken:()=>deleteToken(getMessaging()),request:raw=>request(FIRST_NEURON.account,raw)});
 let unsubscribe=()=>{};
 try{unsubscribe=onTokenRefresh(getMessaging(),()=>worker.invalidate());}catch{/* Devices without Firebase remain usable while open. */}
 return {tick:worker.tick,snapshot:()=>({status}),stop(){worker.stop();unsubscribe();},revoke:worker.revoke};
}
