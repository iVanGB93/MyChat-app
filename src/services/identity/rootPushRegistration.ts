import {getMessaging,getToken,onTokenRefresh,deleteToken} from '@react-native-firebase/messaging';
import {createGatewayPushRegistration} from './gatewayPushRegistration';
/** Registration is authenticated by the axon; no Django migration ticket or user ID. */
export function startRootPushRegistration(current:()=>boolean,request:(peer:string,raw:string)=>Promise<string|null>,peers:()=>string[]){
 const worker=createGatewayPushRegistration({current,peers,now:Date.now,token:()=>getToken(getMessaging()),
  rotateToken:()=>deleteToken(getMessaging()),request});
 let unsubscribe=()=>{};
 try{unsubscribe=onTokenRefresh(getMessaging(),()=>worker.invalidate());}catch{/* Devices without Firebase remain usable while open. */}
 return {...worker,stop(){worker.stop();unsubscribe();},revoke:async()=>{unsubscribe();return worker.revoke();}};
}
