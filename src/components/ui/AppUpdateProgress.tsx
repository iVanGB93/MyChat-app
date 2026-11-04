import {t} from '../../localization/language';
import React from 'react';
import {View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';

export default function AppUpdateProgress({progress}:{progress?:number}){
 const {colors}=useTheme();
 if(progress===undefined||!Number.isFinite(progress))return null;
 const value=Math.max(0,Math.min(100,progress));
 return <View accessibilityRole="progressbar" accessibilityLabel={t("Update download progress")} accessibilityValue={{min:0,max:100,now:value}} style={{height:6,backgroundColor:colors.highlight,borderRadius:3,overflow:'hidden'}}>
  <View style={{height:6,width:`${value}%`,backgroundColor:colors.primary,borderRadius:3}}/>
 </View>;
}
