import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Image,Pressable,View,type GestureResponderEvent} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {rootVideoThumbnail} from '../../modules/storage';
import {useTheme} from '../../contexts/ThemeContext';
import {messageBubbleStyles as styles} from './message-bubble-styles';
export default function RootVideoThumbnail({owner,digest,onPress,onLongPress}:{owner:string;digest:string;onPress():void;onLongPress?(event:GestureResponderEvent):void}){
 const {colors}=useTheme(),[preview,setPreview]=useState<string|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setPreview(null);setLoading(true);void rootVideoThumbnail(owner,digest).then(value=>{if(active){setPreview(value);setLoading(false);}});return()=>{active=false;};},[owner,digest]);
 return <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={onPress} onLongPress={onLongPress} style={[styles.videoBubble,{overflow:'hidden',justifyContent:'center',alignItems:'center',backgroundColor:colors.surface}]}>
  {preview?<Image source={{uri:preview}} style={{position:'absolute',width:'100%',height:'100%'}} resizeMode="cover"/>:loading?<ActivityIndicator color={colors.primary}/>:<Ionicons name="videocam-outline" size={48} color={colors.primary}/>}
  {!loading&&<View style={{width:48,height:48,borderRadius:24,backgroundColor:'#0009',alignItems:'center',justifyContent:'center'}}><Ionicons name="play" size={28} color="#fff"/></View>}
 </Pressable>;
}
