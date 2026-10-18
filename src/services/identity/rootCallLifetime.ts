import {AppState,NativeModules,Platform} from 'react-native';
import Native from '../../../modules/axonic-nearby';
/** Holds only an already-unlocked, live media call. Never unlocks from a push or starts in background. */
let lease:{id:string;connected:boolean;ready:boolean;sharing:boolean;generation:number}|null=null,generation=0;
let tail:Promise<unknown>=Promise.resolve();
const serialize=<T>(work:()=>Promise<T>)=>{const p=tail.then(work);tail=p.catch(()=>{});return p;};
const pictureInPicture=async(enabled:boolean)=>{
 if(Platform.OS!=='android')return;
 try{await NativeModules.MyChatService?.setPictureInPictureEnabled?.(enabled);}catch{/* Keep media alive if the device or OS policy does not allow PiP. */}
};
export const rootCallMayRunBackground=()=>!!lease?.connected&&lease.ready;
export function startRootCallLease(id:string,kind:'voice'|'video'){
 const own={id,connected:false,ready:false,sharing:false,generation:++generation};lease=own;
 return serialize(async()=>{
  if(lease!==own||AppState.currentState!=='active')return false;
  if(Platform.OS!=='android')return false;
  try{
   await pictureInPicture(false);
   if(lease!==own)return false;
   await NativeModules.MyChatService.start(kind);
   if(lease!==own){await NativeModules.MyChatService.stop();return false;}
   own.ready=true;
   await NativeModules.MyChatService.update('Axonic','Call in progress');
   Native?.axonConnectedCall?.(own.connected);
   if(lease===own)await pictureInPicture(own.connected&&!own.sharing);
   return true;
  }catch{own.ready=false;return false;}
 });
}
export function markRootCallConnected(id:string){if(lease?.id===id){const own=lease;own.connected=true;Native?.axonConnectedCall?.(own.ready);void serialize(async()=>{if(lease===own&&own.ready)await pictureInPicture(!own.sharing);});}}
export function setRootCallSharing(id:string,sharing:boolean){
 if(lease?.id!==id)return Promise.resolve();const own=lease;own.sharing=sharing;
 return serialize(async()=>{if(lease===own)await pictureInPicture(own.ready&&own.connected&&!own.sharing);});
}
export function stopRootCallLease(id:string){
 if(lease?.id!==id)return;lease=null;Native?.axonConnectedCall?.(false);
 void serialize(async()=>{await pictureInPicture(false);if(Platform.OS==='android')await NativeModules.MyChatService?.stop();}).catch(()=>{});
}
