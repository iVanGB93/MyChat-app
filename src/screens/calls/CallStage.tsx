import React,{useMemo} from 'react';
import {ScrollView,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';
import {makeStyles} from './CallAppearance';
export function EndButton({ended=false,video=false,onPress}:{ended?:boolean;video?:boolean;onPress:()=>void}){
 const {colors}=useTheme();return <View style={{alignItems:'center'}}><TouchableOpacity testID="axonic-end-call" accessibilityRole="button" accessibilityLabel={ended?'Close call':'End call'} onPress={onPress} activeOpacity={0.8} style={[makeStyles(colors).endBtn,video&&{width:64,height:64,borderRadius:32}]}><Ionicons name={ended?'close':'call'} color="#fff" size={28} style={ended?undefined:{transform:[{rotate:'135deg'}]}}/></TouchableOpacity><Text style={makeStyles(colors).actionLabel}>{ended?'Close':'End'}</Text></View>;
}
export function CallLayout({name,avatarUri,status,video,children,background,show=true,avatar=true}:{name:string;avatarUri?:string|null;status:string;video?:boolean;children:React.ReactNode;background?:React.ReactNode;show?:boolean;avatar?:boolean}){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),styles=useMemo(()=>makeStyles(colors),[colors]);
 const compact=video&&!avatar;
 return <View style={styles.container}><StatusBar style="light"/>{background}{show&&<View style={[styles.overlay,{paddingTop:insets.top+24,paddingBottom:Math.max(insets.bottom,16)+16,paddingLeft:insets.left,paddingRight:insets.right}]} pointerEvents="box-none">
   <ScrollView style={{flexGrow:0,flexShrink:1}} contentContainerStyle={[styles.top,compact&&{alignItems:'flex-start',paddingLeft:64,paddingRight:140}]}>
    {!compact&&<View style={[styles.typePill,{borderColor:colors.neonBorder}]}><Ionicons name={video?'videocam-outline':'call-outline'} size={14} color={colors.primary}/><Text style={[styles.typePillText,{color:colors.primary,marginLeft:6}]}>{video?'VIDEO CALL':'VOICE CALL'}</Text></View>}
    {avatar&&<View style={styles.avatarWrap}><Avatar name={name} uri={avatarUri} size={120}/></View>}
    <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.name,compact&&{fontSize:22,marginTop:0,textAlign:'left'}]}>{name}</Text><Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
   </ScrollView><View style={{flexShrink:0}}>{children}</View>
 </View>}</View>;
}
