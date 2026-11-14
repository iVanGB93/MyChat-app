import React from 'react';
import {ActivityIndicator,Pressable,Text,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {t} from '../../localization/language';
export default function ChatHistoryLoading({error,retry}:{error?:string;retry():void}){
 const {colors}=useTheme();
 return <View accessibilityLiveRegion="polite" style={{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:12}}>
  {error?<><Text accessibilityRole="alert" style={{color:colors.textSecondary,textAlign:'center'}}>{error}</Text><Pressable accessibilityRole="button" onPress={retry} style={{minHeight:44,paddingHorizontal:20,justifyContent:'center',borderRadius:22,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface}}><Text style={{color:colors.primary}}>{t("Retry")}</Text></Pressable></>:<><ActivityIndicator color={colors.primary}/><Text style={{color:colors.textSecondary}}>{t("Loading messages…")}</Text></>}
 </View>;
}
