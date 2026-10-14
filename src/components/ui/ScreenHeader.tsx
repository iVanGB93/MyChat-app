import React from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';

/** Full-screen modal header. Owns the top safe area; content owns the bottom. */
export default function ScreenHeader({title,onBack,backLabel='Go back',disabled=false,subtitle,trailing}:{
 title:string;onBack():void;backLabel?:string;disabled?:boolean;subtitle?:string;trailing?:React.ReactNode;
}){
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 return <><StatusBar style="light"/><View style={[styles.header,{backgroundColor:colors.headerBg,borderBottomColor:colors.neonBorder,paddingTop:insets.top+8,paddingLeft:insets.left+8,paddingRight:insets.right+16}]}>
  <Pressable accessibilityRole="button" accessibilityLabel={backLabel} accessibilityState={{disabled}} disabled={disabled} onPress={onBack} style={({pressed})=>[styles.back,{opacity:disabled?0.4:pressed?0.7:1}]}><Ionicons name="arrow-back" size={25} color={colors.headerText}/></Pressable>
  <View style={{flex:1,minWidth:0}}><Text accessibilityRole="header" numberOfLines={2} style={[styles.title,{color:colors.headerText}]}>{title}</Text>{!!subtitle&&<Text style={[styles.subtitle,{color:colors.headerText}]}>{subtitle}</Text>}</View>
  {trailing}
 </View></>;
}
const styles=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',gap:8,paddingBottom:14,borderBottomWidth:1,flexShrink:0},back:{width:44,height:44,alignItems:'center',justifyContent:'center'},title:{fontSize:22,fontWeight:'700'},subtitle:{fontSize:12,marginTop:4,opacity:0.75}});
