import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {appUpdates} from '../../modules/maintenance';
import {useTheme} from '../../contexts/ThemeContext';
import {ThemedAlert as Alert} from '../ui/ThemedAlert';
export default function AppUpdateBanner(){
 const {colors}=useTheme(),[state,setState]=useState(appUpdates.snapshot);
 useEffect(()=>appUpdates.subscribe(()=>setState(appUpdates.snapshot())),[]);
 if(!['downloading','ready','installing'].includes(state.status))return null;
 const ready=state.status==='ready';
 const install=()=>Alert.alert('Install update?','Axonic will restart to finish installing the update.',[{text:'Later',style:'cancel'},{text:'Install',onPress:()=>void appUpdates.install().then(ok=>{if(!ok)Alert.alert('Update postponed','Finish any call, recording, or attachment transfer, then try again.');})}]);
 return <SafeAreaView edges={['top']} style={{backgroundColor:colors.surface}}><View style={{padding:12,borderBottomWidth:1,borderColor:colors.primary,gap:8}}>
 <View style={{flexDirection:'row',alignItems:'center',gap:12}}>{!ready&&<ActivityIndicator color={colors.primary}/>}<Text accessibilityLiveRegion="polite" style={{color:colors.text,flex:1}}>{ready?'Axonic update ready to install':state.status==='installing'?'Installing update…':state.progress===undefined?'Downloading Axonic update…':`Downloading Axonic update · ${state.progress}%`}</Text>{ready&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Install Axonic update" onPress={install} style={{paddingHorizontal:14,paddingVertical:10,borderRadius:18,backgroundColor:colors.primary}}><Text style={{color:colors.background,fontWeight:'700'}}>Install</Text></TouchableOpacity>}</View>
 {state.status==='downloading'&&state.progress!==undefined&&<View accessibilityRole="progressbar" accessibilityValue={{min:0,max:100,now:state.progress}} style={{height:4,backgroundColor:colors.highlight,borderRadius:2}}><View style={{height:4,width:`${state.progress}%`,backgroundColor:colors.primary,borderRadius:2}}/></View>}
 </View></SafeAreaView>;
}
