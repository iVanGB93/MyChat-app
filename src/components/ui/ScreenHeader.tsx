import {t} from '../../localization/language';
import React from 'react';
import StatusBarFade from './StatusBarFade';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {Chrome} from '../../theme';

/** Full-screen modal header. Owns the top safe area; content owns the bottom. */
export default function ScreenHeader({title,onBack,backLabel=t("Go back"),disabled=false,subtitle,trailing}:{
 title:string;onBack():void;backLabel?:string;disabled?:boolean;subtitle?:string;trailing?:React.ReactNode;
}){
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 return <View style={{paddingTop:insets.top+6,paddingBottom:8,paddingLeft:insets.left+Chrome.gutter,paddingRight:insets.right+Chrome.gutter}}><StatusBarFade/><View style={[styles.header,{backgroundColor:colors.headerBg,borderColor:colors.neonBorder,shadowColor:colors.primary}]}>
  <Pressable accessibilityRole="button" accessibilityLabel={backLabel} accessibilityState={{disabled}} disabled={disabled} onPress={onBack} style={({pressed})=>[styles.back,{opacity:disabled?0.4:pressed?0.7:1}]}><Ionicons name="arrow-back" size={25} color={colors.headerText}/></Pressable>
  <View style={{flex:1,minWidth:0}}><Text accessibilityRole="header" numberOfLines={2} style={[styles.title,{color:colors.headerText}]}>{title}</Text>{!!subtitle&&<Text style={[styles.subtitle,{color:colors.headerText}]}>{subtitle}</Text>}</View>
  {trailing}
 </View></View>;
}
const styles=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6,paddingLeft:4,paddingRight:16,minHeight:56,borderWidth:1,borderRadius:Chrome.panelRadius,shadowOpacity:Chrome.shadowOpacity,shadowRadius:10,shadowOffset:{width:0,height:3},elevation:3,flexShrink:0},back:{width:44,height:44,alignItems:'center',justifyContent:'center'},title:{fontSize:20,fontWeight:'700'},subtitle:{fontSize:12,marginTop:4,opacity:0.75}});
