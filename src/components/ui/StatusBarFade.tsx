import React from 'react';
import {View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import Svg,{Defs,LinearGradient,Stop,Rect} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';

/** Static scrim: protects system icons, then fades into the transparent header. */
export default function StatusBarFade(){
 const {colors}=useTheme(),{top}=useSafeAreaInsets();
 if(top<=0)return null;
 const height=top+24;
 return <><StatusBar style="light"/><View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{position:'absolute',top:0,left:0,right:0,height}}>
  <Svg width="100%" height="100%">
   <Defs><LinearGradient id="statusFade" x1="0" y1="0" x2="0" y2="1">
    <Stop offset="0" stopColor={colors.headerBg} stopOpacity={0.96}/>
    <Stop offset={Math.max(0,(top-8)/height)} stopColor={colors.headerBg} stopOpacity={0.88}/>
    <Stop offset="1" stopColor={colors.headerBg} stopOpacity={0}/>
   </LinearGradient></Defs>
   <Rect width="100%" height="100%" fill="url(#statusFade)"/>
  </Svg>
 </View></>;
}
