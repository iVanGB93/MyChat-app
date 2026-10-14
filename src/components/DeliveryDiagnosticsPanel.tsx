import ScreenHeader from './ui/ScreenHeader';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Button from './ui/Button';
import React,{useEffect,useState} from 'react';
import {AppState,Modal,ScrollView,Share,Text,View} from 'react-native';
import Constants from 'expo-constants';
import {mobileDeliveryDiagnostics,startDeliveryCapture,clearDeliveryCapture,conversations} from '../modules/messaging';
import {localAccount} from '../modules/identity';
import {getDiagnosticBuildInfo} from '../modules/maintenance';
import {useTheme} from '../contexts/ThemeContext';

export default function DeliveryDiagnosticsPanel(){
 const insets=useSafeAreaInsets();
 const {colors}=useTheme(),[active,setActive]=useState(mobileDeliveryDiagnostics.active()),[preview,setPreview]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let owner=localAccount.status().account;const unsubscribe=localAccount.subscribe(()=>{const status=localAccount.status();if(status.account!==owner||status.state!=='unlocked'){setPreview('');setError('');}owner=status.account;setActive(mobileDeliveryDiagnostics.active());});const timer=setInterval(()=>setActive(mobileDeliveryDiagnostics.active()),1000);return()=>{unsubscribe();clearInterval(timer);};},[]);
 const button=(label:string,onPress:()=>void)=><Button title={label} variant="outline" onPress={onPress}/>;
 async function start(){try{const owner=localAccount.status().account;if(!owner)return;const state=await conversations().snapshot();if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;startDeliveryCapture(owner,state);setActive(true);setError('');}catch{setError('Could not start diagnostics. Your messages were not changed.');}}
 async function review(){const owner=localAccount.status().account,native=await getDiagnosticBuildInfo();if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;const trace=mobileDeliveryDiagnostics.snapshot();setActive(trace.active);setPreview(JSON.stringify({
  ...trace,build:{installed:native?{applicationId:native.applicationId,versionName:native.versionName,versionCode:native.versionCode}:null,
   configured:{applicationId:Constants.expoConfig?.android?.package??null,version:Constants.expoConfig?.version??null,versionCode:Constants.expoConfig?.android?.versionCode??null},
   jsSourceSha256:Constants.expoConfig?.extra?.diagnosticsJsSourceSha256??null,development:__DEV__,note:'Installed metadata is unavailable on older native builds. Source hash covers JS/TS source and lockfile, not native binaries; development code can change after manifest generation.'},
  context:{appState:AppState.currentState,accountState:localAccount.status().state},
 },null,2));}
 return <View style={{marginTop:20,gap:8}}><Text style={{color:colors.text,fontSize:18,fontWeight:'700'}}>Delivery diagnostics</Text>
  <Text style={{color:colors.textSecondary}}>Optional 15-minute capture in memory only. Includes local delivery/wake observation times and temporary message aliases, not message contents, identities, or credentials. Nothing is uploaded automatically. Capture ends after 15 minutes or an app restart.</Text>
  {button(active?'Restart 15-minute capture':'Start 15-minute capture',()=>void start())}
  {button('Stop capture',()=>{mobileDeliveryDiagnostics.stop();setActive(false);})}
  {button('Review / share diagnostics',()=>void review().catch(()=>setError('Could not prepare diagnostics.')))}
  {button('Clear diagnostics',()=>{clearDeliveryCapture();setActive(false);setPreview('');})}
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
  <Modal visible={!!preview} onRequestClose={()=>setPreview('')} animationType="slide"><View style={{flex:1,backgroundColor:colors.background}}><ScreenHeader title="Delivery diagnostics" onBack={()=>setPreview('')}/><View style={{flex:1,padding:16,gap:12,paddingBottom:insets.bottom+16}}>
   <Text style={{color:colors.text}}>Review before sharing. Event times and delivery activity are included. Sharing is your choice.</Text>
   <ScrollView style={{flex:1}}><Text selectable style={{color:colors.text,fontSize:12}}>{preview}</Text></ScrollView>
   {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
   <Button title="SHARE REPORT" onPress={()=>void Share.share({message:preview,title:'Axonic delivery diagnostics'}).catch(()=>setError('Sharing was unavailable.'))}/>
  </View></View></Modal>
 </View>;
}
