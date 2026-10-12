import type {RootChatReply} from '../../modules/messaging';
import {useIsFocused} from '@react-navigation/native';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,AppState,Easing,LayoutAnimation,Pressable,Text,Vibration,View} from 'react-native';
import {AudioModule,RecordingPresets,setAudioModeAsync,useAudioRecorder} from 'expo-audio';
import {File} from 'expo-file-system';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {localAccountCalls} from '../../modules/messaging';
import {queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience} from '../../modules/messaging';
import {createRootVoiceRecorder} from '../../modules/messaging';
import {chatRoomStyles as styles} from './chat-room-styles';
import {createVoiceRecordingGesture} from '../../utils/voice-recording-gesture';

const options={...RecordingPresets.HIGH_QUALITY,sampleRate:22050,numberOfChannels:1,bitRate:48000};
const callActive=()=>{const call=localAccountCalls()?.snapshot();return !!call&&call.status!=='ended';};
export default function RootVoiceComposer({peer,groupId,disabled,onError,onActive,reply,onSent}:{peer:string;groupId?:string;disabled:boolean;onError(error:unknown):void;onActive(active:boolean):void;reply?:RootChatReply;onSent?():void}){
 const focused=useIsFocused();
 const {colors}=useTheme(),recorder=useAudioRecorder(options),owner=localAccount.status().account;
 const [state,setState]=useState<'idle'|'starting'|'recording'|'sending'>('idle'),[seconds,setSeconds]=useState(0);
 const [gestureState,setGestureState]=useState({holding:false,cancelling:false});
 const [reduceMotion,setReduceMotion]=useState(true),motionPreference=useRef(true),wasActive=useRef(false);
 motionPreference.current=reduceMotion;
 const entry=useRef(new Animated.Value(1)).current,bin=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
  let alive=true,changed=false;
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive&&!changed)setReduceMotion(value);}).catch(()=>{});
  const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{changed=true;setReduceMotion(value);});
  return()=>{alive=false;subscription.remove();};
 },[]);
 const animateLayout=useCallback(()=>{if(!motionPreference.current)LayoutAnimation.configureNext({duration:180,create:{type:'easeInEaseOut',property:'opacity'},update:{type:'easeInEaseOut'},delete:{type:'easeInEaseOut',property:'opacity'}});},[]);
 const controller=useMemo(()=>createRootVoiceRecorder({
  current:()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner&&AppState.currentState==='active'&&!callActive(),
  permission:async()=>{
   if(callActive())throw Error('Finish your call before recording a voice message');
   if(groupId)await rootGroupAttachmentAudience(groupId,reply);
   // Recording is local. Verified recipient keys are required later, before encryption and delivery.
   // Android can briefly background the app even when requesting an already-granted
   // permission. That cancels this foreground-only recorder, so check first.
   const permission = await AudioModule.getRecordingPermissionsAsync();
   return permission.granted || (await AudioModule.requestRecordingPermissionsAsync()).granted;
  },
  mode:allowsRecording=>setAudioModeAsync({allowsRecording,playsInSilentMode:true,shouldPlayInBackground:false}),
  prepare:()=>recorder.prepareToRecordAsync(),record:()=>recorder.record({forDuration:300}),stop:()=>recorder.stop(),uri:()=>recorder.uri,
  remove:uri=>{try{const file=new File(uri);if(file.exists)file.delete();}catch{/* Native recorder can already have released its temporary file. */}},
  enqueue:async uri=>{if(!owner)throw Error('Unlock your account');if(groupId)await queueRootGroupAttachmentSource(await rootGroupAttachmentAudience(groupId,reply),uri,'Voice message.m4a','audio/mp4');else await queueRootAttachmentSource(peer,uri,'Voice message.m4a','audio/mp4',owner,reply);onSent?.();},
  now:Date.now,changed:s=>{const active=s!=='idle';if(wasActive.current!==active){animateLayout();wasActive.current=active;}setState(s);onActive(active);},
 }),[peer,groupId,owner,recorder,onActive,reply?.id,reply?.author,onSent,animateLayout]);
 const gesture=useMemo(()=>createVoiceRecordingGesture({start:()=>controller.start(),send:()=>controller.send(),cancel:()=>controller.cancel(),error:onError,held:()=>Vibration.vibrate(18),changed:(holding,cancelling)=>setGestureState({holding,cancelling}),schedule:setTimeout,clear:clearTimeout}),[controller,onError]);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s!=='active')gesture.terminate();});return()=>{sub.remove();gesture.dispose();void controller.dispose().catch(()=>{});};},[controller,gesture]);
 useEffect(()=>{if(disabled||!focused)gesture.terminate();},[disabled,focused,gesture]);
 useEffect(()=>{if(state!=='recording'){setSeconds(0);return;}const start=Date.now();const timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-start)/1000);setSeconds(elapsed);if(elapsed>=300||callActive())gesture.terminate();},250);return()=>clearInterval(timer);},[state,gesture]);
 const startRecording=()=>void controller.start().catch(onError);
 const active=state!=='idle'||gestureState.holding;
 useEffect(()=>{
  entry.stopAnimation();
  if(!active||reduceMotion){entry.setValue(1);return;}
  entry.setValue(0);
  const animation=Animated.timing(entry,{toValue:1,duration:160,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false});animation.start();
  return()=>animation.stop();
 },[active,reduceMotion,entry]);
 useEffect(()=>{
  bin.stopAnimation();const target=gestureState.cancelling?1:0;
  if(reduceMotion){bin.setValue(target);return;}
  const animation=Animated.spring(bin,{toValue:target,damping:18,stiffness:240,mass:0.7,useNativeDriver:true,isInteraction:false});animation.start();return()=>animation.stop();
 },[gestureState.cancelling,reduceMotion,bin]);
 return <View collapsable={false} accessible={!active} accessibilityRole={active?undefined:'button'} accessibilityLabel={active?undefined:'Record voice message'} accessibilityState={{disabled}} accessibilityHint="Tap to record with Send and Delete controls. Hold to record, release to send, or slide left to cancel."
  accessibilityActions={[{name:'activate',label:'Record voice message'}]} onAccessibilityAction={()=>{if(!disabled&&!active)startRecording();}} onAccessibilityTap={()=>{if(!disabled&&!active)startRecording();}}
  onStartShouldSetResponder={()=>!disabled&&state==='idle'} onResponderGrant={event=>gesture.press(event.nativeEvent.pageX)} onResponderMove={event=>gesture.move(event.nativeEvent.pageX)} onResponderRelease={event=>gesture.release(event.nativeEvent.pageX)} onResponderTerminationRequest={()=>false} onResponderTerminate={()=>gesture.terminate()}
  style={active?[styles.recordingTray,{backgroundColor:colors.surface,flex:1,gap:12,borderColor:gestureState.cancelling?colors.error:colors.neonBorder}]:[styles.sendBtn,{backgroundColor:colors.primary,opacity:disabled?0.45:1}]}>
  {!active?<Ionicons name="mic" size={24} color={colors.textInverse}/>:<Animated.View style={{flex:1,flexDirection:'row',alignItems:'center',gap:12,opacity:entry,transform:[{translateY:entry.interpolate({inputRange:[0,1],outputRange:[6,0]})}]}}>{gestureState.holding?<>
   <Animated.View style={{width:36,height:36,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,transform:[{scale:bin.interpolate({inputRange:[0,1],outputRange:[1,1.12]})}]}}><Animated.View style={{position:'absolute',width:36,height:36,borderRadius:18,backgroundColor:colors.error,opacity:bin}}/><Ionicons name="trash-outline" size={24} color={gestureState.cancelling?'#fff':colors.error}/></Animated.View>
   <Text style={{flex:1,color:gestureState.cancelling?colors.error:colors.text}}>{gestureState.cancelling?'Release to cancel':`‹ Slide left to cancel · ${seconds}s`}</Text>
   <Ionicons name="mic" size={24} color={colors.primary}/>
  </>:<>
  <Pressable accessibilityLabel="Cancel recording" onPress={()=>void controller.cancel().catch(onError)}><Ionicons name="trash-outline" size={24} color={colors.error}/></Pressable>
  <Text accessibilityLiveRegion="polite" style={{color:colors.text,flex:1}}>{state==='recording'?`Recording ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:state==='starting'?'Starting microphone…':'Sending voice message…'}</Text>
  <Pressable accessibilityLabel="Send voice message" disabled={state!=='recording'} onPress={()=>void controller.send().catch(onError)}><Ionicons name="send" size={24} color={colors.primary}/></Pressable>
  </>}</Animated.View>}
 </View>;
}
