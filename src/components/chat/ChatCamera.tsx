import {t} from '../../localization/language';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Modal,Pressable,StyleSheet,Text,View} from 'react-native';
import {CameraView,type CameraCapturedPicture} from 'expo-camera';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';

export default function ChatCamera({onCancel,onCapture}:{onCancel():void;onCapture(photo:CameraCapturedPicture):void}){
 const camera=useRef<CameraView>(null),alive=useRef(true),capturing=useRef(false);
 const [facing,setFacing]=useState<'back'|'front'>('back'),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 const cancel=useRef(onCancel);cancel.current=onCancel;
 const dismiss=()=>{alive.current=false;cancel.current();};
 useEffect(()=>{alive.current=true;const sub=AppState.addEventListener('change',s=>{if(s==='background'){alive.current=false;cancel.current();}});return()=>{alive.current=false;sub.remove();};},[]);
 async function capture(){
  if(!ready||capturing.current)return;capturing.current=true;setBusy(true);setError('');
  try{const photo=await camera.current?.takePictureAsync({quality:0.7,exif:false,shutterSound:false});if(alive.current&&photo?.uri)onCapture(photo);}
  catch{if(alive.current)setError(t("Could not take the photo. Please try again."));}
  finally{capturing.current=false;if(alive.current)setBusy(false);}
 }
 const button={width:48,height:48,borderRadius:24,alignItems:'center' as const,justifyContent:'center' as const,backgroundColor:colors.headerBg,borderWidth:1,borderColor:colors.neonBorder};
 return <Modal visible animationType="none" statusBarTranslucent onRequestClose={dismiss}><View style={{flex:1,backgroundColor:'#000'}}>
  <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" onCameraReady={()=>setReady(true)} onMountError={()=>{setReady(false);setError(t("Camera unavailable. Close and try again."));}}/>
  <Pressable accessibilityRole="button" accessibilityLabel={t("Close camera")} onPress={dismiss} style={[button,{position:'absolute',top:insets.top+12,left:16}]}><Ionicons name="close" size={26} color={colors.primary}/></Pressable>
  <View style={{position:'absolute',bottom:insets.bottom+24,left:24,right:24,alignItems:'center',gap:16}}>
   {!!error&&<Text accessibilityRole="alert" style={{color:'#fff',backgroundColor:colors.headerBg,padding:12,borderRadius:16}}>{error}</Text>}
   <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',width:'100%'}}><View style={{width:48}}/>
    <Pressable accessibilityLabel={t("Take picture")} accessibilityRole="button" disabled={!ready||busy} onPress={()=>void capture()} style={{width:76,height:76,borderRadius:38,borderWidth:3,borderColor:colors.primary,backgroundColor:colors.headerBg,alignItems:'center',justifyContent:'center',opacity:ready?1:0.45}}>{busy?<ActivityIndicator color={colors.primary}/>:<View style={{width:58,height:58,borderRadius:29,backgroundColor:colors.primary}}/>}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t("Switch camera")} disabled={busy} onPress={()=>{setReady(false);setFacing(f=>f==='back'?'front':'back');}} style={button}><Ionicons name="camera-reverse-outline" size={26} color={colors.primary}/></Pressable>
   </View>
  </View>
 </View></Modal>;
}
