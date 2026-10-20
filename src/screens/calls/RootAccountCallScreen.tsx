import {subscribeRootCallNotificationAction,takeRootCallNotificationAction} from '../../modules/messaging/notifications';
import {subscribeOwnChatWrites} from '../../modules/storage';
import {callScreenCaptureAvailable} from '../../services/call-screen-capture';
import {hasScreenShareOverlay,allowScreenShareOverlay,useScreenShareOverlay} from '../../hooks/useScreenShareOverlay';
import {readSharedAvatar,subscribeSharedAvatars} from '../../modules/storage';
import {readRootNotificationPreferences} from '../../modules/messaging/notifications';
import {localAccount} from '../../modules/identity';
import {shortIdentity} from '../../modules/identity';
import {startRootCallLease,stopRootCallLease,markRootCallConnected} from '../../modules/messaging';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Dimensions,Modal,Platform,Text,View,Pressable,StyleSheet,ScrollView,TouchableOpacity} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {CallLayout,EndButton} from './CallStage';
import DraggableCallPreview from './DraggableCallPreview';
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
import useRingingCameraPreview from '../../hooks/useRingingCameraPreview';
import {useTheme} from '../../contexts/ThemeContext';
import {ActionButton,makeStyles} from './CallAppearance';
import {startCallAudio,getCallAudioRoutes,selectCallAudioRoute,observeCallAudioRoutes,restoreCallAudio,type CallAudioRoutes} from '../../services/call-audio-route';

