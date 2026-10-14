import React,{useEffect,useState,useSyncExternalStore} from 'react';
import {View,Text,Pressable} from 'react-native';
import {useTheme} from '../contexts/ThemeContext';
import {recoverySettings,defaultRecoverySettings,subscribeRecoverySettings,loadRecoverySettings,saveRecoverySettings} from '../modules/network';
export default function RecoverySettings(){
 const {colors}=useTheme(),value=useSyncExternalStore(subscribeRecoverySettings,recoverySettings);
 const [busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let live=true;loadRecoverySettings().catch(()=>{if(live)setError('Could not load recovery settings.');}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[]);
 async function change(next:typeof value){setBusy(true);setError('');try{await saveRecoverySettings(next);}catch{setError('Could not save recovery settings.');}finally{setBusy(false);}}
 return <View style={{gap:12,marginBottom:24}}>
  <Text accessibilityRole="header" style={{color:colors.text,fontSize:20,fontWeight:'700'}}>Message recovery</Text>
  <Text style={{color:colors.textSecondary}}>Changes apply immediately on this device. Recovery waits for available capacity; messages stay queued. Defaults are recommended.</Text>
  {([{key:'pollsPerMinute',label:'Recovery checks per peer / minute',min:30,max:90,step:15},{key:'custodyFramesPerMinute',label:'Recovery traffic limit per peer / minute',min:512,max:2048,step:256}] as const).map(item=><View key={item.key} style={{gap:8}}>
   <Text style={{color:colors.text}}>{item.label}: {value[item.key]}</Text>
   <View style={{flexDirection:'row',gap:16}}>{[-1,1].map(direction=>{const n=value[item.key]+direction*item.step,disabled=busy||n<item.min||n>item.max;return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={(direction<0?'Decrease ':'Increase ')+item.label} disabled={disabled} onPress={()=>void change({...value,[item.key]:n})} style={{padding:14,backgroundColor:colors.card,opacity:disabled?0.4:1}}><Text style={{color:colors.text,fontSize:22}}>{direction<0?'−':'+'}</Text></Pressable>;})}</View>
  </View>)}
  <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void change({...defaultRecoverySettings})} style={{padding:14,backgroundColor:colors.card}}><Text style={{color:colors.text}}>Restore recovery defaults</Text></Pressable>
  <Text style={{color:colors.textSecondary}}>Restoring defaults does not erase messages or reset traffic counters. This setting cannot change another peer’s limits.</Text>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
 </View>;
}
