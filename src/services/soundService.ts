import {Vibration} from 'react-native';
/** Foreground call tones. OS notifications own background notification sounds. */
import {createAudioPlayer,setAudioModeAsync,type AudioPlayer} from 'expo-audio';
import {getRingerMode} from './ringerService';
type CallTone='ringtone'|'caller_ringback';
const files:Record<CallTone|'message_sent'|'message_received',number>={
 message_sent:require('../../assets/sounds/message_sent.wav'),
 message_received:require('../../assets/sounds/message_received.wav'),
 ringtone:require('../../assets/sounds/ringtone.mp3'),
 caller_ringback:require('../../assets/sounds/caller_ringback.wav'),
};
let player:AudioPlayer|null=null,token=0;
function release(){const current=player;player=null;if(current)try{current.pause();current.remove();}catch{}}
export async function playLooping(name:CallTone):Promise<void>{
 // Claim after releasing the old tone; stop() must only invalidate earlier starts.
 const own=++token;release();
 try{
  const mode=await getRingerMode();if(own!==token||mode!=='normal')return;
  await setAudioModeAsync({playsInSilentMode:true,shouldPlayInBackground:false});
  if(own!==token)return;
  const next=createAudioPlayer(files[name]);
  try{next.loop=true;next.play();}catch(error){try{next.remove();}catch{}throw error;}
  if(own!==token){try{next.pause();next.remove();}catch{}return;}
  player=next;
 }catch{console.warn('[SoundService] Call tone unavailable');}
}
export async function stopLooping():Promise<void>{token++;release();}

let effectToken=0,effect:AudioPlayer|null=null,effectListener:{remove():void}|null=null,effectTimer:ReturnType<typeof setTimeout>|undefined;
function releaseEffect(){if(effectTimer)clearTimeout(effectTimer);effectTimer=undefined;effectListener?.remove();effectListener=null;const own=effect;effect=null;if(own)try{own.pause();own.remove();}catch{}}
export function stopMessageSounds(){effectToken++;releaseEffect();}
/** Short foreground effects never outlive their account/screen or retain orphan audio players. */
export async function playMessageSound(name:'message_sent'|'message_received',current:()=>boolean){
 const own=++effectToken;releaseEffect();
 const valid=()=>own===effectToken&&current();
 try{
  const mode=await getRingerMode();if(!valid()||mode==='silent')return;
  if(mode==='vibrate'){Vibration.vibrate(40);return;}
  await setAudioModeAsync({playsInSilentMode:true,shouldPlayInBackground:false});if(!valid())return;
  const next=createAudioPlayer(files[name]);effect=next;
  effectListener=next.addListener('playbackStatusUpdate',status=>{if(status.didJustFinish&&effect===next)releaseEffect();});
  effectTimer=setTimeout(()=>{if(effect===next)releaseEffect();},5000);
  next.play();
 }catch{if(own===effectToken)releaseEffect();}
}