export async function ensureRootCallPermissions(kind:'voice'|'video'){
 if(!(await AudioModule.getRecordingPermissionsAsync()).granted&&!(await AudioModule.requestRecordingPermissionsAsync()).granted)throw Error('Allow microphone access to make or answer calls.');
 if(kind==='video'&&!(await ImagePicker.getCameraPermissionsAsync()).granted&&!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw Error('Allow camera access for video calls.');
}
export default function RootAccountCallScreen(){
 const [call,setCall]=useState<NeuronCallView<string>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const confirmationCall=useRef<string|null>(null);
 const [avatarUri,setAvatarUri]=useState<string|null>(null);
 useEffect(()=>{let active=true;setAvatarUri(null);const owner=localAccount.status().account,peer=call?.peerUser;const refresh=async()=>{if(!owner||!peer)return;const uri=await readSharedAvatar(owner,peer);if(active)setAvatarUri(uri);};void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};},[call?.peerUser]);
 const running=useRef(false),{colors}=useTheme(),[name,setName]=useState(''),[minimizedId,setMinimizedId]=useState<string|null>(null);
 useEffect(()=>{let alive=true,running=false,dirty=false;const peer=call?.peerUser;if(!peer)return;setName(shortIdentity(peer));const refresh=async()=>{dirty=true;if(running)return;running=true;try{do{dirty=false;try{const s=await conversations().snapshot();if(alive)setName(s.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer));}catch{if(alive)setName(shortIdentity(peer));}}while(alive&&dirty);}finally{running=false;}};void refresh();const off=subscribeOwnChatWrites(()=>void refresh());return()=>{alive=false;off();};},[call?.peerUser]);
 useEffect(()=>{
  if(call?.status!=='ringing')return;let active=true,generation=0;
  const sync=()=>{const own=++generation;void stopLooping();if(AppState.currentState!=='active'||(call.expiresAt??Infinity)<=Date.now())return;
   const owner=localAccount.status().account;if(owner)void readRootNotificationPreferences(owner).then(p=>{if(active&&own===generation&&AppState.currentState==='active'&&p.sound)void playLooping(call.outgoing?'caller_ringback':'ringtone');}).catch(()=>{});
  };
  sync();const listener=AppState.addEventListener('change',sync);
  return()=>{active=false;generation++;listener.remove();void stopLooping();};
 },[call?.id,call?.status,call?.outgoing,call?.expiresAt]);
 useEffect(()=>subscribeLocalAccountCalls(v=>{if(v?.outgoing&&v.status==='finding')confirmationCall.current=v.id;else if(v?.status!=='ended')confirmationCall.current=null;setCall(v);setError('');}),[]);
 useEffect(()=>{
  if(!call||call.outgoing||call.status!=='ringing')return;
  let confirmed=false,pending=false,active=true,timer:ReturnType<typeof setTimeout>|undefined;
  const confirm=async()=>{if(!active||confirmed||pending||AppState.currentState!=='active')return;clearTimeout(timer);pending=true;try{confirmed=!!await localAccountCalls()?.confirmRinging(call.id);}catch{/* Retry transient account/runtime startup without changing the incoming UI. */}finally{pending=false;if(active&&!confirmed&&AppState.currentState==='active')timer=setTimeout(()=>void confirm(),1000);}};
  void confirm();const listener=AppState.addEventListener('change',state=>{clearTimeout(timer);if(state==='active')void confirm();});return()=>{active=false;clearTimeout(timer);listener.remove();};
 },[call?.id,call?.outgoing,call?.status]);
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
 useEffect(()=>{
  if(!call||call.outgoing||call.status!=='ringing')return;
  let active=true,pending=false;
  const act=async()=>{if(!active||pending||AppState.currentState!=='active')return;const owner=localAccount.status().account;if(!owner)return;pending=true;
   try{const action=await takeRootCallNotificationAction(owner,call.id);if(!active)return;if(action==='root-call-decline')end();else if(action==='root-call-answer')await answer();}catch{setError('Unable to complete notification action. Use the call controls.');}finally{pending=false;}};
  void act();const off=subscribeRootCallNotificationAction(()=>void act()),state=AppState.addEventListener('change',()=>void act());return()=>{active=false;off();state.remove();};
 },[call?.id,call?.outgoing,call?.status]);
 const previewUrl=useRingingCameraPreview(call?.id,call?.media==='video'&&['ringing','connecting'].includes(call.status)&&minimizedId!==call.id);
 if(!call)return null;
 // The outgoing confirmation sheet owns Finding and its failure/cancellation.
 if(call.outgoing&&call.status==='finding'){confirmationCall.current=call.id;return null;}
 if(call.outgoing&&call.status==='ended'&&confirmationCall.current===call.id)return null;
 confirmationCall.current=null;
 const ended=call.status==='ended';
 const status=ended?call.reason??'Call ended':call.status==='finding'?'Finding…':call.status==='connecting'?'Connecting…':call.outgoing?'Ringing…':'Incoming '+call.media+' call';
 const minimized=minimizedId===call.id,minimize=()=>setMinimizedId(call.id),restore=()=>setMinimizedId(null);
 // Media owns its own presentation so closing the full-screen Modal never unmounts WebRTC.
 if(call.status==='ready'&&call.transport)return <RootMedia avatarUri={avatarUri} key={call.id} call={call} name={name} end={end} minimized={minimized} minimize={minimize} restore={restore}/>;
 if(minimized)return ended?null:<MinimizedCall name={name} status={status} video={call.media==='video'} restore={restore} end={end}/>;
 return <Modal visible animationType="slide" onRequestClose={()=>ended?setCall(null):minimize()}>
  <StatusBar style="light"/>
  {!call.outgoing&&call.status==='ringing'?<IncomingCallAppearance avatarUri={avatarUri} callerName={name} isVideo={call.media==='video'} localPreviewUrl={previewUrl} busy={busy} error={error} handleAccept={()=>void answer()} handleReject={end}/>:<CallLayout avatarUri={avatarUri} name={name} status={status} video={call.media==='video'} avatar={!previewUrl} background={previewUrl?<RTCView streamURL={previewUrl} objectFit="cover" mirror style={StyleSheet.absoluteFill} zOrder={0}/>:undefined}>
   {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
   <View style={{alignItems:'center',padding:24}}><EndButton ended={ended} onPress={()=>ended?setCall(null):end()}/></View>
  </CallLayout>}
 </Modal>;
}

