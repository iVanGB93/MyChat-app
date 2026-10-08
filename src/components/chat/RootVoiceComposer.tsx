import type {RootChatReply} from '../../modules/messaging';
import {useIsFocused} from '@react-navigation/native';
import React,{useEffect,useMemo,useState} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import {AudioModule,RecordingPresets,setAudioModeAsync,useAudioRecorder} from 'expo-audio';
import {File} from 'expo-file-system';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {localAccountCalls} from '../../modules/messaging';
import {queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience} from '../../modules/messaging';
import {createRootVoiceRecorder} from '../../modules/messaging';
import {chatRoomStyles as styles} from './chat-room-styles';

const options={...RecordingPresets.HIGH_QUALITY,sampleRate:22050,numberOfChannels:1,bitRate:48000};
const callActive=()=>{const call=localAccountCalls()?.snapshot();return !!call&&call.status!=='ended';};
export default function RootVoiceComposer({peer,groupId,disabled,onError,onActive,reply,onSent}:{peer:string;groupId?:string;disabled:boolean;onError(error:unknown):void;onActive(active:boolean):void;reply?:RootChatReply;onSent?():void}){
 const focused=useIsFocused();
 const {colors}=useTheme(),recorder=useAudioRecorder(options),owner=localAccount.status().account;
 const [state,setState]=useState<'idle'|'starting'|'recording'|'sending'>('idle'),[seconds,setSeconds]=useState(0);
 const controller=useMemo(()=>createRootVoiceRecorder({
  current:()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner&&AppState.currentState==='active'&&!callActive(),
  permission:async()=>{
   if(callActive())throw Error('Finish your call before recording a voice message');
   if(groupId)await rootGroupAttachmentAudience(groupId);
   // Recording is local. Verified recipient keys are required later, before encryption and delivery.
   // Android can briefly background the app even when requesting an already-granted
   // permission. That cancels this foreground-only recorder, so check first.
   const permission = await AudioModule.getRecordingPermissionsAsync();
   return permission.granted || (await AudioModule.requestRecordingPermissionsAsync()).granted;
  },
  mode:allowsRecording=>setAudioModeAsync({allowsRecording,playsInSilentMode:true,shouldPlayInBackground:false}),
  prepare:()=>recorder.prepareToRecordAsync(),record:()=>recorder.record({forDuration:300}),stop:()=>recorder.stop(),uri:()=>recorder.uri,
  remove:uri=>{try{const file=new File(uri);if(file.exists)file.delete();}catch{/* Native recorder can already have released its temporary file. */}},
  enqueue:async uri=>{if(!owner)throw Error('Unlock your account');if(groupId)await queueRootGroupAttachmentSource(await rootGroupAttachmentAudience(groupId),uri,'Voice message.m4a','audio/mp4');else await queueRootAttachmentSource(peer,uri,'Voice message.m4a','audio/mp4',owner,reply);onSent?.();},
  now:Date.now,changed:s=>{setState(s);onActive(s!=='idle');},
 }),[peer,groupId,owner,recorder,onActive,reply?.id,reply?.author,onSent]);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s!=='active')void controller.cancel().catch(()=>{});});return()=>{sub.remove();void controller.dispose().catch(()=>{});};},[controller]);
 useEffect(()=>{if(disabled||!focused)void controller.cancel().catch(onError);},[disabled,focused,controller]);
 useEffect(()=>{if(state!=='recording'){setSeconds(0);return;}const start=Date.now();const timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-start)/1000);setSeconds(elapsed);if(elapsed>=300||callActive())void controller.cancel().catch(onError);},250);return()=>clearInterval(timer);},[state,controller]);
 const startRecording=()=>void controller.start().catch(onError);
 if(state==='idle')return <Pressable accessibilityRole="button" accessibilityLabel="Record voice message" accessibilityHint="Tap or hold to start recording, then use Send or Cancel." disabled={disabled} onPress={startRecording} onLongPress={startRecording} delayLongPress={500} style={[styles.sendBtn,{backgroundColor:colors.primary,opacity:disabled?0.45:1}]}><Ionicons name="mic" size={24} color={colors.textInverse}/></Pressable>;
 return <View style={[styles.recordingTray,{backgroundColor:colors.surface,flex:1,gap:12}]}>
  <Pressable accessibilityLabel="Cancel recording" onPress={()=>void controller.cancel().catch(onError)}><Ionicons name="trash-outline" size={24} color={colors.error}/></Pressable>
  <Text accessibilityLiveRegion="polite" style={{color:colors.text,flex:1}}>{state==='recording'?`Recording ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:state==='starting'?'Starting microphone…':'Sending voice message…'}</Text>
  <Pressable accessibilityLabel="Send voice message" disabled={state!=='recording'} onPress={()=>void controller.send().catch(onError)}><Ionicons name="send" size={24} color={colors.primary}/></Pressable>
 </View>;
}
