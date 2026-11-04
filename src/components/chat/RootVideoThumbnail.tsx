import {t} from '../../localization/language';
import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Image,Pressable,View,type GestureResponderEvent} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {rootVideoThumbnail} from '../../modules/storage';
import {useTheme} from '../../contexts/ThemeContext';
import {messageBubbleStyles as styles} from './message-bubble-styles';
export default function RootVideoThumbnail({owner,digest,onPress,onLongPress,compact=false}:{owner:string;digest:string;compact?:boolean;onPress?():void;onLongPress?(event:GestureResponderEvent):void}){
 const {colors}=useTheme(),[preview,setPreview]=useState<string|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setPreview(null);setLoading(true);void rootVideoThumbnail(owner,digest).then(value=>{if(active){setPreview(value);setLoading(false);}});return()=>{active=false;};},[owner,digest]);
 return <Pressable accessibilityRole={onPress?"button":"image"} accessibilityLabel={onPress?t("Play video"):t("Video preview")} disabled={!onPress} onPress={onPress} onLongPress={onLongPress} style={[styles.videoBubble,compact&&{width:72,height:56,borderRadius:6},{overflow:'hidden',justifyContent:'center',alignItems:'center',backgroundColor:colors.surface}]}>
  {preview?<Image source={{uri:preview}} style={{position:'absolute',width:'100%',height:'100%'}} resizeMode="cover"/>:loading?<ActivityIndicator color={colors.primary}/>:<Ionicons name="videocam-outline" size={compact?24:48} color={colors.primary}/>}
  {!loading&&<View style={{width:compact?24:48,height:compact?24:48,borderRadius:24,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="play" size={compact?16:28} color="#fff"/></View>}
 </Pressable>;
}
