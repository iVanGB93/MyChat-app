import {appLanguage} from '../../localization/language';
import React from 'react';
import {Text,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {startsMessageDay} from '../../utils/message-day';

/** Placed above the oldest visible item of a day in the inverted timeline. */
export default function ChatDateSeparator({at,olderAt}:{at:number;olderAt?:number}){
 const {colors}=useTheme();
 if(!startsMessageDay(at,olderAt))return null;
 const label=new Date(at).toLocaleDateString(appLanguage(),{weekday:'short',month:'short',day:'numeric',year:'numeric'});
 return <View style={{alignItems:'center',marginVertical:12}}><Text accessibilityRole="header" style={{color:colors.textSecondary,backgroundColor:colors.surface,borderColor:colors.neonBorder,borderWidth:1,borderRadius:12,paddingHorizontal:12,paddingVertical:5,fontSize:12}}>{label}</Text></View>;
}
