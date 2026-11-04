import {t} from '../../localization/language';
import DraggableCallPreview from './DraggableCallPreview';
import React from 'react';
import {Modal,View,Text,Pressable,StyleSheet,ScrollView} from 'react-native';
import {RTCView} from 'react-native-webrtc';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {CallLayout,EndButton} from './CallStage';
import {ActionButton,makeStyles} from './CallAppearance';
export interface CallParticipant {id:string;name:string;status:string;stream?:string;local?:boolean;connected?:boolean;speaking?:boolean;cameraOff?:boolean}
export interface CallSessionScreenProps {
 name:string;status:string;video:boolean;avatarUri?:string|null;avatar?:boolean;background?:React.ReactNode;participants?:CallParticipant[];
 show?:boolean;minimized:boolean;homeWindow?:boolean;hideHome?:boolean;homeStream?:string;homeMirror?:boolean;
 restore():void;minimize():void;end():void;children:React.ReactNode;specialStage?:React.ReactNode;minimizedContent?:React.ReactNode;
}
/** One presentation for voice/video, private/room and minimized/system windows.
 * Media owners stay mounted outside this screen when its modal is hidden. */
export default function CallSessionScreen(p:CallSessionScreenProps){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),show=p.show!==false;
 const content=p.participants&&!p.video?<ScrollView contentContainerStyle={{flexDirection:'row',flexWrap:'wrap',padding:12,gap:10,flexGrow:1}}>{p.participants.map(person=><View key={person.id} accessibilityLabel={person.name+(person.speaking?', speaking':'')} style={{width:p.participants!.length>2?'48%':'100%',minHeight:p.video?220:140,borderRadius:24,borderWidth:2,borderColor:person.speaking?colors.primary:colors.neonBorder,boxShadow:person.speaking?'0 0 14px '+colors.primary:undefined,backgroundColor:colors.surface,overflow:'hidden'}}>
 {p.video&&person.stream&&!person.cameraOff?<RTCView streamURL={person.stream} objectFit="cover" mirror={!!person.local} style={StyleSheet.absoluteFill} zOrder={0}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center',minHeight:100}}><Ionicons name="person-circle-outline" size={64} color={colors.primary}/></View>}
 <View style={{padding:12,backgroundColor:'#031426cc',marginTop:'auto'}}><Text numberOfLines={1} style={{color:'#fff',fontWeight:'600'}}>{person.name}</Text><Text style={{color:'#a4cad4',fontSize:12}}>{person.speaking?t("Speaking…"):person.status}</Text></View></View>)}</ScrollView>:undefined;
 // Layout follows live media, not the invitation roster; media owners remain mounted.
 const visible=p.participants?.filter(person=>person.local||person.connected!==false);
 const remote=visible?.filter(person=>!person.local),self=visible?.find(person=>person.local);
 const styles=makeStyles(colors),quadrants=visible?.length===4;
 const tiles=quadrants?[...(remote??[]),...(self?[self]:[])]:remote;
 const groupVideo=p.video&&remote?<>
  <View testID="axonic-group-remote-stage" style={[StyleSheet.absoluteFill,quadrants&&{flexDirection:'row',flexWrap:'wrap'}]}>
   {tiles!.map((person,index)=><View key={person.id} testID={person.local?'axonic-group-self-tile':'axonic-group-remote-tile'} accessibilityLabel={person.name+(person.speaking?', speaking':'')} style={{...(quadrants?{width:'50%' as const,height:'50%' as const}:{flex:1}),minHeight:0,overflow:'hidden',backgroundColor:'#020413'}}>
    {person.stream&&!person.cameraOff?<RTCView streamURL={person.stream} objectFit="cover" mirror={!!person.local} style={StyleSheet.absoluteFill} zOrder={0}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Ionicons name="person-circle-outline" size={64} color={colors.primary}/></View>}
    <View style={{position:'absolute',left:12,...(quadrants?index>=2?{top:12}:{bottom:12}:index===remote.length-1&&remote.length>1?{top:12}:{bottom:12}),backgroundColor:'#031426cc',padding:8,borderRadius:12}}><Text style={{color:'#fff'}}>{person.name}</Text><Text style={{color:'#a4cad4',fontSize:12}}>{person.speaking?t("Speaking…"):person.status}</Text></View>
   </View>)}
  </View>
  {self&&!quadrants&&<DraggableCallPreview testID="axonic-call-self-view" style={[styles.selfView,{top:insets.top+16,right:insets.right+16}]}>
   <View style={styles.pipWrap}><View style={styles.pip}>{self.stream&&!self.cameraOff?<RTCView streamURL={self.stream} objectFit="cover" mirror style={{flex:1}} zOrder={1}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Ionicons name="videocam-off" size={28} color="#fff"/></View>}</View></View>
  </DraggableCallPreview>}
 </>:undefined;
 return <>
 {p.homeWindow&&!p.hideHome&&<View testID="axonic-system-call-window" pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'#020413',zIndex:100,elevation:20,alignItems:'center',justifyContent:'center',gap:8}]}>{p.video&&p.homeStream?<RTCView streamURL={p.homeStream} objectFit="contain" mirror={p.homeMirror} style={StyleSheet.absoluteFill} zOrder={0}/>:<><Ionicons name={p.video?'videocam':'call'} size={36} color={colors.primary}/><Text style={{color:'#fff'}}>{p.name}</Text><Text style={{color:'#fff'}}>{p.status}</Text></>}</View>}
 {!p.homeWindow&&p.minimized&&(p.minimizedContent!==undefined?p.minimizedContent:<MinimizedCall name={p.name} status={p.status} video={p.video} stream={p.homeStream} restore={p.restore} end={p.end}/>)}
 <Modal visible={!p.homeWindow&&!p.minimized} animationType="slide" onRequestClose={p.minimize}>
 {p.specialStage??<CallLayout name={p.name} avatarUri={p.avatarUri} status={p.status} video={p.video} background={groupVideo??p.background} show={show} avatar={p.participants?false:p.avatar} content={content}>{p.children}</CallLayout>}
 {show&&!p.specialStage&&<Pressable accessibilityRole="button" accessibilityLabel={t("Minimize call")} testID="axonic-minimize-call" onPress={p.minimize} style={{position:'absolute',top:insets.top+12,left:insets.left+12,width:44,height:44,borderRadius:22,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-forward" size={28} color="#fff"/></Pressable>}
 </Modal>
 </>;
}
export function CallControls({video,muted,mute,cameraOff,camera,sharing=false,flip,options,audioBluetooth=false,end}:{video:boolean;muted:boolean;mute():void;cameraOff?:boolean;camera?():void;sharing?:boolean;flip?():void;options?():void;audioBluetooth?:boolean;end():void}){
 const {colors}=useTheme(),styles=makeStyles(colors);return <View style={[styles.actions,video&&{paddingHorizontal:8}]}>
 <ActionButton size={video?52:64} icon={muted?'mic-off':'mic'} label={muted?t("Unmute"):t("Mute")} active={muted} onPress={mute} Colors={colors}/>
 {video&&camera&&<ActionButton size={52} icon={sharing?'stop-circle-outline':cameraOff?'videocam-off':'videocam'} label={sharing?t("Stop share"):cameraOff?t("Cam On"):t("Cam Off")} active={sharing||cameraOff} onPress={camera} Colors={colors}/>}
 <EndButton video={video} onPress={end}/>
 {video&&!sharing&&flip&&<ActionButton size={52} icon="camera-reverse-outline" label={t("Flip")} onPress={flip} Colors={colors}/>}
 {options&&<ActionButton size={video?52:64} icon={video?'options-outline':audioBluetooth?'bluetooth':'volume-high-outline'} label={t("Options")} onPress={options} Colors={colors}/>}
 </View>;
}
export function MinimizedCall({name,status,video,stream,restore,end}:{name:string;status:string;video:boolean;stream?:string;restore():void;end():void}){
 const insets=useSafeAreaInsets(),{colors}=useTheme();
 return <View testID="axonic-minimized-call" style={{position:'absolute',top:insets.top+12,right:insets.right+12,width:156,borderRadius:16,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.primary,overflow:'hidden',elevation:12,zIndex:100}}>
  <View style={{height:video?196:124}}>
   <Pressable accessible={false} onPress={restore} style={StyleSheet.absoluteFill}>
    <View pointerEvents="none" style={{flex:1,alignItems:'center',justifyContent:'center'}}>{video&&stream?<RTCView streamURL={stream} objectFit="cover" style={StyleSheet.absoluteFill} zOrder={0}/>:<Ionicons name={video?'videocam':'call'} size={24} color={colors.primary}/>}</View>
   </Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel={t("Return to call")} onPress={restore} style={{position:'absolute',top:4,left:4,width:44,height:44,borderRadius:22,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="arrow-back" size={24} color="#fff"/></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel={t("End call")} onPress={end} style={{position:'absolute',bottom:8,alignSelf:'center',width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:colors.error}}><Ionicons name="call" size={22} color="#fff" style={{transform:[{rotate:'135deg'}]}}/></Pressable>
  </View>
  <Pressable accessibilityRole="button" accessibilityLabel={t("Return to call details")} onPress={restore}>
   <View style={{paddingHorizontal:10,paddingVertical:8}}><Text numberOfLines={1} style={{color:colors.text,fontWeight:'600'}}>{name}</Text><Text numberOfLines={1} style={{color:colors.textSecondary,fontSize:12}}>{status}</Text></View>
  </Pressable>
 </View>;
}

