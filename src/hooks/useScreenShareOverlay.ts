import {useEffect,useRef} from 'react';
import {DeviceEventEmitter,NativeModules,Platform} from 'react-native';
import {setRootCallSharing} from '../services/identity/rootCallLifetime';

export const hasScreenShareOverlay=()=>Platform.OS==='android'&&typeof NativeModules.MyChatService?.prepareShareOverlay==='function';
export async function allowScreenShareOverlay(){
 if(!hasScreenShareOverlay())return true;
 return NativeModules.MyChatService.requestShareOverlayPermission() as Promise<boolean>;
}
export function useScreenShareOverlay(id:string,sharing:boolean,muted:boolean,exclude:(fraction:number)=>Promise<void>,mute:()=>void,stop:()=>Promise<void>,end:()=>void,onError:(message:string)=>void){
 const latest=useRef({muted,exclude,mute,stop,end,onError});latest.current={muted,exclude,mute,stop,end,onError};
 const ready=useRef(false);
 useEffect(()=>{
  if(!sharing||!hasScreenShareOverlay())return;
  const native=NativeModules.MyChatService;let active=true,revision=0;ready.current=false;
  const fail=()=>{if(active){latest.current.onError('Screen sharing stopped because its controls could not be displayed safely.');void latest.current.stop();}};
  const apply=async(fraction:number)=>{
   const own=++revision;ready.current=false;
   if(!Number.isFinite(fraction)||fraction<0||fraction>0.45)throw Error('Invalid overlay bounds');
   await latest.current.exclude(fraction);
   if(active&&own===revision){ready.current=true;native.showShareOverlay(latest.current.muted);}
  };
  const listener=DeviceEventEmitter.addListener('AxonicShareControls',event=>{
   if(!active)return;
   if(event.action==='mute')latest.current.mute();
   else if(event.action==='stop')void latest.current.stop();
   else if(event.action==='end')latest.current.end();
   else if(event.action==='layout')void apply(event.fraction).catch(fail);
  });
  void (async()=>{
   await setRootCallSharing(id,true);
   if(!active)return;
   const fraction=await native.prepareShareOverlay(latest.current.muted);
   if(active)await apply(fraction);
  })().catch(fail);
  return()=>{active=false;revision++;ready.current=false;listener.remove();native.hideShareOverlay();void setRootCallSharing(id,false);};
 },[id,sharing]);
 useEffect(()=>{if(sharing&&hasScreenShareOverlay())NativeModules.MyChatService.updateShareOverlayMute(muted);},[sharing,muted]);
}
