import {t,languageSnapshot} from '../../localization/language';
import CallOptions from './CallOptions';
import {useCallAudioSession} from './useCallAudioSession';
import CallSessionScreen,{CallControls,MinimizedCall,type CallParticipant} from './CallSessionScreen';
import {subscribeRootCallNotificationAction,takeRootCallNotificationAction} from '../../modules/messaging/notifications';
import RootGroupCallMedia,{GroupLeg,type CallExpansionLink} from './RootGroupCallMedia';
import GroupCallPicker from './GroupCallPicker';
import {calling,MAX_GROUP_CALL_PARTICIPANTS,type GroupCallRoom} from '../../modules/calls';
import {useChatContacts} from '../../modules/ui/useChatSnapshot';
import {useCallState,beginCallMediaState} from '../../modules/ui/liveState';
import {callScreenCaptureAvailable} from '../../services/call-screen-capture';
import {hasScreenShareOverlay,allowScreenShareOverlay,useScreenShareOverlay} from '../../hooks/useScreenShareOverlay';
import {readSharedAvatar,subscribeSharedAvatars} from '../../modules/storage';
import {readRootNotificationPreferences} from '../../modules/messaging/notifications';
import {localAccount} from '../../modules/identity';
import {shortIdentity} from '../../modules/identity';
import {markRootCallConnected} from '../../modules/calls';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Dimensions,Modal,Platform,Text,View,Pressable,StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {CallLayout,EndButton} from './CallStage';
import DraggableCallPreview from './DraggableCallPreview';
import IncomingCallAppearance from './IncomingCallAppearance';
import {playLooping,stopLooping} from '../../services/soundService';
import {RTCView} from 'react-native-webrtc';
import {AudioModule} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import {localAccountCalls} from '../../modules/calls';
import type {NeuronCallView} from '../../modules/calls';
import useWebRTCCore from '../../hooks/useWebRTCCore';
import useRingingCameraPreview from '../../hooks/useRingingCameraPreview';
import {useTheme} from '../../contexts/ThemeContext';
import {ActionButton,makeStyles} from './CallAppearance';