function MinimizedCall({name,status,video,stream,restore,end}:{name:string;status:string;video:boolean;stream?:string;restore():void;end():void}){
 const insets=useSafeAreaInsets(),{colors}=useTheme();
 return <View testID="axonic-minimized-call" style={{position:'absolute',top:insets.top+12,right:insets.right+12,width:156,borderRadius:16,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.primary,overflow:'hidden',elevation:12,zIndex:100}}>
  <View style={{height:video?196:124}}>
   <Pressable accessible={false} onPress={restore} style={StyleSheet.absoluteFill}>
    <View pointerEvents="none" style={{flex:1,alignItems:'center',justifyContent:'center'}}>{video&&stream?<RTCView streamURL={stream} objectFit="cover" style={StyleSheet.absoluteFill} zOrder={0}/>:<Ionicons name={video?'videocam':'call'} size={24} color={colors.primary}/>}</View>
   </Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="Return to call" onPress={restore} style={{position:'absolute',top:4,left:4,width:44,height:44,borderRadius:22,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="arrow-back" size={24} color="#fff"/></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="End call" onPress={end} style={{position:'absolute',bottom:8,alignSelf:'center',width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:colors.error}}><Ionicons name="call" size={22} color="#fff" style={{transform:[{rotate:'135deg'}]}}/></Pressable>
  </View>
  <Pressable accessibilityRole="button" accessibilityLabel="Return to call details" onPress={restore}>
   <View style={{paddingHorizontal:10,paddingVertical:8}}><Text numberOfLines={1} style={{color:colors.text,fontWeight:'600'}}>{name}</Text><Text numberOfLines={1} style={{color:colors.textSecondary,fontSize:12}}>{status}</Text></View>
  </Pressable>
 </View>;
}

function RootMedia({call,name,avatarUri,end,minimized,minimize,restore}:{call:NeuronCallView<string>;name:string;avatarUri?:string|null;end:()=>void;minimized:boolean;minimize():void;restore():void}){
 useKeepAwake('root-account-call');
 const {colors}=useTheme(),styles=makeStyles(colors),[connected,setConnected]=useState(false),[audioRoutes,setAudioRoutes]=useState<CallAudioRoutes|null>(null),[error,setError]=useState('');
 const started=useRef(false),audioBusy=useRef(false),connectedAt=useRef<number|null>(null);
 const insets=useSafeAreaInsets(),[seconds,setSeconds]=useState(0),[controls,setControls]=useState(true),[options,setOptions]=useState(false),[foreground,setForeground]=useState(AppState.currentState==='active');
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);
 useEffect(()=>{if(!connected)return;const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-connectedAt.current!)/1000)),1000);return()=>clearInterval(timer);},[connected]);
 const onConnected=useCallback(()=>{connectedAt.current??=Date.now();setConnected(true);markRootCallConnected(call.id);},[call.id]);
 const endRef=useRef(end);endRef.current=end;const onDisconnected=useCallback(()=>endRef.current(),[]);
 const rtc=useWebRTCCore({callId:call.id,callType:call.media,peerUserId:call.peerUser,isOutgoing:call.outgoing,mediaTransport:call.transport,onConnected,onDisconnected});
 const hangupPending=useRef(false);
 const hangup=()=>{if(hangupPending.current)return;hangupPending.current=true;void rtc.notifyCallEnded().finally(()=>endRef.current());};
 const [barFraction,setBarFraction]=useState(0),[excludedFraction,setExcludedFraction]=useState<number|null>(null);
 useScreenShareOverlay(call.id,rtc.isScreenSharing,rtc.isMuted,rtc.setScreenControlsExcluded,rtc.toggleMute,rtc.stopScreenSharing,hangup,setError);
 const nativeShareControls=hasScreenShareOverlay();
 const shareRequest=useRef({active:true,pending:false});
 useEffect(()=>{shareRequest.current.active=true;return()=>{shareRequest.current.active=false;};},[]);
 const startSharing=async()=>{
  const request=shareRequest.current;if(request.pending)return;request.pending=true;setError('');
  try{
   const granted=await allowScreenShareOverlay();if(!request.active)return;
   if(granted){setError('');await rtc.startScreenSharing();}
   else setError('Display over other apps permission is required for sharing controls.');
  }catch{if(request.active)setError('Unable to open screen-sharing controls.');}
  finally{request.pending=false;}
 };
 useEffect(()=>{let current=true;setExcludedFraction(null);if(rtc.isScreenSharing&&!nativeShareControls)void rtc.setScreenControlsExcluded(foreground?barFraction:0).then(()=>{if(current)setExcludedFraction(foreground?barFraction:0);}).catch(()=>{if(current)setError('Unable to exclude sharing controls. Stop sharing using Android’s screen-capture notification.');});return()=>{current=false;};},[rtc.isScreenSharing,rtc.setScreenControlsExcluded,foreground,barFraction,nativeShareControls]);
 const minimizeRef=useRef(minimize);minimizeRef.current=minimize;
 // Once capture succeeds, expose the app instead of recursively sharing the call view.
 useEffect(()=>{if(rtc.isScreenSharing){setOptions(false);minimizeRef.current();}},[rtc.isScreenSharing]);
 const wasSharing=useRef(false),restoreRef=useRef(restore);restoreRef.current=restore;
 useEffect(()=>{if(wasSharing.current&&!rtc.isScreenSharing)restoreRef.current();wasSharing.current=rtc.isScreenSharing;},[rtc.isScreenSharing]);
 useEffect(()=>{if(rtc.remoteScreenSharing){setOptions(false);setControls(true);}},[rtc.remoteScreenSharing]);
 useEffect(()=>{if(call.outgoing&&!started.current){started.current=true;void rtc.startAsOfferer();}},[call.outgoing,rtc.startAsOfferer]);
 useEffect(()=>{if(connected)return;const timer=setTimeout(end,45000);return()=>clearTimeout(timer);},[connected,call.id]);
 useEffect(()=>{void startRootCallLease(call.id,call.media);return()=>{stopRootCallLease(call.id);restoreCallAudio();};},[call.id,call.media]);
 useEffect(()=>{
  let mounted=true;
  const update=(routes:CallAudioRoutes)=>{if(mounted)setAudioRoutes(routes);};
  const listener=observeCallAudioRoutes(update);
  void startCallAudio(call.media==='video').then(update).catch(error=>{if(mounted)setError(error instanceof Error?error.message:'Unable to select audio output.');});
  const active=AppState.addEventListener('change',state=>{if(state==='active')void getCallAudioRoutes().then(routes=>{if(routes)update(routes);}).catch(()=>{});});
  return()=>{mounted=false;listener.remove();active.remove();};
 },[call.id,call.media]);
 const routeAudio=async(id:string)=>{if(audioBusy.current)return;audioBusy.current=true;setError('');try{setAudioRoutes(await selectCallAudioRoute(id));}catch(error){setError(error instanceof Error?error.message:'Unable to change audio output.');}finally{audioBusy.current=false;}};
 const remote=rtc.remoteStream?.toURL(),local=rtc.localStream?.toURL(),video=call.media==='video',localVisible=rtc.isCameraOff&&!rtc.isScreenSharing?undefined:local;
 const sharing=video&&rtc.isScreenSharing;
 const showControls=sharing||!video||controls;
 const quality=rtc.callQuality;
 const background=video&&<>
  {(remote||localVisible)&&<RTCView streamURL={(remote||localVisible)!} objectFit={(remote?rtc.remoteScreenSharing:rtc.isScreenSharing)?"contain":"cover"} mirror={!remote&&!rtc.isScreenSharing} style={styles.fullVideo} zOrder={0}/>}
  <Pressable accessibilityRole="button" accessibilityLabel={controls?'Hide call controls':'Show call controls'} onPress={()=>setControls(v=>!v)} style={StyleSheet.absoluteFill}/>
  {remote&&foreground&&(!rtc.remoteScreenSharing||showControls)&&<DraggableCallPreview testID="axonic-call-self-view" style={[styles.selfView,{top:insets.top+16,right:insets.right+16}]}>
   <View style={styles.pipWrap}><View style={styles.pip}>{rtc.isCameraOff&&!rtc.isScreenSharing||!local?<View style={{flex:1,alignItems:'center',justifyContent:'center',gap:8}}><Ionicons name="videocam-off" size={28} color="#fff"/><Text style={{color:'#fff',fontSize:12}}>{rtc.isCameraOff?'Camera off':'No preview'}</Text></View>:<RTCView streamURL={local} objectFit={rtc.isScreenSharing?"contain":"cover"} mirror={!rtc.isScreenSharing} style={{flex:1}} zOrder={1}/>}</View></View>
   {showControls&&rtc.isScreenSharing&&<Text style={[styles.quality,{color:colors.primary,fontSize:11,textAlign:'center'}]}>Sharing screen</Text>}
   {showControls&&quality.level!=='unknown'&&<View testID="axonic-call-connection-quality" style={styles.quality}><Text style={{textAlign:'center',fontSize:11,fontWeight:'700',color:quality.level==='good'?colors.success:quality.level==='fair'?colors.warning:colors.error}}>{quality.level.toUpperCase()}</Text>{(quality.roundTripTimeMs!=null||quality.packetLossPercent!=null)&&<Text style={{color:'#fff',fontSize:10,textAlign:'center'}}>{quality.roundTripTimeMs!=null?`${quality.roundTripTimeMs} ms`:''}{quality.roundTripTimeMs!=null&&quality.packetLossPercent!=null?' · ':''}{quality.packetLossPercent!=null?`${quality.packetLossPercent}% loss`:''}</Text>}</View>}
  </DraggableCallPreview>}
 </>;
 const status=rtc.recovering?'Reconnecting…':connected?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):'Connecting…';
 const minimizeMedia=()=>{setOptions(false);minimize();};
 const homeWindow=Platform.OS==='android'&&!foreground;
 const shareBar=<View testID="axonic-screen-share-controls" onLayout={event=>setBarFraction(event.nativeEvent.layout.height/Dimensions.get('screen').height)} pointerEvents={excludedFraction===barFraction&&barFraction>0?'auto':'none'} style={{opacity:excludedFraction===barFraction&&barFraction>0?1:0,backgroundColor:'#071426',paddingTop:12,paddingBottom:Math.max(insets.bottom,12),paddingLeft:insets.left+12,paddingRight:insets.right+12}}>
  <Text numberOfLines={1} style={{color:'#9cc4d5',textAlign:'center',marginBottom:8}}>{rtc.isScreenSharing?'You are sharing your screen':`${name} is sharing`} · {status}</Text>
  <View style={{flexDirection:'row',justifyContent:'space-evenly',alignItems:'center'}}>
   <ActionButton size={52} icon={rtc.isMuted?'mic-off':'mic'} label={rtc.isMuted?'Unmute':'Mute'} active={rtc.isMuted} onPress={rtc.toggleMute} Colors={colors}/>
   {rtc.isScreenSharing?<ActionButton size={52} icon="stop-circle-outline" label="Stop sharing" active onPress={()=>void rtc.stopScreenSharing()} Colors={colors}/>:<View accessibilityLabel="Only the person sharing can stop their screen share" style={{alignItems:'center',opacity:0.65}}><Ionicons name="desktop-outline" size={28} color={colors.primary}/><Text style={{color:'#fff',marginTop:8}}>Viewing screen</Text></View>}
   <EndButton video onPress={hangup}/>
  </View>
  {!!rtc.screenShareError&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{rtc.screenShareError}</Text>}
 </View>;
 return <>
 {homeWindow&&!rtc.isScreenSharing&&<View testID="axonic-system-call-window" pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'#020413',zIndex:100,elevation:20,alignItems:'center',justifyContent:'center',gap:8}]}>
  {video&&(remote||localVisible)?<RTCView streamURL={(remote||localVisible)!} objectFit="contain" mirror={!remote&&!rtc.isScreenSharing} style={StyleSheet.absoluteFill} zOrder={0}/>:<><Ionicons name={video?'videocam':'call'} size={36} color={colors.primary}/><Text numberOfLines={2} style={{color:'#fff',fontSize:16,textAlign:'center',paddingHorizontal:8}}>{name}</Text><Text style={{color:'#fff',fontSize:14}}>{status}</Text></>}
 </View>}
 {!homeWindow&&minimized&&(rtc.isScreenSharing?(!nativeShareControls&&<View testID="axonic-sharing-bottom-bar" style={{position:'absolute',bottom:0,left:0,right:0,zIndex:100,elevation:20}}>{shareBar}</View>):<MinimizedCall name={name} status={status} video={video} stream={remote||localVisible} restore={restore} end={hangup}/>)}
 <Modal visible={!homeWindow&&!minimized} animationType="slide" onRequestClose={minimizeMedia}>
 {sharing?<View testID="axonic-screen-share-stage" style={{flex:1,backgroundColor:'#000',paddingTop:insets.top}}>
  <StatusBar style="light"/>
  <View style={{flex:1,marginLeft:insets.left,marginRight:insets.right}}>
   {(rtc.remoteScreenSharing?remote:localVisible)&&<RTCView streamURL={(rtc.remoteScreenSharing?remote:localVisible)!} objectFit="contain" mirror={false} style={StyleSheet.absoluteFill} zOrder={0}/>}
  </View>
  {rtc.isScreenSharing&&!nativeShareControls&&shareBar}
 </View>:<CallLayout avatarUri={avatarUri} name={name} video={video} status={status} background={background} show={showControls} avatar={!video||(!remote&&!localVisible)}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
  {!!rtc.screenShareError&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{rtc.screenShareError}</Text>}

  <View style={[styles.actions,video&&{paddingHorizontal:8}]}>
   <ActionButton size={video?52:64} icon={rtc.isMuted?'mic-off':'mic'} label={rtc.isMuted?'Unmute':'Mute'} active={rtc.isMuted} onPress={rtc.toggleMute} Colors={colors}/>
   {video&&<ActionButton size={52} icon={rtc.isScreenSharing?'stop-circle-outline':rtc.isCameraOff?'videocam-off':'videocam'} label={rtc.isScreenSharing?'Stop share':rtc.isCameraOff?'Cam On':'Cam Off'} active={rtc.isScreenSharing||rtc.isCameraOff} onPress={rtc.isScreenSharing?()=>void rtc.stopScreenSharing():rtc.toggleCamera} Colors={colors}/>}
   <EndButton video={video} onPress={hangup}/>
   {video&&!rtc.isScreenSharing&&<ActionButton size={52} icon="camera-reverse-outline" label="Flip" onPress={rtc.switchCamera} Colors={colors}/>}
   {video?<ActionButton size={52} icon="options-outline" label="Options" onPress={()=>setOptions(true)} Colors={colors}/>:<ActionButton icon={audioRoutes?.devices.find(d=>d.id===audioRoutes.selectedId)?.kind==='bluetooth'?'bluetooth':'volume-high-outline'} label="Audio" onPress={()=>setOptions(true)} Colors={colors}/>}
  </View>
 </CallLayout>}
 {showControls&&!sharing&&<Pressable accessibilityRole="button" accessibilityLabel="Minimize call" testID="axonic-minimize-call" onPress={minimizeMedia} style={{position:'absolute',top:insets.top+12,left:insets.left+12,width:44,height:44,borderRadius:22,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-forward" size={28} color="#fff"/></Pressable>}
 </Modal>
 <Modal visible={!homeWindow&&!minimized&&options} transparent animationType="fade" onRequestClose={()=>setOptions(false)}>
  <View style={[styles.optionsBackdrop,{paddingTop:insets.top+12,paddingBottom:Math.max(insets.bottom,12),paddingLeft:insets.left+12,paddingRight:insets.right+12}]}>
   <Pressable accessibilityLabel="Close call options" onPress={()=>setOptions(false)} style={StyleSheet.absoluteFill}/>
   <View testID="axonic-call-options" style={styles.optionsPanel}>
    <View style={styles.optionsHeader}><Ionicons name={video?'options-outline':'volume-high-outline'} size={18} color={colors.primary}/><Text accessibilityRole="header" style={styles.optionsTitle}>{video?'Call options':'Audio output'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close options" onPress={()=>setOptions(false)} style={styles.optionsClose}><Ionicons name="close" size={22} color="#fff"/></Pressable></View>
    <ScrollView style={{flexShrink:1}} contentContainerStyle={styles.optionsContent}>
     {video&&<>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={rtc.isScreenSharing?'Stop sharing screen':'Share screen'} disabled={rtc.screenShareBusy||!callScreenCaptureAvailable} onPress={()=>{setOptions(false);if(rtc.isScreenSharing)void rtc.stopScreenSharing();else void startSharing();}} style={[styles.audioChoice,styles.audioChoiceSelected,{marginBottom:12,opacity:rtc.screenShareBusy||!callScreenCaptureAvailable?0.5:1}]}>
       <Ionicons name={rtc.isScreenSharing?'stop-circle-outline':'desktop-outline'} size={20} color={colors.primary}/><View style={{flex:1}}><Text style={styles.optionText}>{rtc.screenShareBusy?'Switching video…':rtc.isScreenSharing?'Stop sharing':'Share screen'}</Text><Text style={styles.optionDetail}>{!callScreenCaptureAvailable?'Update the Android app to share':rtc.isScreenSharing?'Return to your camera':'Show your screen instead of your camera'}</Text></View>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.optionsSection}>VIDEO QUALITY</Text>
      <View style={styles.qualityChoices}>{([
       ['automatic','Auto'],['low','Low'],['medium','Medium'],['high','High'],
      ] as [VideoQualityMode,string][]).map(([mode,label])=><TouchableOpacity key={mode} testID={`axonic-video-quality-${mode}`} accessibilityRole="radio" accessibilityLabel={`${mode==='automatic'?'Automatic':label} video quality`} accessibilityState={{checked:rtc.videoQualityMode===mode}} onPress={()=>rtc.selectVideoQuality(mode)} style={[styles.qualityChoice,rtc.videoQualityMode===mode&&styles.qualityChoiceSelected]}><Text style={[styles.optionText,rtc.videoQualityMode===mode&&{color:colors.primary,fontWeight:'700'}]}>{label}</Text></TouchableOpacity>)}</View>
      {!!rtc.videoQualityError&&<Text accessibilityRole="alert" style={styles.optionError}>{rtc.videoQualityError}</Text>}
     </>}
     {video&&<Text accessibilityRole="header" style={[styles.optionsSection,{marginTop:16}]}>AUDIO OUTPUT</Text>}
     {!!error&&<Text accessibilityRole="alert" style={styles.optionError}>{error}</Text>}
     {audioRoutes&&[{id:'automatic',label:'Automatic',name:'',kind:'other' as const},...audioRoutes.devices].map(device=>{
      const selected=device.id==='automatic'?audioRoutes.automatic:!audioRoutes.automatic&&device.id===audioRoutes.selectedId;
      const inUse=device.id===audioRoutes.selectedId;
      const icon=device.kind==='bluetooth'?'bluetooth':device.kind==='speaker'?'volume-high-outline':device.kind==='phone'?'phone-portrait-outline':device.kind==='wired'||device.kind==='usb'?'headset-outline':'sync-outline';
      return <TouchableOpacity key={device.id} accessibilityRole="radio" accessibilityLabel={device.name?`${device.label}: ${device.name}`:device.label} accessibilityState={{checked:selected}} onPress={()=>void routeAudio(device.id)} style={[styles.audioChoice,selected&&styles.audioChoiceSelected]}>
       <Ionicons name={icon} size={20} color={selected?colors.primary:'rgba(255,255,255,0.7)'}/>
       <View style={{flex:1}}><Text style={styles.optionText}>{device.label}</Text>{!!device.name&&<Text numberOfLines={1} style={styles.optionDetail}>{device.name}</Text>}</View>
       {inUse&&<Text style={styles.routeInUse}>In use</Text>}
       {selected&&<Ionicons name="checkmark" size={18} color={colors.primary}/>}
      </TouchableOpacity>;
     })}
    </ScrollView>
   </View>
  </View>
 </Modal>
 </>;
}
