import {mediaDevices} from 'react-native-webrtc';
type PreviewStream={toURL():string;getTracks():{stop():void}[];release?():void};
/** Camera-only preview. Serialized teardown prevents competing with call acquisition. */
export function createCallCameraPreview(acquire:()=>Promise<PreviewStream>){
 let lease:{id:string;allowed():boolean}|null=null,stream:PreviewStream|null=null,tail:Promise<unknown>=Promise.resolve();
 const serial=<T>(work:()=>Promise<T>)=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
 const dispose=(value:PreviewStream|null)=>{if(!value)return;for(const track of value.getTracks())try{track.stop();}catch{}try{value.release?.();}catch{}};
 return {
  start(id:string,allowed:()=>boolean){const own={id,allowed};lease=own;return serial(async()=>{
   dispose(stream);stream=null;if(lease!==own||!allowed())return null;
   const acquired=await acquire();
   if(lease!==own||!allowed()){dispose(acquired);return null;}
   stream=acquired;return acquired;
  });},
  stop(id?:string){if(id&&lease?.id!==id)return Promise.resolve();lease=null;return serial(async()=>{dispose(stream);stream=null;});},
 };
}
export const callCameraPreview=createCallCameraPreview(()=>mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:640,height:480,frameRate:24}}));
