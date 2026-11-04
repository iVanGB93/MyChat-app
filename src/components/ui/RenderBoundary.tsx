import {t} from '../../localization/language';
import React from 'react';
import {View,Text,Pressable} from 'react-native';
import {reportRenderFailure} from '../../services/crashReporting';

/** Never display exception text: it can contain private application data. */
export default class RenderBoundary extends React.Component<{children:React.ReactNode;scope:'app'|'screens'|'calls'}, {failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){reportRenderFailure(error,this.props.scope);}
 render(){
  if(!this.state.failed)return this.props.children;
  return <View accessibilityRole="alert" style={{flex:1,backgroundColor:'#020d1b',padding:28,alignItems:'center',justifyContent:'center',gap:16}}>
   <Text style={{color:'#00e5ff',fontSize:22,fontWeight:'600'}}>{t("Unable to display this screen")}</Text>
   <Text style={{color:'#c6d5e5',textAlign:'center'}}>{t("Your saved identity and chats have not been deleted. Try reopening the screen. If the problem continues, close and reopen Axonic.")}</Text>
   <Pressable accessibilityRole="button" accessibilityLabel={t("Try reopening screen")} onPress={()=>this.setState({failed:false})} style={{padding:16,borderRadius:22,backgroundColor:'#00e5ff'}}><Text style={{color:'#020d1b',fontWeight:'600'}}>{t("Try again")}</Text></Pressable>
  </View>;
 }
}
