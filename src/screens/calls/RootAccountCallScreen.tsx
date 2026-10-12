import {readRootNotificationPreferences} from '../../modules/messaging/notifications';
import {localAccount} from '../../modules/identity';
import {shortIdentity} from '../../modules/identity';
import {startRootCallLease,stopRootCallLease,markRootCallConnected} from '../../modules/messaging';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Modal,Switch,Text,View,Pressable,StyleSheet,ScrollView,TouchableOpacity} from 'react-native';
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
import {setCallSpeaker,restoreCallAudio} from '../../services/call-audio-route';

export async function ensureRootCallPermissions(kind:'voice'|'video'){
 if(!(await AudioModule.getRecordingPermissionsAsync()).granted&&!(await AudioModule.requestRecordingPermissionsAsync()).granted)throw Error('Allow microphone access to make or answer calls.');
 if(kind==='video'&&!(await ImagePicker.getCameraPermissionsAsync()).granted&&!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw Error('Allow camera access for video calls.');
}
export default function RootAccountCallScreen(){
 const [call,setCall]=useState<NeuronCallView<string>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const running=useRef(false),{colors}=useTheme(),[name,setName]=useState(''),[minimizedId,setMinimizedId]=useState<string|null>(null);
 useEffect(()=>{let alive=true;const peer=call?.peerUser;if(!peer)return;setName(shortIdentity(peer));const refresh=async()=>{try{const s=await conversations().snapshot();if(alive)setName(s.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer));}catch{if(alive)setName(shortIdentity(peer));}};void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{alive=false;clearInterval(timer);};},[call?.peerUser]);
 useEffect(()=>{if(call?.status!=='ringing')return;let active=true;const owner=localAccount.status().account;if(owner)void readRootNotificationPreferences(owner).then(p=>{if(active&&p.sound)playLooping(call.outgoing?'caller_ringback':'ringtone');}).catch(()=>{});return()=>{active=false;stopLooping();};},[call?.status,call?.outgoing]);
 useEffect(()=>subscribeLocalAccountCalls(v=>{setCall(v);setError('');}),[]);
 useEffect(()=>{
  if(call?.status!=='ended')return;
  const id=call.id;
  const timer=setTimeout(()=>setCall(current=>current?.id===id&&current.status==='ended'?null:current),3000);
  return()=>clearTimeout(timer);
 },[call?.id,call?.status]);
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
 const minimized=minimizedId===call.id,minimize=()=>setMinimizedId(call.id),restore=()=>setMinimizedId(null);
 // Media owns its own presentation so closing the full-screen Modal never unmounts WebRTC.
 if(call.status==='ready'&&call.transport)return <RootMedia key={call.id} call={call} name={name} end={end} minimized={minimized} minimize={minimize} restore={restore}/>;
 if(minimized)return ended?null:<MinimizedCall name={name} status={status} video={call.media==='video'} restore={restore} end={end}/>;
 return <Modal visible animationType="slide" onRequestClose={()=>ended?setCall(null):minimize()}>
  <StatusBar style="light"/>
  {!call.outgoing&&call.status==='ringing'?<IncomingCallAppearance callerName={name} isVideo={call.media==='video'} busy={busy} error={error} handleAccept={()=>void answer()} handleReject={end}/>:<CallLayout name={name} status={status} video={call.media==='video'}>
   {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
   <View style={{alignItems:'center',padding:24}}><EndButton ended={ended} onPress={()=>ended?setCall(null):end()}/></View>
  </CallLayout>}
 </Modal>;
}

function MinimizedCall({name,status,video,stream,restore,end}:{name:string;status:string;video:boolean;stream?:string;restore():void;end():void}){
 const insets=useSafeAreaInsets(),{colors}=useTheme();
 return <View testID="axonic-minimized-call" style={{position:'absolute',top:insets.top+12,right:insets.right+12,width:156,borderRadius:16,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.primary,overflow:'hidden',elevation:12,zIndex:100}}>
  <Pressable accessibilityRole="button" accessibilityLabel="Return to call" onPress={restore}>
   {video&&stream?<View pointerEvents="none" style={{height:88}}><RTCView streamURL={stream} objectFit="cover" style={{flex:1}} zOrder={0}/></View>:<View style={{height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name={video?'videocam':'call'} size={24} color={colors.primary}/></View>}
   <View style={{paddingHorizontal:10,paddingVertical:8}}><Text numberOfLines={1} style={{color:colors.text,fontWeight:'600'}}>{name}</Text><Text numberOfLines={1} style={{color:colors.textSecondary,fontSize:12}}>{status}</Text></View>
  </Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel="End call" onPress={end} style={{padding:10,alignItems:'center',backgroundColor:colors.error}}><Ionicons name="call" size={20} color="#fff" style={{transform:[{rotate:'135deg'}]}}/></Pressable>
 </View>;
}

function RootMedia({call,name,end,minimized,minimize,restore}:{call:NeuronCallView<string>;name:string;end:()=>void;minimized:boolean;minimize():void;restore():void}){
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
 const remote=rtc.remoteStream?.toURL(),local=rtc.localStream?.toURL(),video=call.media==='video',localVisible=rtc.isCameraOff?undefined:local;
 const background=video&&<>
  {(remote||localVisible)&&<RTCView streamURL={(remote||localVisible)!} objectFit="cover" mirror={!remote} style={styles.fullVideo} zOrder={0}/>}
  <Pressable accessibilityRole="button" accessibilityLabel={controls?'Hide call controls':'Show call controls'} onPress={()=>setControls(v=>!v)} style={StyleSheet.absoluteFill}/>
  {remote&&local&&foreground&&<View pointerEvents="none" style={[styles.pipWrap,{top:insets.top+16,right:insets.right+16}]}>{rtc.isCameraOff?<View style={[styles.pip,{alignItems:'center',justifyContent:'center',gap:8}]}><Ionicons name="videocam-off" size={28} color="#fff"/><Text style={{color:'#fff',fontSize:12}}>Camera off</Text></View>:<RTCView streamURL={local} objectFit="cover" mirror style={styles.pip} zOrder={1}/>}</View>}
 </>;
 const quality=rtc.callQuality;
 const status=connected?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):'Connecting…';
 const minimizeMedia=()=>{setOptions(false);minimize();};
 return <>
 {minimized&&<MinimizedCall name={name} status={status} video={video} stream={remote||localVisible} restore={restore} end={end}/>}
 <Modal visible={!minimized} animationType="slide" onRequestClose={minimizeMedia}>
 <CallLayout name={name} video={video} status={status} background={background} show={!video||controls} avatar={!video||(!remote&&!localVisible)}>
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
 <Pressable accessibilityRole="button" accessibilityLabel="Minimize call" testID="axonic-minimize-call" onPress={minimizeMedia} style={{position:'absolute',top:insets.top+12,left:insets.left+12,width:44,height:44,borderRadius:22,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-down" size={28} color="#fff"/></Pressable>
 </Modal>
 <Modal visible={!minimized&&options&&video} transparent animationType="slide" onRequestClose={()=>setOptions(false)}>
  <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.55)'}}><Pressable accessibilityLabel="Close call options" onPress={()=>setOptions(false)} style={StyleSheet.absoluteFill}/>
   <ScrollView style={{flexGrow:0,backgroundColor:colors.background,borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:'85%'}} contentContainerStyle={{padding:24,paddingLeft:insets.left+24,paddingRight:insets.right+24,paddingBottom:Math.max(insets.bottom,16)+12}}>
    <Text accessibilityRole="header" style={{color:colors.text,fontSize:22}}>Video quality</Text><Text style={{color:colors.textSecondary,marginVertical:12}}>Controls video sent by this phone. Automatic adapts to your connection.</Text>
    {([
      ['automatic','Automatic','Adjusts to your connection · Default'],
      ['low','Low','Uses less data · Lower detail and frame rate'],
      ['medium','Medium','Balances detail and data use'],
      ['high','High','Best detail · Uses more data'],
    ] as [VideoQualityMode,string,string][]).map(([mode,label,detail])=><TouchableOpacity key={mode} testID={`axonic-video-quality-${mode}`} accessibilityRole="radio" accessibilityState={{checked:rtc.videoQualityMode===mode}} onPress={()=>rtc.selectVideoQuality(mode)} style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14}}><Ionicons name={rtc.videoQualityMode===mode?'radio-button-on':'radio-button-off'} size={24} color={colors.primary}/><View style={{flex:1}}><Text style={{color:colors.text,fontSize:17}}>{label}</Text><Text style={{color:colors.textSecondary,marginTop:4}}>{detail}</Text></View></TouchableOpacity>)}
    {!!rtc.videoQualityError&&<Text accessibilityRole="alert" style={{color:colors.error}}>{rtc.videoQualityError}</Text>}
    <View style={{paddingVertical:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12}}><Text style={{color:colors.text,fontSize:17}}>Speaker</Text><Switch accessibilityLabel="Speaker" value={speaker} onValueChange={()=>void routeAudio()} trackColor={{false:colors.border,true:colors.primary}}/></View>
    <TouchableOpacity accessibilityRole="button" onPress={()=>setOptions(false)} style={{alignItems:'center',padding:14,backgroundColor:colors.primary,borderRadius:16,marginTop:12}}><Text style={{color:colors.textInverse}}>Done</Text></TouchableOpacity>
   </ScrollView>
  </View>
 </Modal>
 </>;
}
