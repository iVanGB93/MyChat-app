import {t,languageSnapshot} from '../../localization/language';
import CallSessionScreen,{CallControls,type CallParticipant} from './CallSessionScreen';
import CallOptions from './CallOptions';
import {useCallAudioSession} from './useCallAudioSession';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Platform,Text} from 'react-native';
import {MediaStream,mediaDevices} from 'react-native-webrtc';
import {useTheme} from '../../contexts/ThemeContext';
import {useChatContacts} from '../../modules/ui/useChatSnapshot';
import {localAccount,shortIdentity} from '../../modules/identity';
import {localAccountCalls,markRootCallConnected,type NeuronCallView} from '../../modules/calls';
import useWebRTCCore from '../../hooks/useWebRTCCore';
import {createGroupCallCapture} from '../../services/groupCallCapture';
import {callCameraPreview} from '../../services/callCameraPreview';
import type {GroupCallRoom} from '../../modules/calls';

export type CallExpansionLink={available:boolean;request(room:GroupCallRoom):Promise<boolean>};

/** The room is the sole owner of capture/audio/OS lifetime. Leg components retain
 * media while minimized, and release only their senders when a participant leaves. */
export default function RootGroupCallMedia({call,end,minimized,minimize,restore}:{call:NeuronCallView<string>;end():void;minimized:boolean;minimize():void;restore():void}){
 const {audioRoutes,routeAudio,audioError,foreground}=useCallAudioSession(call.id,call.media==='video',end);
 const [options,setOptions]=useState(false);
 const {colors}=useTheme(),{contacts}=useChatContacts(true);
 const owner=localAccount.status().account,room=call.room!,video=call.media==='video';
 const [stream,setStream]=useState<MediaStream|null>(null),[error,setError]=useState(''),[muted,setMuted]=useState(false),[cameraOff,setCameraOff]=useState(false);
 const capture=useRef(createGroupCallCapture(async()=>{
  await callCameraPreview.stop();
  return mediaDevices.getUserMedia({audio:true,video:video?{facingMode:'user',width:640,height:480,frameRate:24}:false});
 }));
 const endRef=useRef(end);endRef.current=end;
 useEffect(()=>{
  let active=true;const own=capture.current;
  void own.acquire().then(s=>{if(active)setStream(s);}).catch(e=>{if(active){setError(e instanceof Error?e.message:t("Capture unavailable"));endRef.current();}});
  return()=>{active=false;own.stop();};
 },[call.id]);
 const name=(peer:string)=>contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);
 const label=(peer:string)=>peer===owner?t("You"):name(peer);
 const [remote,setRemote]=useState<Record<string,{url?:string;status:string;connected:boolean}>>({});
 const update=useCallback((peer:string,value:{url?:string;status:string;connected:boolean}|null)=>setRemote(old=>{const next={...old};if(value)next[peer]=value;else delete next[peer];return next;}),[languageSnapshot()]);
 const [speakers,setSpeakers]=useState<Record<string,{local:boolean;remote:boolean}>>({});
 const speaking=useCallback((peer:string,local:boolean,remote:boolean)=>setSpeakers(old=>old[peer]?.local===local&&old[peer]?.remote===remote?old:{...old,[peer]:{local,remote}}),[languageSnapshot()]);
 const connected=useCallback(()=>markRootCallConnected(call.id),[call.id,languageSnapshot()]);
 const peers=room.descriptor.members;
 const participants:CallParticipant[]=peers.map(peer=>{const own=peer===owner,leg=room.legs.find(l=>l.peerUser===peer),entry=remote[peer];return {id:peer,name:label(peer),local:own,connected:own||(leg?.status==='ready'&&entry?.connected===true),stream:own?stream?.toURL():entry?.url,cameraOff:own&&cameraOff,status:own?muted?t("Muted"):t("You"):entry?.status??(leg?.status==='ended'?leg.reason??'Left':leg?.status??'Waiting'),speaking:own?!muted&&Object.entries(speakers).some(([id,s])=>s.local&&room.legs.some(l=>l.peerUser===id&&l.status==='ready')):leg?.status==='ready'&&!!speakers[peer]?.remote};});
 return <>
  {stream&&room.legs.filter(l=>l.status==='ready'&&l.transport).map(leg=><GroupLeg key={leg.id} leg={leg} stream={stream} update={update} connected={connected} speaking={speaking}/>)}
 <CallSessionScreen name={room.name} status={'Group '+call.media+' call'} video={video} participants={participants} minimized={minimized} homeWindow={Platform.OS==='android'&&!foreground} homeStream={participants.find(p=>!p.local&&p.stream)?.stream} end={end} restore={restore} minimize={()=>{setOptions(false);minimize();}}>
 {!!(error||audioError)&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{error||audioError}</Text>}
 <CallControls video={video} muted={muted} mute={()=>{capture.current.mute(!muted);setMuted(!muted);}} cameraOff={cameraOff} camera={()=>{capture.current.cameraOff(!cameraOff);setCameraOff(!cameraOff);}} flip={()=>{for(const track of stream?.getVideoTracks()??[])track._switchCamera();}} options={()=>setOptions(true)} audioBluetooth={audioRoutes?.devices.find(d=>d.id===audioRoutes.selectedId)?.kind==='bluetooth'} end={end}/>
 </CallSessionScreen>
 <CallOptions visible={foreground&&!minimized&&options} video={video} close={()=>setOptions(false)} audioRoutes={audioRoutes} routeAudio={routeAudio} error={audioError}/>
 </>;
}

