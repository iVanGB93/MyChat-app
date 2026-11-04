import {t} from '../../localization/language';
import {Chrome} from '../../theme';

import React,{useEffect,useState} from 'react';

import {ActivityIndicator,Text,TouchableOpacity,View} from 'react-native';

import {Ionicons} from '@expo/vector-icons';

import AppUpdateProgress from './AppUpdateProgress';

import {SafeAreaView} from 'react-native-safe-area-context';

import {appUpdates} from '../../modules/maintenance';

import {useTheme} from '../../contexts/ThemeContext';

import {ThemedAlert as Alert} from '../ui/ThemedAlert';

export default function AppUpdateBanner(){

 const {colors,isDark}=useTheme(),[state,setState]=useState(appUpdates.snapshot);

 useEffect(()=>{const refresh=()=>setState(appUpdates.snapshot());const unsubscribe=appUpdates.subscribe(refresh);refresh();return unsubscribe;},[]);

 if(!['downloading','ready','installing'].includes(state.status))return null;

 const ready=state.status==='ready';

 const install=()=>Alert.alert(t("Install update?"),t("Axonic will restart to finish installing the update."),[{text:'Later',style:'cancel'},{text:t("Install"),onPress:()=>void appUpdates.install().then(ok=>{if(!ok)Alert.alert(t("Update postponed"),t("Finish any call, recording, or attachment transfer, then try again."));})}]);

 return <SafeAreaView edges={['top','left','right']} style={{backgroundColor:'transparent'}}><View style={{padding:16,marginHorizontal:Chrome.gutter,marginVertical:8,borderRadius:Chrome.panelRadius,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:isDark?'rgba(7,20,40,0.94)':'rgba(255,255,255,0.94)',shadowColor:colors.primary,shadowOffset:{width:0,height:3},shadowOpacity:0.14,shadowRadius:10,elevation:3,gap:12}}>

 <View style={{flexDirection:'row',alignItems:'center',gap:12}}>

  <View style={{width:42,height:42,borderRadius:21,alignItems:'center',justifyContent:'center',backgroundColor:colors.highlight,borderWidth:1,borderColor:colors.neonBorder}}><Ionicons name={ready?'checkmark-circle-outline':state.status==='installing'?'sync-outline':'download-outline'} size={24} color={colors.primary}/></View>

  <View style={{flex:1,gap:4}}><Text style={{color:colors.text,fontWeight:'700',fontSize:16}}>{ready?t("Your update is ready"):state.status==='installing'?t("Installing Axonic"):t("Updating Axonic")}</Text><Text accessibilityLiveRegion="polite" style={{color:colors.textSecondary,fontSize:13}}>{ready?t("Install when you’re ready to restart."):state.status==='installing'?t("Finishing your update…"):state.progress===undefined?t("Downloading from Google Play…"):`Downloading · ${state.progress}%`}</Text></View>

  {!ready&&<ActivityIndicator color={colors.primary}/>}

 </View>

 {state.status==='downloading'&&<AppUpdateProgress progress={state.progress}/>}

 {ready&&<TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Install Axonic update")} onPress={install} style={{alignSelf:'flex-end',flexDirection:'row',alignItems:'center',gap:8,minHeight:44,paddingHorizontal:18,borderRadius:Chrome.controlRadius,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.highlight}}><Ionicons name="download-outline" size={19} color={colors.primary}/><Text style={{color:colors.primary,fontWeight:'700'}}>{t("Install update")}</Text></TouchableOpacity>}

 </View></SafeAreaView>;

}
