import TrialCreditsBadge from '../components/TrialCreditsBadge';
import StatusBarFade from '../components/ui/StatusBarFade';
import {Chrome} from '../theme';
import ChatConnectionBar from '../components/chat/ChatConnectionBar';
import React from 'react';
import {View} from 'react-native';
import {Header,getHeaderTitle} from '@react-navigation/elements';
import type {NativeStackHeaderProps} from '@react-navigation/native-stack';
import type {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';

function Surface({children,overlay=false,connectionPeer}:{children:React.ReactNode;overlay?:boolean;connectionPeer?:string}){
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 return <View pointerEvents="box-none" style={{backgroundColor:overlay?'transparent':colors.background,paddingTop:insets.top+6,paddingBottom:8,paddingLeft:insets.left+Chrome.gutter,paddingRight:insets.right+Chrome.gutter}}>
  <StatusBarFade/>
  <View style={{backgroundColor:colors.headerBg,borderRadius:Chrome.panelRadius,borderWidth:1,borderColor:colors.neonBorder,shadowColor:colors.primary,shadowOpacity:Chrome.shadowOpacity,shadowRadius:10,shadowOffset:{width:0,height:3},elevation:3}}>
   <View style={{borderRadius:Chrome.panelRadius,overflow:'hidden'}}>{children}</View>
   {connectionPeer&&<ChatConnectionBar peer={connectionPeer} edge/>}
  </View>
 </View>;
}
export function FloatingTabHeader({options,route}:BottomTabHeaderProps){
 return <Surface overlay={options.headerTransparent}><Header {...options} headerRight={route.name==='Chats'?()=> <TrialCreditsBadge/>:options.headerRight} title={getHeaderTitle(options,route.name)} headerStatusBarHeight={0} headerShadowVisible={false} headerStyle={{backgroundColor:'transparent',height:56}}/></Surface>;
}
export function FloatingStackHeader({options,route,back}:NativeStackHeaderProps){
 const peer=route.name==='ChatRoom'?(route.params as {peer?:string}|undefined)?.peer:undefined;
 return <Surface overlay={options.headerTransparent} connectionPeer={peer}><Header title={getHeaderTitle(options,route.name)}
  headerTitle={options.headerTitle} headerTitleAlign={options.headerTitleAlign}
  headerTitleStyle={options.headerTitleStyle} headerTintColor={options.headerTintColor}
  back={back?{title:back.title,href:undefined}:undefined}
  headerLeft={options.headerLeft?()=>options.headerLeft?.({tintColor:options.headerTintColor,canGoBack:!!back}):undefined}
  headerRight={options.headerRight?()=>options.headerRight?.({tintColor:options.headerTintColor,canGoBack:!!back}):undefined}
  headerBackButtonDisplayMode="minimal" headerStatusBarHeight={0} headerShadowVisible={false}
  headerStyle={{backgroundColor:'transparent',height:56}}
 /></Surface>;
}
