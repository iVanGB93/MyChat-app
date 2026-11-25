import {t,languageSnapshot} from '../../localization/language';
import React,{useEffect,useMemo,useState} from 'react';
import {ScrollView,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';
import {makeStyles} from './CallAppearance';
export function EndButton({ended=false,video=false,onPress}:{ended?:boolean;video?:boolean;onPress:()=>void}){
 const {colors}=useTheme();return <View style={{alignItems:'center'}}><TouchableOpacity testID="axonic-end-call" accessibilityRole="button" accessibilityLabel={ended?t("Close call"):t("End call")} onPress={onPress} activeOpacity={0.8} style={[makeStyles(colors).endBtn,video&&{width:64,height:64,borderRadius:32}]}><Ionicons name={ended?'close':'call'} color="#fff" size={28} style={ended?undefined:{transform:[{rotate:'135deg'}]}}/></TouchableOpacity><Text style={makeStyles(colors).actionLabel}>{ended?t("Close"):'End'}</Text></View>;
}
function elapsedCallTime(startedAt:number){
 const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
 return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}

/** Refresh only the visible label, without rendering the call media tree. */
export function CallElapsedTime({startedAt,foreground}:{startedAt:number;foreground:boolean}){
 const [label,setLabel]=useState(()=>elapsedCallTime(startedAt));
 useEffect(()=>{
  if(!foreground)return;
  const refresh=()=>setLabel(elapsedCallTime(startedAt));
  refresh();
  const timer=setInterval(refresh,1000);
  return()=>clearInterval(timer);
 },[startedAt,foreground]);
 return label;
}

export function CallLayout({name,avatarUri,status,video,children,background,show=true,avatar=true,content}:{name:string;avatarUri?:string|null;status:React.ReactNode;video?:boolean;children:React.ReactNode;background?:React.ReactNode;show?:boolean;avatar?:boolean;content?:React.ReactNode}){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),styles=useMemo(()=>makeStyles(colors),[colors,languageSnapshot()]);
 const compact=!!content||video&&!avatar;
 return <View style={styles.container}><StatusBar style="light"/>{background}{show&&<View style={[styles.overlay,{paddingTop:insets.top+24,paddingBottom:Math.max(insets.bottom,16)+16,paddingLeft:insets.left,paddingRight:insets.right}]} pointerEvents="box-none">
   <ScrollView keyboardShouldPersistTaps="handled" style={{flexGrow:0,flexShrink:1}} contentContainerStyle={[styles.top,compact&&{alignItems:'flex-start',paddingLeft:64,paddingRight:140}]}>
    {!compact&&<View style={[styles.typePill,{borderColor:colors.neonBorder}]}><Ionicons name={video?'videocam-outline':'call-outline'} size={14} color={colors.primary}/><Text style={[styles.typePillText,{color:colors.primary,marginLeft:6}]}>{video?t("VIDEO CALL"):t("VOICE CALL")}</Text></View>}
    {avatar&&<View style={styles.avatarWrap}><Avatar name={name} uri={avatarUri} size={120}/></View>}
    <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.name,compact&&{fontSize:22,marginTop:0,textAlign:'left'}]}>{name}</Text><Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
   </ScrollView>{content&&<View style={{flex:1,minHeight:0}}>{content}</View>}<View style={{flexShrink:0}}>{children}</View>
 </View>}</View>;
}
