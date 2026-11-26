import {t} from '../../localization/language';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Animated,AppState,Easing,FlatList,Modal,Pressable,StyleSheet,Text,View} from 'react-native';
import {CameraView} from 'expo-camera';
import {launchImageLibraryAsync,type ImagePickerAsset} from 'expo-image-picker';
import {Image} from 'expo-image';
import {File,Paths} from 'expo-file-system';
import Svg,{Rect} from 'react-native-svg';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {recentRootPhotos} from '../../modules/storage';

const CLIP_SECONDS=5;
const AnimatedOutline=Animated.createAnimatedComponent(Rect);
export function discardChatCapture(uri:string){
 try{if(uri.startsWith(Paths.cache.uri)){const file=new File(uri);if(file.exists)file.delete();}}catch{/* Capture cache only. */}
}
export default function ChatCamera({onCancel,onCapture,mode='picture'}:{onCancel():void;onCapture(asset:ImagePickerAsset,temporary:boolean):void;mode?:'picture'|'video'}){
 const camera=useRef<CameraView>(null),alive=useRef(true),capturing=useRef(false),browsing=useRef(false);
 const [facing,setFacing]=useState<'back'|'front'>('back'),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [photos,setPhotos]=useState<ImagePickerAsset[]>([]),[outline,setOutline]=useState({width:0,height:0});
 const progress=useRef(new Animated.Value(0)).current;
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 const video=mode==='video';
 const cancel=useRef(onCancel);cancel.current=onCancel;
 const deliver=useRef(onCapture);deliver.current=onCapture;
 const finish=(asset:ImagePickerAsset,temporary=false)=>{if(alive.current){alive.current=false;deliver.current(asset,temporary);}};
 const dismiss=()=>{alive.current=false;camera.current?.stopRecording();cancel.current();};
 useEffect(()=>{alive.current=true;const sub=AppState.addEventListener('change',s=>{if(s==='background'&&!browsing.current){alive.current=false;camera.current?.stopRecording();cancel.current();}});return()=>{alive.current=false;sub.remove();};},[]);
 useEffect(()=>{if(!video)void recentRootPhotos()?.then(items=>{if(alive.current)setPhotos(items);}).catch(()=>{});},[video]);
 async function capture(){
  if(!ready||capturing.current)return;capturing.current=true;setBusy(true);setError('');
  try{
   const photo=await camera.current?.takePictureAsync({quality:0.7,exif:false,shutterSound:false});
   if(photo?.uri){
    if(alive.current)finish({...photo,type:'image',mimeType:'image/jpeg',fileName:'Photo.jpg',fileSize:new File(photo.uri).size},true);
    else discardChatCapture(photo.uri);
   }
  }catch{if(alive.current)setError(t("Could not take the photo. Please try again."));}
  finally{capturing.current=false;if(alive.current)setBusy(false);}
 }
 async function browse(){
  if(capturing.current||browsing.current)return;
  browsing.current=true;
  try{const result=await launchImageLibraryAsync({mediaTypes:['images'],quality:1});if(!result.canceled&&result.assets[0])finish(result.assets[0]);}
  catch{if(alive.current)setError(t("The selected media is unavailable"));}
  finally{browsing.current=false;}
 }
 async function record(){
  if(!camera.current||!ready||capturing.current)return;
  capturing.current=true;setBusy(true);setError('');progress.setValue(0);
  const animation=Animated.timing(progress,{toValue:1,duration:CLIP_SECONDS*1000,easing:Easing.linear,useNativeDriver:false,isInteraction:false});
  try{
   animation.start();
   const clip=await camera.current.recordAsync({maxDuration:CLIP_SECONDS});
   if(clip?.uri){
    const quickTime=clip.uri.toLowerCase().endsWith('.mov');
    if(alive.current)finish({uri:clip.uri,type:'video',width:0,height:0,mimeType:quickTime?'video/quicktime':'video/mp4',fileName:quickTime?'Video.mov':'Video.mp4',fileSize:new File(clip.uri).size},true);
    else discardChatCapture(clip.uri);
   }else if(alive.current)setError(t("Could not record the video. Please try again."));
  }catch{if(alive.current)setError(t("Could not record the video. Please try again."));}
  finally{animation.stop();capturing.current=false;if(alive.current)setBusy(false);}
 }
 useEffect(()=>{if(video&&ready)void record();},[video,ready]);
 const button={width:48,height:48,borderRadius:24,alignItems:'center' as const,justifyContent:'center' as const,backgroundColor:colors.headerBg,borderWidth:1,borderColor:colors.neonBorder};
 const perimeter=2*(outline.width+outline.height-16);
 return <Modal visible animationType="none" statusBarTranslucent onRequestClose={dismiss}><View style={{flex:1,backgroundColor:'#000'}}>
  <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode={mode} videoQuality="720p" onCameraReady={()=>setReady(true)} onMountError={()=>{setReady(false);setError(t("Camera unavailable. Close and try again."));}}/>
  {video&&<View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={event=>setOutline(event.nativeEvent.layout)}>{busy&&perimeter>0&&<Svg width={outline.width} height={outline.height}><AnimatedOutline x={4} y={4} width={outline.width-8} height={outline.height-8} stroke={colors.error} strokeWidth={4} fill="none" strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={progress.interpolate({inputRange:[0,1],outputRange:[perimeter,0]})}/></Svg>}</View>}
  <Pressable accessibilityRole="button" accessibilityLabel={t("Close camera")} onPress={dismiss} style={[button,{position:'absolute',top:insets.top+12,left:16}]}><Ionicons name="close" size={26} color={colors.primary}/></Pressable>
  <View style={{position:'absolute',bottom:insets.bottom+24,left:24,right:24,alignItems:'center',gap:16}}>
   {!!error&&<Text accessibilityRole="alert" style={{color:'#fff',backgroundColor:colors.headerBg,padding:12,borderRadius:16}}>{error}</Text>}
   {video?(!busy&&ready&&!!error&&<Pressable accessibilityRole="button" accessibilityLabel={t("Retry")} onPress={()=>void record()} style={button}><Ionicons name="refresh" size={24} color={colors.primary}/></Pressable>):<><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',width:'100%'}}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("Choose a photo")} disabled={busy} onPress={()=>void browse()} style={button}><Ionicons name="images-outline" size={24} color={colors.primary}/></Pressable>
    <Pressable accessibilityLabel={t("Take picture")} accessibilityRole="button" disabled={!ready||busy} onPress={()=>void capture()} style={{width:76,height:76,borderRadius:38,borderWidth:3,borderColor:colors.primary,backgroundColor:colors.headerBg,alignItems:'center',justifyContent:'center',opacity:ready?1:0.45}}>{busy?<ActivityIndicator color={colors.primary}/>:<View style={{width:58,height:58,borderRadius:29,backgroundColor:colors.primary}}/>}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t("Switch camera")} disabled={busy} onPress={()=>{setReady(false);setFacing(f=>f==='back'?'front':'back');}} style={button}><Ionicons name="camera-reverse-outline" size={26} color={colors.primary}/></Pressable>
   </View>{photos.length>0&&<FlatList horizontal data={photos} keyExtractor={photo=>photo.uri} showsHorizontalScrollIndicator={false} style={{alignSelf:'stretch',flexGrow:0}} contentContainerStyle={{gap:8}} renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={item.fileName||t("Photo")} disabled={busy} onPress={()=>finish(item)}><Image source={{uri:item.uri}} contentFit="cover" style={{width:56,height:56,borderRadius:10,backgroundColor:colors.headerBg}}/></Pressable>}/>}</>}
  </View>
 </View></Modal>;
}
