import {readRootNotificationPreferences} from '../../modules/messaging/notifications';
import {localAccount} from '../../modules/identity';
import {shortIdentity} from '../../modules/identity';
import {startRootCallLease,stopRootCallLease,markRootCallConnected} from '../../modules/messaging';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Modal,Text,View,Pressable,StyleSheet,ScrollView,TouchableOpacity} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {CallLayout,EndButton} from './CallStage';
import IncomingCallAppearance from './IncomingCallAppearance';
import {conversations} from '../../modules/messaging';
import {playLooping,stopLooping} from '../../services/soundService';
import type {VideoQualityMode} from '../../services/video-quality';
import {RTCView} from 'react-native-webrtc';
import {AudioModule} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import {useKeepAwake} from 'expo-keep-awake';
import {localAccountCalls,subscribeLocalAccountCalls} from '../../modules/messaging';
import type {NeuronCallView} from '../../modules/messaging';
import useWebRTCCore from '../../hooks/useWebRTCCore';
import {useTheme} from '../../contexts/ThemeContext';
import {ActionButton,makeStyles} from './CallAppearance';
import Avatar from '../../components/ui/Avatar';
import {setCallSpeaker,restoreCallAudio} from '../../services/call-audio-route';

export async function ensureRootCallPermissions(kind:'voice'|'video'){
 if(!(await AudioModule.getRecordingPermissionsAsync()).granted&&!(await AudioModule.requestRecordingPermissionsAsync()).granted)throw Error('Allow microphone access to make or answer calls.');
 if(kind==='video'&&!(await ImagePicker.getCameraPermissionsAsync()).granted&&!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw Error('Allow camera access for video calls.');
}
export default function RootAccountCallScreen(){
 const [call,setCall]=useState<NeuronCallView<string>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const running=useRef(false),{colors}=useTheme(),[name,setName]=useState('');
 useEffect(()=>{let alive=true;const peer=call?.peerUser;if(!peer)return;setName(shortIdentity(peer));const refresh=async()=>{try{const s=await conversations().snapshot();if(alive)setName(s.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer));}catch{if(alive)setName(shortIdentity(peer));}};void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{alive=false;clearInterval(timer);};},[call?.peerUser]);
 useEffect(()=>{if(call?.status!=='ringing')return;let active=true;const owner=localAccount.status().account;if(owner)void readRootNotificationPreferences(owner).then(p=>{if(active&&p.sound)playLooping(call.outgoing?'caller_ringback':'ringtone');}).catch(()=>{});return()=>{active=false;stopLooping();};},[call?.status,call?.outgoing]);
 useEffect(()=>subscribeLocalAccountCalls(v=>{setCall(v);setError('');}),[]);
 const end=()=>{if(call)void localAccountCalls()?.end(call.id).catch(()=>setError('Call ended locally; peer notification is pending.'));};
 const answer=async()=>{
  if(!call||running.current)return;running.current=true;setBusy(true);setError('');
  const calls=localAccountCalls();
  try{await ensureRootCallPermissions(call.media);if(calls!==localAccountCalls()||!await calls?.accept(call.id))throw Error('This call is no longer available.');}
  catch(e){setError(e instanceof Error?e.message:'Unable to answer');}finally{running.current=false;setBusy(false);}
 };
 if(!call)return null;
 const ended=call.status==='ended';
 const status=ended?call.reason??'Call ended':call.status==='connecting'?'Connecting…':call.outgoing?'Ringing…':'Incoming '+call.media+' call';
 return <Modal visible animationType="slide" onRequestClose={()=>ended?setCall(null):end()}>
  <StatusBar style="light"/>
  {call.status==='ready'&&call.transport?<RootMedia key={call.id} call={call} name={name} end={end}/>:!call.outgoing&&call.status==='ringing'?<IncomingCallAppearance callerName={name} isVideo={call.media==='video'} busy={busy} error={error} handleAccept={()=>void answer()} handleReject={end}/>:<CallLayout name={name} status={status} video={call.media==='video'}>
   {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
   <View style={{alignItems:'center',padding:24}}><EndButton ended={ended} onPress={()=>ended?setCall(null):end()}/></View>
  </CallLayout>}
 </Modal>;
}

function RootMedia({call,name,end}:{call:NeuronCallView<string>;name:string;end:()=>void}){
 useKeepAwake('root-account-call');
 const {colors}=useTheme(),styles=makeStyles(colors),[connected,setConnected]=useState(false),[speaker,setSpeaker]=useState(false),[error,setError]=useState('');
 const started=useRef(false),audioBusy=useRef(false),connectedAt=useRef<number|null>(null);
 const insets=useSafeAreaInsets(),[seconds,setSeconds]=useState(0),[controls,setControls]=useState(true),[options,setOptions]=useState(false),[foreground,setForeground]=useState(AppState.currentState==='active');
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);
 useEffect(()=>{if(!connected)return;const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-connectedAt.current!)/1000)),1000);return()=>clearInterval(timer);},[connected]);
 const onConnected=useCallback(()=>{connectedAt.current??=Date.now();setConnected(true);markRootCallConnected(call.id);},[call.id]);
 const endRef=useRef(end);endRef.current=end;const onDisconnected=useCallback(()=>endRef.current(),[]);
 const rtc=useWebRTCCore({callId:call.id,callType:call.media,peerUserId:call.peerUser,isOutgoing:call.outgoing,mediaTransport:call.transport,onConnected,onDisconnected});
 useEffect(()=>{if(call.outgoing&&!started.current){started.current=true;void rtc.startAsOfferer();}},[call.outgoing,rtc.startAsOfferer]);
 useEffect(()=>{if(connected)return;const timer=setTimeout(end,45000);return()=>clearTimeout(timer);},[connected,call.id]);
 useEffect(()=>{void startRootCallLease(call.id,call.media);return()=>{stopRootCallLease(call.id);restoreCallAudio();};},[call.id,call.media]);
 const routeAudio=async()=>{if(audioBusy.current)return;audioBusy.current=true;try{setSpeaker(await setCallSpeaker(!speaker));}catch{setError('Unable to change speaker.');}finally{audioBusy.current=false;}};
 const remote=rtc.remoteStream?.toURL(),local=rtc.localStream?.toURL(),video=call.media==='video';
 const background=video&&<>
  {(remote||local)&&<RTCView streamURL={(remote||local)!} objectFit="cover" mirror={!remote} style={styles.fullVideo} zOrder={0}/>}
  <Pressable accessibilityRole="button" accessibilityLabel={controls?'Hide call controls':'Show call controls'} onPress={()=>setControls(v=>!v)} style={StyleSheet.absoluteFill}/>
  {remote&&local&&foreground&&<View pointerEvents="none" style={styles.pipWrap}><RTCView streamURL={local} objectFit="cover" mirror style={styles.pip} zOrder={1}/></View>}
 </>;
 const quality=rtc.callQuality;
 return <>
 <CallLayout name={name} video={video} status={connected?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):'Connecting…'} background={background} show={!video||controls} avatar={!video||(!remote&&!local)}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
  {video&&quality.level!=='unknown'&&<Text style={[styles.quality,{textAlign:'center',color:quality.level==='good'?colors.success:quality.level==='fair'?colors.warning:colors.error}]}>{quality.level.toUpperCase()}{quality.roundTripTimeMs!=null?` • ${quality.roundTripTimeMs} ms`:''}{quality.packetLossPercent!=null?` • ${quality.packetLossPercent}% loss`:''}</Text>}
  <View style={[styles.actions,video&&{paddingHorizontal:8}]}>
   <ActionButton size={video?52:64} icon={rtc.isMuted?'mic-off':'mic'} label={rtc.isMuted?'Unmute':'Mute'} active={rtc.isMuted} onPress={rtc.toggleMute} Colors={colors}/>
   {video&&<ActionButton size={52} icon={rtc.isCameraOff?'videocam-off':'videocam'} label={rtc.isCameraOff?'Cam On':'Cam Off'} active={rtc.isCameraOff} onPress={rtc.toggleCamera} Colors={colors}/>}
   <EndButton video={video} onPress={end}/>
   {video&&<ActionButton size={52} icon="camera-reverse-outline" label="Flip" onPress={rtc.switchCamera} Colors={colors}/>}
   {video?<ActionButton size={52} icon="options-outline" label="Options" onPress={()=>setOptions(true)} Colors={colors}/>:<ActionButton icon="volume-high-outline" label="Speaker" active={speaker} onPress={()=>void routeAudio()} Colors={colors}/>}
  </View>
 </CallLayout>
 <Modal visible={options&&video} transparent animationType="slide" onRequestClose={()=>setOptions(false)}>
  <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.55)'}}><Pressable accessibilityLabel="Close call options" onPress={()=>setOptions(false)} style={StyleSheet.absoluteFill}/>
   <ScrollView style={{flexGrow:0,backgroundColor:colors.background,borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:'85%'}} contentContainerStyle={{padding:24,paddingBottom:Math.max(insets.bottom,16)+12}}>
    <Text style={{color:colors.text,fontSize:22}}>Video quality</Text><Text style={{color:colors.textSecondary,marginVertical:12}}>Controls video sent by this phone. Automatic adapts to your connection.</Text>
    {(['automatic','low','medium','high'] as VideoQualityMode[]).map(mode=><TouchableOpacity key={mode} accessibilityRole="radio" accessibilityState={{checked:rtc.videoQualityMode===mode}} onPress={()=>rtc.selectVideoQuality(mode)} style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14}}><Ionicons name={rtc.videoQualityMode===mode?'radio-button-on':'radio-button-off'} size={24} color={colors.primary}/><Text style={{color:colors.text,fontSize:17}}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</Text></TouchableOpacity>)}
    {!!rtc.videoQualityError&&<Text accessibilityRole="alert" style={{color:colors.error}}>{rtc.videoQualityError}</Text>}
    <TouchableOpacity accessibilityRole="switch" accessibilityState={{checked:speaker}} onPress={()=>void routeAudio()} style={{paddingVertical:14}}><Text style={{color:colors.primary}}>Speaker {speaker?'on':'off'}</Text></TouchableOpacity>
    <TouchableOpacity onPress={()=>setOptions(false)} style={{alignItems:'center',padding:14,backgroundColor:colors.primary,borderRadius:16,marginTop:12}}><Text style={{color:'#020413'}}>Done</Text></TouchableOpacity>
   </ScrollView>
  </View>
 </Modal>
 </>;
}
