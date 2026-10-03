import { startForegroundService, stopForegroundService } from '../../services/foregroundService';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../contexts/ThemeContext';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import { useContactName } from '../../hooks/useContactName';
import useWebRTC from '../../hooks/useWebRTC';
import { neuronCalls, subscribeNeuronCalls } from '../../services/identity/mobileNeuronCalls';
import type { NeuronCallView } from '../../services/identity/neuronCallCoordinator';
import { useAppStore } from '../../store/appStore';
import { playLooping, stopLooping } from '../../services/soundService';
import { restoreCallAudio, setCallSpeaker } from '../../services/call-audio-route';
import type { RootStackParamList } from '../../types';

/** Development-only foreground route. No Django call API or legacy signaling is used here. */
export default function NeuronCallScreen({route,navigation}:NativeStackScreenProps<RootStackParamList,'NeuronCall'>){
  const {colors:c,isDark}=useTheme(),insets=useSafeAreaInsets(),{ensure}=usePermissionPrompt();
  const [call,setCall]=useState<NeuronCallView|null>(neuronCalls()?.snapshot()??null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),id=route.params.callId;
  const name=useContactName()(call?.peerUser??0,route.params.otherName??call?.peerName??'Peer');
  useKeepAwake('neuron-call');
  useEffect(()=>subscribeNeuronCalls(view=>setCall(view?.id===id?view:null)),[id]);
  useEffect(()=>{
    if(!call||call.status==='ended')return;
    useAppStore.getState().setActiveCall({ownerId:useAppStore.getState().user?.id,callId:id,peerId:call.peerUser,peerName:name,callType:call.media,transport:'neuron',
      state:call.status==='ringing'?'ringing':'connecting'});
  },[call,id,name]);
  useEffect(()=>()=>{
    void neuronCalls()?.end(id).catch(()=>{});
    if(useAppStore.getState().activeCall?.callId===id)useAppStore.getState().setActiveCall(null);
    restoreCallAudio();
  },[id]);
  useEffect(()=>{
    if((!call||call.status==='ended')&&useAppStore.getState().activeCall?.callId===id)useAppStore.getState().setActiveCall(null);
  },[call?.status,id]);
  useEffect(()=>{
    if(call?.status!=='ringing')return;
    const tone=call.outgoing?'caller_ringback':'ringtone';
    playLooping(tone);return()=>{stopLooping();};
  },[call?.status,call?.outgoing]);
  const answer=async()=>{
    if(lock.current||!call)return;lock.current=true;setBusy(true);setError('');
    try{
      if(!await ensure(call.media==='video'?'camera+microphone':'microphone'))return;
      if(!await neuronCalls()?.accept(id))setError('This call is no longer available.');
    }catch{setError('Could not answer the call. Please try again.');}
    finally{lock.current=false;setBusy(false);}
  };
  const hangup=async()=>{try{await neuronCalls()?.end(id);}catch{setError('The call ended locally; peer notification is pending.');}};
  const close=()=>{if(navigation.canGoBack())navigation.goBack();else navigation.navigate('Main');};
  const ended=!call||call.status==='ended';
  return <View style={[styles.page,{backgroundColor:c.background,paddingTop:insets.top+24,paddingBottom:insets.bottom+24}]}>
    <StatusBar style={isDark?'light':'dark'}/>
    <Text style={[styles.title,{color:c.text}]}>{name}</Text>
    {call?.status==='ready'&&call.transport
      ?<Media key={id} call={call}/>
      :<View style={styles.center}><Text accessibilityLiveRegion="polite" style={{color:c.textSecondary,fontSize:20}}>
        {ended?(call?.reason??'Call disconnected'):call?.status==='connecting'?'Connecting…':call?.outgoing?'Calling…':`Incoming ${call?.media} call`}
      </Text></View>}
    {!!error&&<Text accessibilityRole="alert" style={{color:c.error}}>{error}</Text>}
    {!ended&&!call?.outgoing&&call?.status==='ringing'&&<TouchableOpacity testID="neuron-call-answer" accessibilityRole="button" accessibilityLabel="Answer neuron call" disabled={busy} onPress={()=>void answer()} style={[styles.button,{backgroundColor:c.primary}]}><Text style={[styles.buttonText,{color:'#071522'}]}>{busy?'ANSWERING…':'ANSWER'}</Text></TouchableOpacity>}
    <TouchableOpacity testID="neuron-call-end" accessibilityRole="button" accessibilityLabel={ended?'Close call':'End neuron call'} onPress={()=>ended?close():void hangup()} style={[styles.button,{backgroundColor:ended?c.surface:c.error}]}><Text style={[styles.buttonText,{color:ended?c.text:'#fff'}]}>{ended?'CLOSE':'END CALL'}</Text></TouchableOpacity>
  </View>;
}
function Media({call}:{call:NeuronCallView}){
  const {colors:c}=useTheme(),[connected,setConnected]=useState(false),[seconds,setSeconds]=useState(0),[speaker,setSpeaker]=useState(false);
  const started=useRef(false);
  const onConnected=useCallback(()=>{setConnected(true);useAppStore.getState().updateActiveCallState('connected');},[]);
  const onDisconnected=useCallback(()=>{void neuronCalls()?.end(call.id).catch(()=>{});},[call.id]);
  useEffect(()=>{if(connected)return;const timer=setTimeout(onDisconnected,45000);return()=>clearTimeout(timer);},[connected,onDisconnected]);
  useEffect(()=>{
    let cancelled=false;
    void startForegroundService('call',call.media).then(()=>{if(cancelled)void stopForegroundService('call');});
    return()=>{cancelled=true;void stopForegroundService('call');};
  },[call.id,call.media]);
  const rtc=useWebRTC({callId:call.id,callType:call.media,isOutgoing:call.outgoing,peerUserId:call.peerUser,
    mediaTransport:call.transport,onConnected,onDisconnected});
  useEffect(()=>{if(call.outgoing&&!started.current){started.current=true;void rtc.startAsOfferer();}},[call.outgoing,rtc.startAsOfferer]);
  useEffect(()=>{if(!connected)return;const timer=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(timer);},[connected]);
  const audio=async()=>{try{setSpeaker(await setCallSpeaker(!speaker));}catch{Alert.alert('Audio route unavailable','Could not change the speaker.');}};
  return <View style={styles.center}>
    <Text testID="neuron-media-status" accessibilityLiveRegion="polite" style={{color:c.textSecondary,fontSize:18}}>{connected?`Connected · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · ${rtc.connectionType}`:'Connecting media…'}</Text>
    {call.media==='video'&&<View style={styles.video}>
      {rtc.remoteStream&&<RTCView streamURL={rtc.remoteStream.toURL()} objectFit="contain" style={StyleSheet.absoluteFill}/>}
      {rtc.localStream&&<RTCView streamURL={rtc.localStream.toURL()} objectFit="cover" mirror style={styles.preview}/>}
    </View>}
    <View style={styles.controls}>
      <TouchableOpacity accessibilityRole="button" onPress={rtc.toggleMute} style={styles.control}><Text style={{color:c.text}}>{rtc.isMuted?'Unmute':'Mute'}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={()=>void audio()} style={styles.control}><Text style={{color:c.text}}>{speaker?'Earpiece':'Speaker'}</Text></TouchableOpacity>
      {call.media==='video'&&<><TouchableOpacity accessibilityRole="button" onPress={rtc.toggleCamera} style={styles.control}><Text style={{color:c.text}}>{rtc.isCameraOff?'Camera on':'Camera off'}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={rtc.switchCamera} style={styles.control}><Text style={{color:c.text}}>Flip</Text></TouchableOpacity></>}
    </View>
  </View>;
}
const styles=StyleSheet.create({page:{flex:1,paddingHorizontal:24,gap:16},title:{fontSize:26,fontWeight:'700',textAlign:'center'},center:{flex:1,justifyContent:'center',alignItems:'center',gap:20},button:{padding:20,borderRadius:16,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'700',fontSize:17},controls:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center'},control:{padding:16},video:{width:'100%',flex:1,minHeight:220},preview:{position:'absolute',right:8,top:8,width:100,height:140}});
