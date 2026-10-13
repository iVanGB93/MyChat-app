import { requireOptionalNativeModule } from 'expo';
export type CallAudioDevice={id:string;kind:'speaker'|'phone'|'bluetooth'|'wired'|'usb'|'other';label:string;name:string};
export type CallAudioRoutes={automatic:boolean;selectedId:string|null;devices:CallAudioDevice[]};
type CallAudio = { setCallSpeaker?: (enabled: boolean) => Promise<boolean>; restoreCallAudio?: () => Promise<void>;
 startCallAudio?:(video:boolean)=>Promise<CallAudioRoutes>;getCallAudioRoutes?:()=>Promise<CallAudioRoutes|null>;
 selectCallAudioRoute?:(id:string)=>Promise<CallAudioRoutes>;addListener?:(event:string,listener:(routes:CallAudioRoutes)=>void)=>{remove():void}; };
const native = requireOptionalNativeModule<CallAudio>('AxonicAppUpdate');
let tail: Promise<unknown> = Promise.resolve();
function serialize<T>(work:()=>Promise<T>){const next=tail.then(work);tail=next.catch(()=>{});return next;}
export function startCallAudio(video:boolean){return serialize(()=>{
 if(!native?.startCallAudio)throw Error('Audio output selection requires an updated Android build.');
 return native.startCallAudio(video);
});}
export function getCallAudioRoutes(){return serialize(()=>native?.getCallAudioRoutes?.()??Promise.resolve(null));}
export function selectCallAudioRoute(id:string){return serialize(()=>{
 if(!native?.selectCallAudioRoute)throw Error('Audio output selection requires an updated Android build.');
 return native.selectCallAudioRoute(id);
});}
export function observeCallAudioRoutes(listener:(routes:CallAudioRoutes)=>void){
 try{return native?.addListener?.('onCallAudioRoute',listener)??{remove(){}};}catch{return {remove(){}};}
}
export function setCallSpeaker(enabled: boolean): Promise<boolean> {
  const work = tail.then(() => {
    if (!native?.setCallSpeaker) throw new Error('Speaker control requires an updated Android build.');
    return native.setCallSpeaker(enabled);
  });
  tail = work.catch(() => {});
  return work;
}
export function restoreCallAudio(): void {
  tail = tail.then(() => native?.restoreCallAudio?.()).catch(() => {});
}