export async function ensureRootCallPermissions(kind:'voice'|'video'){
 if(!(await AudioModule.getRecordingPermissionsAsync()).granted&&!(await AudioModule.requestRecordingPermissionsAsync()).granted)throw Error(t("Allow microphone access to make or answer calls."));
 if(kind==='video'&&!(await ImagePicker.getCameraPermissionsAsync()).granted&&!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw Error(t("Allow camera access for video calls."));
}
export default function RootAccountCallScreen(){
 const currentCall=useCallState(),[dismissed,setDismissed]=useState<string|null>(null),call=currentCall?.id===dismissed?null:currentCall,[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const confirmationCall=useRef<string|null>(null);
 const owner=localAccount.status().account,peer=call?.peerUser;
 const [avatar,setAvatar]=useState<{owner:string;peer:string;uri:string|null}|null>(null);
 const avatarUri=avatar&&avatar.owner===owner&&avatar.peer===peer?avatar.uri:null;
 useEffect(()=>{
  if(!owner||!peer)return;
  let active=true,revision=0;
  const refresh=async()=>{const current=++revision;const uri=await readSharedAvatar(owner,peer);if(active&&revision===current)setAvatar({owner,peer,uri});};
  void refresh().catch(()=>{});
  const off=subscribeSharedAvatars(change=>{if(!change||(change.owner===owner&&change.peer===peer))void refresh().catch(()=>{});});
  return()=>{active=false;off();};
 },[owner,peer]);
 const running=useRef(false),{colors}=useTheme(),[minimizedId,setMinimizedId]=useState<string|null>(null);
 const {contacts}=useChatContacts(!!call),name=call?.room?.name??(call?contacts.find(c=>c.account===call.peerUser)?.alias||shortIdentity(call.peerUser):'');
 useEffect(()=>{
  if(call?.status!=='ringing')return;let active=true,generation=0;
  const sync=()=>{const own=++generation;void stopLooping();if(AppState.currentState!=='active'||(call.expiresAt??Infinity)<=Date.now())return;
   const owner=localAccount.status().account;if(owner)void readRootNotificationPreferences(owner).then(p=>{if(active&&own===generation&&AppState.currentState==='active'&&p.sound)void playLooping(call.outgoing?'caller_ringback':'ringtone');}).catch(()=>{});
  };
  sync();const listener=AppState.addEventListener('change',sync);
  return()=>{active=false;generation++;listener.remove();void stopLooping();};
 },[call?.id,call?.status,call?.outgoing,call?.expiresAt]);
 useEffect(()=>{if(call?.outgoing&&call.status==='finding')confirmationCall.current=call.id;else if(call?.status!=='ended')confirmationCall.current=null;setError('');},[call]);
 useEffect(()=>{
  if(!call||call.outgoing||call.status!=='ringing')return;
  let confirmed=false,pending=false,active=true,timer:ReturnType<typeof setTimeout>|undefined;
  const confirm=async()=>{if(!active||confirmed||pending||AppState.currentState!=='active')return;clearTimeout(timer);pending=true;try{confirmed=!!await localAccountCalls()?.confirmRinging(call.id);}catch{/* Retry transient account/runtime startup without changing the incoming UI. */}finally{pending=false;if(active&&!confirmed&&AppState.currentState==='active')timer=setTimeout(()=>void confirm(),1000);}};
  void confirm();const listener=AppState.addEventListener('change',state=>{clearTimeout(timer);if(state==='active')void confirm();});return()=>{active=false;clearTimeout(timer);listener.remove();};
 },[call?.id,call?.outgoing,call?.status]);
 useEffect(()=>{
  if(call?.status!=='ended')return;
  const id=call.id;
  const timer=setTimeout(()=>setDismissed(id),3000);
  return()=>clearTimeout(timer);
 },[call?.id,call?.status]);
 const end=()=>{if(call)void localAccountCalls()?.end(call.id).catch(()=>setError(t("Call ended locally; peer notification is pending.")));};
 const answer=async()=>{
  if(!call||running.current)return;
  if((call.expiresAt??Infinity)<=Date.now()){setError(t("This call is no longer available."));return;}
  running.current=true;setBusy(true);setError('');
  const calls=localAccountCalls();
  try{await ensureRootCallPermissions(call.media);if(calls!==localAccountCalls()||!await calls?.accept(call.id))throw Error(t("This call is no longer available."));}
  catch(e){setError(e instanceof Error?e.message:t("Unable to answer"));}finally{running.current=false;setBusy(false);}
 };
 useEffect(()=>{
  if(!call||call.outgoing||call.status!=='ringing')return;
  let active=true,pending=false,again=false;
  const act=async()=>{if(pending){again=true;return;}if(!active||AppState.currentState!=='active')return;const owner=localAccount.status().account;if(!owner)return;pending=true;again=false;
   try{
    const action=await takeRootCallNotificationAction(owner,call.id,()=>active&&AppState.currentState==='active'&&localAccount.status().account===owner);
    if(!active)return;
    if(action)setMinimizedId(null);
    if(action==='root-call-decline')end();else if(action==='root-call-answer')await answer();
   }catch{setError(t("Unable to complete notification action. Use the call controls."));}
   finally{pending=false;if(again&&active)void act();}};
  void act();const off=subscribeRootCallNotificationAction(()=>void act()),state=AppState.addEventListener('change',()=>void act());return()=>{active=false;off();state.remove();};
 },[call?.id,call?.outgoing,call?.status]);
 const showPreview=call?.media==='video'&&!busy&&minimizedId!==call.id&&
  (call.status==='ringing'||(call.outgoing&&call.status==='connecting'));
 const previewUrl=useRingingCameraPreview(call?.id,showPreview);
 if(!call)return null;
 // The outgoing confirmation sheet owns Finding and its failure/cancellation.
 if(call.outgoing&&call.status==='finding'){confirmationCall.current=call.id;return null;}
 if(call.outgoing&&call.status==='ended'&&confirmationCall.current===call.id)return null;
 confirmationCall.current=null;
 const ended=call.status==='ended';
 const status=ended?call.reason??t("Call ended"):call.status==='finding'?t("Finding…"):call.status==='connecting'?t("Connecting…"):call.outgoing?t("Ringing…"):'Incoming '+call.media+' call';
 const minimized=minimizedId===call.id,minimize=()=>setMinimizedId(call.id),restore=()=>setMinimizedId(null);
 // Media owns its own presentation so closing the full-screen Modal never unmounts WebRTC.
 if(call.room&&!call.room.anchorId&&call.status==='ready')return <RootGroupCallMedia key={call.id} call={call} end={end} minimized={minimized} minimize={minimize} restore={restore}/>;
 if(call.status==='ready'&&(call.transport||call.room?.anchorId))return <RootMedia avatarUri={avatarUri} key={call.id} call={call} name={name} end={end} minimized={minimized} minimize={minimize} restore={restore}/>;
 if(minimized)return ended?null:<MinimizedCall name={name} status={status} video={call.media==='video'} restore={restore} end={end}/>;
 // Android's SurfaceView can outlive the dismiss animation as the media modal opens.
 return <Modal visible animationType={Platform.OS==='android'&&call.media==='video'?'none':'slide'} onRequestClose={()=>ended?setDismissed(call.id):minimize()}>
  <StatusBar style="light"/>
  {!call.outgoing&&call.status==='ringing'?<IncomingCallAppearance avatarUri={avatarUri} callerName={name} isVideo={call.media==='video'} localPreviewUrl={previewUrl} busy={busy} error={error} handleAccept={()=>void answer()} handleReject={end}/>:<CallLayout avatarUri={avatarUri} name={name} status={status} video={call.media==='video'} avatar={!previewUrl} background={previewUrl?<RTCView streamURL={previewUrl} objectFit="cover" mirror style={StyleSheet.absoluteFill} zOrder={0}/>:undefined}>
   {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
   <View style={{alignItems:'center',padding:24}}><EndButton ended={ended} onPress={()=>ended?setDismissed(call.id):end()}/></View>
  </CallLayout>}
 </Modal>;
}


function RootMedia({call,name,avatarUri,end,minimized,minimize,restore}:{call:NeuronCallView<string>;name:string;avatarUri?:string|null;end:()=>void;minimized:boolean;minimize():void;restore():void}){
 const anchor=useRef(call).current,currentCall=useRef(call);currentCall.current=call;
 const {contacts}=useChatContacts(true),owner=localAccount.status().account;
 const [adding,setAdding]=useState(false);
 const [expansionLinks,setExpansionLinks]=useState<Record<string,CallExpansionLink>>({});
 const registerExpansion=useCallback((peer:string,link:CallExpansionLink|null)=>setExpansionLinks(old=>{const next={...old};if(link)next[peer]=link;else delete next[peer];return next;}),[]);
 const [extraRemote,setExtraRemote]=useState<Record<string,{url?:string;status:string;connected:boolean}>>({});
 const [speakers,setSpeakers]=useState<Record<string,{local:boolean;remote:boolean}>>({});
 const updateRemote=useCallback((peer:string,value:{url?:string;status:string;connected:boolean}|null)=>setExtraRemote(old=>{const next={...old};if(value)next[peer]=value;else delete next[peer];return next;}),[languageSnapshot()]);
 const speaking=useCallback((peer:string,local:boolean,remote:boolean)=>setSpeakers(old=>old[peer]?.local===local&&old[peer]?.remote===remote?old:{...old,[peer]:{local,remote}}),[languageSnapshot()]);
 const anchorSpeaking=useCallback((local:boolean,remote:boolean)=>speaking(anchor.peerUser,local,remote),[anchor.peerUser,speaking,languageSnapshot()]);
 const expansionAllowed=useRef(true);
 const adopt=useCallback((room:GroupCallRoom)=>expansionAllowed.current?localAccountCalls()?.adoptExpansion(anchor.id,room,anchor.peerUser)??Promise.resolve(false):Promise.resolve(false),[anchor.id,anchor.peerUser,languageSnapshot()]);
 const commitExpansion=useCallback((room:GroupCallRoom)=>owner?localAccountCalls()?.adoptExpansion(anchor.id,room,owner)??Promise.resolve(false):Promise.resolve(false),[anchor.id,owner,languageSnapshot()]);
 const hangupPending=useRef(false);
 const {audioRoutes,routeAudio,audioError,foreground}=useCallAudioSession(call.id,call.media==='video',hangup,avatarUri??null);
 const {colors}=useTheme(),styles=makeStyles(colors),[connected,setConnected]=useState(false),[error,setError]=useState('');
 const started=useRef(false),connectedAt=useRef<number|null>(null);
 const insets=useSafeAreaInsets(),[seconds,setSeconds]=useState(0),[controls,setControls]=useState(true),[options,setOptions]=useState(false);
 useEffect(()=>{if(!connected)return;const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-connectedAt.current!)/1000)),1000);return()=>clearInterval(timer);},[connected]);
 const onConnected=useCallback(()=>{connectedAt.current??=Date.now();setConnected(true);markRootCallConnected(call.id);},[call.id,languageSnapshot()]);
 const endRef=useRef(end);endRef.current=end;const onDisconnected=useCallback(()=>{if(currentCall.current.room)void localAccountCalls()?.endParticipant(anchor.id);else endRef.current();},[anchor.id,languageSnapshot()]);
 const rtc=useWebRTCCore({callId:anchor.id,callType:anchor.media,peerUserId:anchor.peerUser,isOutgoing:anchor.outgoing,mediaTransport:anchor.transport,onExpandCall:adopt,onExpansionAccepted:commitExpansion,onSpeaking:anchorSpeaking,onConnected,onDisconnected});
 expansionAllowed.current=!rtc.isScreenSharing&&!rtc.remoteScreenSharing&&!rtc.screenShareBusy;
 const invite=async(ids:string[])=>{
  const calls=localAccountCalls();
  if(!calls||rtc.isScreenSharing||rtc.remoteScreenSharing)throw Error(t("Adding people is unavailable in this call right now."));
  const room=await calling.prepareExpansion(anchor.id,ids);
  // Confirm the new audience with added participants first; the original leg's
  // acknowledgment then commits locally through the existing expansion path.
  for(const peer of currentCall.current.room?.descriptor.members??[]){
   if(peer===owner||peer===anchor.peerUser)continue;
   const link=expansionLinks[peer];
   if(!link?.available||!await link.request(room))throw Error(t("The invitation was not confirmed. Your current call stays connected."));
  }
  if(!await rtc.expandCall(room))throw Error(t("The invitation was not confirmed. Your current call stays connected."));

 };
 const presentation=useRef<ReturnType<typeof beginCallMediaState>|null>(null);
 useEffect(()=>{const lease=beginCallMediaState(call.id);presentation.current=lease;return()=>{lease.stop();if(presentation.current===lease)presentation.current=null;};},[call.id]);
 useEffect(()=>{presentation.current?.update({connection:rtc.connectionType,recovering:rtc.recovering,muted:rtc.isMuted,cameraOff:rtc.isCameraOff,sharing:rtc.isScreenSharing,remoteSharing:rtc.remoteScreenSharing,sharingBusy:rtc.screenShareBusy,quality:rtc.callQuality.level});},[call.id,rtc.connectionType,rtc.recovering,rtc.isMuted,rtc.isCameraOff,rtc.isScreenSharing,rtc.remoteScreenSharing,rtc.screenShareBusy,rtc.callQuality.level]);
 function hangup(){if(hangupPending.current)return;hangupPending.current=true;void rtc.notifyCallEnded().finally(()=>endRef.current());}
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
   else setError(t("Display over other apps permission is required for sharing controls."));
  }catch{if(request.active)setError(t("Unable to open screen-sharing controls."));}
  finally{request.pending=false;}
 };
 useEffect(()=>{let current=true;setExcludedFraction(null);if(rtc.isScreenSharing&&!nativeShareControls)void rtc.setScreenControlsExcluded(foreground?barFraction:0).then(()=>{if(current)setExcludedFraction(foreground?barFraction:0);}).catch(()=>{if(current)setError(t("Unable to exclude sharing controls. Stop sharing using Android’s screen-capture notification."));});return()=>{current=false;};},[rtc.isScreenSharing,rtc.setScreenControlsExcluded,foreground,barFraction,nativeShareControls]);
 const minimizeRef=useRef(minimize);minimizeRef.current=minimize;
 // Once capture succeeds, expose the app instead of recursively sharing the call view.
 useEffect(()=>{if(rtc.isScreenSharing){setOptions(false);minimizeRef.current();}},[rtc.isScreenSharing]);
 const wasSharing=useRef(false),restoreRef=useRef(restore);restoreRef.current=restore;
 useEffect(()=>{if(wasSharing.current&&!rtc.isScreenSharing)restoreRef.current();wasSharing.current=rtc.isScreenSharing;},[rtc.isScreenSharing]);
 useEffect(()=>{if(rtc.remoteScreenSharing){setOptions(false);setControls(true);}},[rtc.remoteScreenSharing]);
 useEffect(()=>{if(call.outgoing&&!started.current){started.current=true;void rtc.startAsOfferer();}},[call.outgoing,rtc.startAsOfferer]);
 useEffect(()=>{if(connected)return;const timer=setTimeout(end,45000);return()=>clearTimeout(timer);},[connected,call.id]);
 const remote=rtc.remoteStream?.toURL(),local=rtc.localStream?.toURL(),video=call.media==='video',localVisible=rtc.isCameraOff&&!rtc.isScreenSharing?undefined:local;
 const sharing=video&&rtc.isScreenSharing;
 const showControls=sharing||!video||controls;
 const quality=rtc.callQuality;
 const background=video&&<>
  {(remote||localVisible)&&<RTCView key={remote?'remote-stage':'local-stage'} streamURL={(remote||localVisible)!} objectFit={(remote?rtc.remoteScreenSharing:rtc.isScreenSharing)?"contain":"cover"} mirror={!remote&&!rtc.isScreenSharing} style={styles.fullVideo} zOrder={0}/>}
  <Pressable accessibilityRole="button" accessibilityLabel={controls?t("Hide call controls"):t("Show call controls")} onPress={()=>setControls(v=>!v)} style={StyleSheet.absoluteFill}/>
  {remote&&foreground&&(!rtc.remoteScreenSharing||showControls)&&<DraggableCallPreview testID="axonic-call-self-view" style={[styles.selfView,{top:insets.top+16,right:insets.right+16}]}>
   <View style={styles.pipWrap}><View style={styles.pip}>{rtc.isCameraOff&&!rtc.isScreenSharing||!local?<View style={{flex:1,alignItems:'center',justifyContent:'center',gap:8}}><Ionicons name="videocam-off" size={28} color="#fff"/><Text style={{color:'#fff',fontSize:12}}>{rtc.isCameraOff?t("Camera off"):t("No preview")}</Text></View>:<RTCView streamURL={local} objectFit={rtc.isScreenSharing?"contain":"cover"} mirror={!rtc.isScreenSharing} style={{flex:1}} zOrder={1}/>}</View></View>
   {showControls&&rtc.isScreenSharing&&<Text style={[styles.quality,{color:colors.primary,fontSize:11,textAlign:'center'}]}>{t("Sharing screen")}</Text>}
   {showControls&&quality.level!=='unknown'&&<View testID="axonic-call-connection-quality" style={styles.quality}><Text style={{textAlign:'center',fontSize:11,fontWeight:'700',color:quality.level==='good'?colors.success:quality.level==='fair'?colors.warning:colors.error}}>{quality.level.toUpperCase()}</Text>{(quality.roundTripTimeMs!=null||quality.packetLossPercent!=null)&&<Text style={{color:'#fff',fontSize:10,textAlign:'center'}}>{quality.roundTripTimeMs!=null?`${quality.roundTripTimeMs} ms`:''}{quality.roundTripTimeMs!=null&&quality.packetLossPercent!=null?' · ':''}{quality.packetLossPercent!=null?`${quality.packetLossPercent}% loss`:''}</Text>}</View>}
  </DraggableCallPreview>}
 </>;
 const participantName=(peer:string)=>contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);
 const audience=call.room?.descriptor.members??[owner,anchor.peerUser];
 const canInvite=audience.length<MAX_GROUP_CALL_PARTICIPANTS&&(!call.room||call.room.descriptor.adHoc&&call.room.descriptor.creator===owner);
 const audienceReady=audience.every(peer=>peer===owner||peer===anchor.peerUser||!!expansionLinks[peer!]?.available);
 const participants:CallParticipant[]|undefined=call.room?.descriptor.members.map(peer=>{
  const own=peer===owner,leg=call.room!.legs.find(l=>l.peerUser===peer),original=peer===anchor.peerUser;
  return {id:peer,name:own?t("You"):participantName(peer),local:own,connected:own||(leg?.status==='ready'&&(original?!rtc.recovering&&rtc.connectionType!=='connecting':extraRemote[peer]?.connected===true)),stream:own?localVisible:leg?.status==='ready'?(original?remote:extraRemote[peer]?.url):undefined,cameraOff:own&&rtc.isCameraOff,
   status:own?rtc.isMuted?t("Muted"):t("You"):leg?.status==='ended'?leg.reason??'Left':original?t("Connected"):extraRemote[peer]?.status??leg?.status??'Waiting',
   speaking:own?!rtc.isMuted&&Object.values(speakers).some(s=>s.local):leg?.status==='ready'&&!!speakers[peer]?.remote};
 });
 const status=rtc.recovering?t("Reconnecting…"):connected?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):t("Connecting…");
 const minimizeMedia=()=>{setOptions(false);minimize();};
 const homeWindow=Platform.OS==='android'&&!foreground;
 const shareBar=<View testID="axonic-screen-share-controls" onLayout={event=>setBarFraction(event.nativeEvent.layout.height/Dimensions.get('screen').height)} pointerEvents={excludedFraction===barFraction&&barFraction>0?'auto':'none'} style={{opacity:excludedFraction===barFraction&&barFraction>0?1:0,backgroundColor:'#071426',paddingTop:12,paddingBottom:Math.max(insets.bottom,12),paddingLeft:insets.left+12,paddingRight:insets.right+12}}>
  <Text numberOfLines={1} style={{color:'#9cc4d5',textAlign:'center',marginBottom:8}}>{rtc.isScreenSharing?t("You are sharing your screen"):`${name} is sharing`} · {status}</Text>
  <View style={{flexDirection:'row',justifyContent:'space-evenly',alignItems:'center'}}>
   <ActionButton size={52} icon={rtc.isMuted?'mic-off':'mic'} label={rtc.isMuted?t("Unmute"):t("Mute")} active={rtc.isMuted} onPress={rtc.toggleMute} Colors={colors}/>
   {rtc.isScreenSharing?<ActionButton size={52} icon="stop-circle-outline" label={t("Stop sharing")} active onPress={()=>void rtc.stopScreenSharing()} Colors={colors}/>:<View accessibilityLabel={t("Only the person sharing can stop their screen share")} style={{alignItems:'center',opacity:0.65}}><Ionicons name="desktop-outline" size={28} color={colors.primary}/><Text style={{color:'#fff',marginTop:8}}>{t("Viewing screen")}</Text></View>}
   <EndButton video onPress={hangup}/>
  </View>
  {!!rtc.screenShareError&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{rtc.screenShareError}</Text>}
 </View>;
 return <>
 {call.room&&rtc.localStream&&call.room.legs.filter(l=>l.id!==anchor.id&&l.status==='ready'&&l.transport).map(leg=><GroupLeg key={leg.id} leg={leg} stream={rtc.localStream!} update={updateRemote} connected={onConnected} speaking={speaking} expansion={registerExpansion}/>)}
 <CallSessionScreen participants={participants} name={name} status={status} video={video} avatarUri={avatarUri} avatar={!video||(!remote&&!localVisible)} background={background} show={showControls}
 minimized={minimized} homeWindow={homeWindow} hideHome={rtc.isScreenSharing} homeStream={remote||localVisible} homeMirror={!remote&&!rtc.isScreenSharing} restore={restore} minimize={minimizeMedia} end={hangup}
 minimizedContent={rtc.isScreenSharing?(!nativeShareControls?<View testID="axonic-sharing-bottom-bar" style={{position:'absolute',bottom:0,left:0,right:0,zIndex:100,elevation:20}}>{shareBar}</View>:null):undefined}
 specialStage={sharing?<View testID="axonic-screen-share-stage" style={{flex:1,backgroundColor:'#000',paddingTop:insets.top}}>
  <StatusBar style="light"/>
  <View style={{flex:1,marginLeft:insets.left,marginRight:insets.right}}>
   {(rtc.remoteScreenSharing?remote:localVisible)&&<RTCView streamURL={(rtc.remoteScreenSharing?remote:localVisible)!} objectFit="contain" mirror={false} style={StyleSheet.absoluteFill} zOrder={0}/>}
  </View>
  {rtc.isScreenSharing&&!nativeShareControls&&shareBar}
 </View>:undefined}>
 {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error}</Text>}
 {!!rtc.screenShareError&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{rtc.screenShareError}</Text>}
 <CallControls video={video} muted={rtc.isMuted} mute={rtc.toggleMute} cameraOff={rtc.isCameraOff} sharing={rtc.isScreenSharing} camera={rtc.isScreenSharing?()=>void rtc.stopScreenSharing():rtc.toggleCamera} flip={rtc.switchCamera} options={()=>setOptions(true)} audioBluetooth={audioRoutes?.devices.find(d=>d.id===audioRoutes.selectedId)?.kind==='bluetooth'} end={hangup}/>
 </CallSessionScreen>
 <CallOptions visible={!homeWindow&&!minimized&&options} video={video} close={()=>setOptions(false)} audioRoutes={audioRoutes} routeAudio={routeAudio} error={error||audioError}
 addPeople={canInvite?{available:connected&&rtc.canExpandCall&&audienceReady&&!rtc.recovering&&!rtc.isScreenSharing&&!rtc.remoteScreenSharing,open:()=>setAdding(true)}:undefined}
 sharing={call.room?undefined:{active:rtc.isScreenSharing,busy:rtc.screenShareBusy,available:callScreenCaptureAvailable,toggle:()=>{if(rtc.isScreenSharing)void rtc.stopScreenSharing();else void startSharing();}}}
 quality={{mode:rtc.videoQualityMode,select:rtc.selectVideoQuality,error:rtc.videoQualityError}}/>
 {adding&&canInvite&&<GroupCallPicker name="Keep your current call connected" existingCount={audience.length} initialKind={call.media} members={contacts.filter(c=>!audience.includes(c.account)).map(c=>({id:c.account,name:c.alias||shortIdentity(c.account),blocked:c.blocked}))} onClose={()=>setAdding(false)} onCall={ids=>invite(ids)}/>}

 </>;
}
