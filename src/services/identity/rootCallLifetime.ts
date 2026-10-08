import {AppState,NativeModules,Platform} from 'react-native';
import Native from '../../../modules/axonic-nearby';
/** Holds only an already-unlocked, live media call. Never unlocks from a push or starts in background. */
let lease:{id:string;connected:boolean;ready:boolean;generation:number}|null=null,generation=0;
let tail:Promise<unknown>=Promise.resolve();
const serialize=<T>(work:()=>Promise<T>)=>{const p=tail.then(work);tail=p.catch(()=>{});return p;};
export const rootCallMayRunBackground=()=>!!lease?.connected&&lease.ready;
export function startRootCallLease(id:string,kind:'voice'|'video'){
 const own={id,connected:false,ready:false,generation:++generation};lease=own;
 return serialize(async()=>{
  if(lease!==own||AppState.currentState!=='active')return false;
  if(Platform.OS!=='android')return false;
  try{
   await NativeModules.MyChatService.start(kind);
   if(lease!==own){await NativeModules.MyChatService.stop();return false;}
   own.ready=true;
   await NativeModules.MyChatService.update('Axonic','Call in progress');
   Native?.axonConnectedCall?.(own.connected);
   return true;
  }catch{own.ready=false;return false;}
 });
}
export function markRootCallConnected(id:string){if(lease?.id===id){lease.connected=true;Native?.axonConnectedCall?.(lease.ready);}}
export function stopRootCallLease(id:string){
 if(lease?.id!==id)return;lease=null;Native?.axonConnectedCall?.(false);
 void serialize(async()=>{if(Platform.OS==='android')await NativeModules.MyChatService?.stop();}).catch(()=>{});
}
