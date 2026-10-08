import React,{useMemo} from 'react';
import {Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';
import {makeStyles} from './CallAppearance';
export function EndButton({ended=false,video=false,onPress}:{ended?:boolean;video?:boolean;onPress:()=>void}){
 const {colors}=useTheme();return <TouchableOpacity accessibilityRole="button" accessibilityLabel={ended?'Close call':'End neuron call'} onPress={onPress} style={[makeStyles(colors).endBtn,video&&{width:64,height:64,borderRadius:32}]}><Ionicons name={ended?'close':'call'} color="#fff" size={28} style={ended?undefined:{transform:[{rotate:'135deg'}]}}/></TouchableOpacity>;
}
export function CallLayout({name,status,video,children,background,show=true,avatar=true}:{name:string;status:string;video?:boolean;children:React.ReactNode;background?:React.ReactNode;show?:boolean;avatar?:boolean}){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),styles=useMemo(()=>makeStyles(colors),[colors]);
 return <View style={styles.container}><StatusBar style="light"/>{background}{show&&<View style={[styles.overlay,{paddingTop:insets.top+24,paddingBottom:Math.max(insets.bottom,16)+16}]} pointerEvents="box-none">
   <View style={styles.top}>
    <View style={styles.typePill}><Ionicons name={video?'videocam-outline':'call-outline'} size={14} color={colors.primary}/><Text style={[styles.typePillText,{color:colors.primary,marginLeft:6}]}>{video?'VIDEO CALL':'VOICE CALL'}</Text></View>
    {avatar&&<View style={styles.avatarWrap}><Avatar name={name} size={120}/></View>}
    <Text style={styles.name}>{name}</Text><Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
   </View><View>{children}</View>
 </View>}</View>;
}
