import {CallLayout,EndButton} from './CallStage';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/ui/Avatar';
import { ActionButton, makeStyles } from './CallAppearance';
import { useCallNavigationGuard } from '../../hooks/use-call-navigation-guard';
import { setCallPictureInPictureEnabled, startForegroundService, stopForegroundService } from '../../services/foregroundService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../contexts/ThemeContext';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import { useContactName } from '../../hooks/useContactName';
import useWebRTC from '../../hooks/useWebRTC';
import { neuronCalls, subscribeNeuronCalls, holdIncomingCallPermission, waitForNeuronCallPeer } from '../../services/identity/mobileNeuronCalls';
import type { NeuronCallView } from '../../services/identity/neuronCallCoordinator';
import { useAppStore } from '../../store/appStore';
import { playLooping, stopLooping } from '../../services/soundService';
import { restoreCallAudio, setCallSpeaker } from '../../services/call-audio-route';
import type { RootStackParamList } from '../../types';

/** Familiar call presentation backed by authenticated neuron signaling. */
export default function NeuronCallScreen({route,navigation}:NativeStackScreenProps<RootStackParamList,'NeuronCall'>){
  const {colors:c,isDark}=useTheme(),insets=useSafeAreaInsets(),{ensure}=usePermissionPrompt();
  const [call,setCall]=useState<NeuronCallView|null>(neuronCalls()?.snapshot()??null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),alive=useRef(true),id=route.params.callId;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useCallNavigationGuard(!!call&&call.status!=='ended',useCallback(()=>{},[]));
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
    const owner=useAppStore.getState().user?.id,peer=call.peerUser;
    const release=owner?holdIncomingCallPermission(owner,id):()=>{};
    try{
      if(!await ensure(call.media==='video'?'camera+microphone':'microphone'))return;
      const calls=await waitForNeuronCallPeer(peer,()=>alive.current&&!!owner&&useAppStore.getState().user?.id===owner);
      if(!calls||!await calls.resumeIncoming(id)||!await calls.accept(id))setError('This call is no longer available.');
    }catch{setError('Could not answer the call. Please try again.');}
    finally{release();lock.current=false;setBusy(false);}
  };
  const hangup=async()=>{try{await neuronCalls()?.end(id);}catch{setError('The call ended locally; peer notification is pending.');}};
  const close=()=>{if(navigation.canGoBack())navigation.goBack();else navigation.navigate('Main');};
  const ended=!call||call.status==='ended';
  if(call?.status==='ready'&&call.transport)return <Media key={id} call={call} name={name} hangup={()=>void hangup()}/>;
  const status=ended?(call?.reason??'Call disconnected'):busy?'Preparing call…':call?.status==='connecting'?'Connecting…':call?.outgoing?'Ringing…':'Incoming '+call?.media+' call';
  return <CallLayout name={name} status={status} video={call?.media==='video'}>
    {!!error&&<Text accessibilityRole="alert" style={{color:c.error,textAlign:'center'}}>{error}</Text>}
    <View style={{flexDirection:'row',justifyContent:'space-evenly',padding:24}}>
      {!ended&&!call?.outgoing&&call?.status==='ringing'&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Answer neuron call" disabled={busy} onPress={()=>void answer()} style={[makeStyles(c).endBtn,{backgroundColor:c.success,opacity:busy?0.5:1}]}><Ionicons name="call" color="#fff" size={28}/></TouchableOpacity>}
      <EndButton ended={ended} onPress={()=>ended?close():void hangup()}/>
    </View>
  </CallLayout>;
}
function Media({call,name,hangup}:{call:NeuronCallView;name:string;hangup:()=>void}){
  const {colors:c}=useTheme(),[connected,setConnected]=useState(false),[seconds,setSeconds]=useState(0),[speaker,setSpeaker]=useState(false);
  const [controls,setControls]=useState(true),[foreground,setForeground]=useState(AppState.currentState==='active');
  const started=useRef(false),connectedAt=useRef<number|null>(null),audioBusy=useRef(false);
  const onConnected=useCallback(()=>{connectedAt.current??=Date.now();setConnected(true);useAppStore.getState().updateActiveCallState('connected');},[]);
  const onDisconnected=useCallback(()=>{void neuronCalls()?.end(call.id).catch(()=>{});},[call.id]);
  useCallNavigationGuard(true,useCallback(()=>setControls(true),[]));
  useEffect(()=>{if(connected)return;const timer=setTimeout(onDisconnected,45000);return()=>clearTimeout(timer);},[connected,onDisconnected]);
  useEffect(()=>{
    let cancelled=false;
    void startForegroundService('call',call.media).then(()=>{if(cancelled)void stopForegroundService('call');});
    return()=>{cancelled=true;void stopForegroundService('call');};
  },[call.id,call.media]);
  useEffect(()=>{void setCallPictureInPictureEnabled(call.media==='video'&&connected);return()=>{void setCallPictureInPictureEnabled(false);};},[call.media,connected]);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{setForeground(state==='active');setControls(state==='active');});return()=>sub.remove();},[]);
  const rtc=useWebRTC({callId:call.id,callType:call.media,isOutgoing:call.outgoing,peerUserId:call.peerUser,
    mediaTransport:call.transport,onConnected,onDisconnected});
  useEffect(()=>{if(call.outgoing&&!started.current){started.current=true;void rtc.startAsOfferer();}},[call.outgoing,rtc.startAsOfferer]);
  useEffect(()=>{if(!connected)return;const update=()=>setSeconds(Math.floor((Date.now()-(connectedAt.current??Date.now()))/1000));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[connected]);
  const audio=async()=>{if(audioBusy.current)return;audioBusy.current=true;try{setSpeaker(await setCallSpeaker(!speaker));}catch{Alert.alert('Audio route unavailable','Could not change the speaker.');}finally{audioBusy.current=false;}};
  const video=call.media==='video',styles=useMemo(()=>makeStyles(c),[c]);
  const remote=rtc.remoteStream?.toURL(),local=rtc.localStream?.toURL();
  const background=video&&<>
    {(remote||local)&&<RTCView streamURL={(remote||local)!} objectFit="cover" mirror={!remote} style={styles.fullVideo} zOrder={0}/>}
    <Pressable accessibilityRole="button" accessibilityLabel={controls?'Hide call controls':'Show call controls'} onPress={()=>setControls(v=>!v)} style={StyleSheet.absoluteFill}/>
    {remote&&local&&foreground&&<View pointerEvents="none" style={styles.pipWrap}><RTCView streamURL={local} objectFit="cover" mirror style={styles.pip} zOrder={1}/></View>}
  </>;
  return <CallLayout name={name} video={video} status={connected?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):'Connecting…'} background={background} show={!video||controls} avatar={!video||(!remote&&!local)}>
    <View style={[styles.actions,{alignItems:'flex-start',paddingHorizontal:8}]}>
      <ActionButton icon={rtc.isMuted?'mic-off':'mic'} label={rtc.isMuted?'Unmute':'Mute'} active={rtc.isMuted} onPress={rtc.toggleMute} Colors={c} size={video?52:64}/>
      {video&&<ActionButton icon={rtc.isCameraOff?'videocam-off':'videocam'} label={rtc.isCameraOff?'Cam On':'Cam Off'} active={rtc.isCameraOff} onPress={rtc.toggleCamera} Colors={c} size={52}/>}
      <EndButton onPress={hangup}/>
      {video&&<ActionButton icon="camera-reverse-outline" label="Flip" onPress={rtc.switchCamera} Colors={c} size={52}/>}
      <ActionButton icon="volume-high-outline" label="Speaker" active={speaker} onPress={()=>void audio()} Colors={c} size={video?52:64}/>
    </View>
  </CallLayout>;
}