export function GroupLeg({leg,stream,update,connected,speaking,expansion}:{leg:NeuronCallView<string>;stream:MediaStream;update(peer:string,value:{url?:string;status:string;connected:boolean}|null):void;connected():void;speaking(peer:string,local:boolean,remote:boolean):void;expansion?(peer:string,link:CallExpansionLink|null):void}){
 const disconnected=useCallback(()=>{void localAccountCalls()?.endParticipant(leg.id);},[leg.id,languageSnapshot()]);
 const setupDeadline=useRef<ReturnType<typeof setTimeout>|null>(null);
 const established=useRef(false);
 const onConnected=useCallback(()=>{established.current=true;if(setupDeadline.current!==null){clearTimeout(setupDeadline.current);setupDeadline.current=null;}connected();},[connected,languageSnapshot()]);
 const onSpeaking=useCallback((local:boolean,remote:boolean)=>speaking(leg.peerUser,local,remote),[leg.peerUser,speaking,languageSnapshot()]);
 const adopt=useCallback((room:GroupCallRoom)=>localAccountCalls()?.adoptExpansion(leg.id,room,leg.peerUser)??Promise.resolve(false),[leg.id,leg.peerUser]);
 // The inviting screen commits locally only after every existing participant
 // confirms. This leg acknowledges its own exchange without replacing media.
 const acknowledged=useCallback(async()=>true,[]);
 const rtc=useWebRTCCore({callId:leg.id,callType:leg.media,isOutgoing:leg.outgoing,peerUserId:leg.peerUser,mediaTransport:leg.transport,roomStream:stream,onExpandCall:adopt,onExpansionAccepted:acknowledged,onSpeaking,onConnected,onDisconnected:disconnected});
 useEffect(()=>{expansion?.(leg.peerUser,{available:rtc.canExpandCall&&!rtc.recovering&&rtc.connectionType!=='connecting',request:rtc.expandCall});return()=>expansion?.(leg.peerUser,null);},[expansion,leg.peerUser,rtc.canExpandCall,rtc.recovering,rtc.connectionType,rtc.expandCall]);
 // A signaling-ready leg may never establish media (for example exhausted TURN
 // allocations). End only that leg instead of leaving an infinite Connecting tile.
 useEffect(()=>{if(!established.current)setupDeadline.current=setTimeout(disconnected,45000);return()=>{if(setupDeadline.current!==null)clearTimeout(setupDeadline.current);};},[leg.id,disconnected]);
 useEffect(()=>{if(leg.outgoing)void rtc.startAsOfferer();},[leg.id]);
 useEffect(()=>{update(leg.peerUser,{url:rtc.remoteStream?.toURL(),connected:!rtc.recovering&&rtc.connectionType!=='connecting',status:rtc.recovering?t("Reconnecting…"):rtc.connectionType==='p2p'?'Direct':rtc.connectionType==='relayed'?'TURN relay':rtc.connectionType==='connected'?t("Connected"):t("Connecting…")});},[leg.peerUser,rtc.remoteStream,rtc.recovering,rtc.connectionType,update]);
 useEffect(()=>()=>{update(leg.peerUser,null);speaking(leg.peerUser,false,false);},[leg.peerUser,update,speaking]);
 return null;
}

