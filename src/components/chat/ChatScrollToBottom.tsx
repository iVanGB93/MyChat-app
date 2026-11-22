import {t} from '../../localization/language';
import React from 'react';
import {StyleSheet,TouchableOpacity} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';

export default function ChatScrollToBottom({bottom,onPress}:{bottom:number;onPress():void}){
 const {colors}=useTheme();
 return <TouchableOpacity testID="axonic-chat-latest" accessibilityRole="button" accessibilityLabel={t("Go to latest messages")} activeOpacity={0.75} onPress={onPress} style={[styles.button,{bottom,backgroundColor:colors.headerBg,borderColor:colors.neonBorder,shadowColor:colors.primary}]}>
  <Ionicons name="arrow-down" size={24} color={colors.primary}/>
 </TouchableOpacity>;
}
const styles=StyleSheet.create({button:{position:'absolute',left:'50%',marginLeft:-23,zIndex:3,width:46,height:46,borderRadius:23,borderWidth:1,alignItems:'center',justifyContent:'center',shadowOffset:{width:0,height:2},shadowOpacity:0.2,shadowRadius:6,elevation:4}});
