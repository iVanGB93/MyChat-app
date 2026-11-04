/** Capture belongs to the room, never to an individual peer leg. A late capture
 * result after hangup is stopped immediately. Acquisition is single-flight. */
export function createGroupCallCapture<S extends {getTracks():{stop():void;kind:string;enabled:boolean}[];release?():void}>(acquire:()=>Promise<S>){
 let stopped=false,stream:S|null=null,flight:Promise<S>|null=null,muted=false,cameraOff=false;
 const apply=()=>stream?.getTracks().forEach(t=>{t.enabled=t.kind==='audio'?!muted:!cameraOff;});
 const dispose=(s:S)=>{for(const track of s.getTracks())try{track.stop();}catch{}try{s.release?.();}catch{}};
 return {
  acquire(){
   if(stopped)return Promise.reject(Error('Group call ended'));
   if(stream)return Promise.resolve(stream);
   return flight??=(async()=>{
    const next=await acquire();
    if(stopped){dispose(next);throw Error('Group call ended during capture');}
    stream=next;apply();return next;
   })().finally(()=>{flight=null;});
  },
  mute(value:boolean){muted=value;apply();},cameraOff(value:boolean){cameraOff=value;apply();},
  stop(){if(stopped)return;stopped=true;if(stream)dispose(stream);stream=null;},
 };
}
