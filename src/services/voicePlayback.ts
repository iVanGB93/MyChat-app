import type {AudioStatus} from 'expo-audio';
import type {RootChatMessage} from '../modules/messaging';

export function voiceMessageKey(message:RootChatMessage){
 return JSON.stringify([message.group?.id??null,message.direction==='incoming'||!message.group?message.peer:null,message.direction,message.group?.messageId??message.id]);
}
export function nextVoiceMessage(current:RootChatMessage,next?:RootChatMessage){
 if(!next||current.group?.id!==next.group?.id||current.direction!==next.direction||
  (current.direction==='incoming'||!current.group)&&current.peer!==next.peer||
  !current.attachment?.mime.startsWith('audio/')||!next.attachment?.mime.startsWith('audio/')||next.deleted||next.localPending)return undefined;
 return voiceMessageKey(next);
}

type Clip={stop():void;start(automatic?:boolean):void};
const registered=new Map<string,Clip>();
let active:Clip|undefined;
const registrationKey=(owner:string,key:string)=>JSON.stringify([owner,key]);

/** One audio owner. Only an audible, naturally completed clip hands off to its immediate neighbor. */
export function createVoicePlayback(d:{
 player:{play():void;pause():void;seekTo(seconds:number):Promise<unknown>;currentStatus:AudioStatus};
 prepare():Promise<unknown>;allowed():boolean;observe(check:()=>void):()=>void;
 preparing(value:boolean):void;error(reason:'blocked'|'failed'):void;next():{owner:string;key:string}|undefined;
}){
 let phase:'idle'|'loading'|'starting'|'playing'='idle',generation=0,issued=false,fromBeginning=false,endingSeek=false;
 let timer:ReturnType<typeof setTimeout>|undefined,detach:(()=>void)|undefined;
 const clearStartup=()=>{clearTimeout(timer);timer=undefined;};
 const release=()=>{
  generation++;phase='idle';issued=false;endingSeek=false;
  clearStartup();detach?.();detach=undefined;
  if(active===clip)active=undefined;
  d.preparing(false);
 };
 const stop=()=>{if(phase==='idle')return;release();try{d.player.pause();}catch{/* The native player may already be gone. */}};
 const check=()=>{if(!d.allowed())stop();};
 async function ready(status:AudioStatus){
  if(phase!=='loading'||!status.isLoaded)return;
  phase='starting';
  const attempt=generation,wanted=()=>attempt===generation&&d.allowed();
  const rewind=fromBeginning&&status.currentTime>0.05||status.didJustFinish||status.playbackState==='ended'||status.duration>0&&status.currentTime>=status.duration-0.05;
  try{
   if(!fromBeginning)await d.prepare();
   if(!wanted()){if(attempt===generation)stop();return;}
   if(rewind)await d.player.seekTo(0);
   if(!wanted()){if(attempt===generation)stop();return;}
   issued=true;d.player.play();
  }catch{if(attempt===generation){stop();d.error('failed');}}
 }
 function start(automatic=false){
  if(!d.allowed()){if(!automatic)d.error('blocked');return;}
  if(active===clip)return;
  active?.stop();
  active=clip;phase='loading';fromBeginning=automatic;issued=false;endingSeek=false;
  d.preparing(true);
  const off=d.observe(check);
  if(active!==clip){off();return;}
  detach=off;
  timer=setTimeout(()=>{stop();d.error('failed');},8000);
  try{void ready(d.player.currentStatus);}catch{stop();d.error('failed');}
 }
 const clip:Clip={stop,start};
 return {
  toggle(){if(phase==='idle')start();else stop();},
  check,stop,
  seek(position:number,duration:number){endingSeek=duration>0&&position>=duration-0.05;},
  status(status:AudioStatus){
   if(phase==='loading'){void ready(status);return;}
   if(phase==='starting'&&issued&&status.playing){
    phase='playing';clearStartup();d.preparing(false);
   }
   if(phase!=='playing')return;
   if(status.didJustFinish){
    const next=!endingSeek&&d.allowed()?d.next():undefined;
    release();
    if(next)registered.get(registrationKey(next.owner,next.key))?.start(true);
   }else if(!status.playing&&!status.isBuffering&&status.playbackState!=='ended'&&status.timeControlStatus!=='waiting'){
    // Audio focus loss or an external pause ends the sequence.
    release();
   }
  },
  bind(owner:string,key:string){const id=registrationKey(owner,key);registered.set(id,clip);return()=>{if(registered.get(id)===clip)registered.delete(id);};},
 };
}
