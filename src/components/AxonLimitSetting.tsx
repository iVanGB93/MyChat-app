import {t} from '../localization/language';
import {Chrome} from '../theme';
import {Ionicons} from '@expo/vector-icons';
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Modal,View,Text,Pressable} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';
import {allowedAxons,subscribeAllowedAxons,loadAllowedAxons,setAllowedAxons} from '../modules/network';

export default function AxonLimitSetting(){
 const {colors:c}=useTheme(),insets=useSafeAreaInsets(),value=useSyncExternalStore(subscribeAllowedAxons,allowedAxons);
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[open,setOpen]=useState(false),[draft,setDraft]=useState(value);
 const saving=useRef(false);
 useEffect(()=>{let active=true;loadAllowedAxons().catch(()=>{if(active)setError(t("Could not load your saved setting."));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
 const close=()=>{if(!saving.current)setOpen(false);};
 const save=async()=>{if(saving.current||busy)return;saving.current=true;setBusy(true);setError('');try{await setAllowedAxons(draft);setOpen(false);}catch{setError(t("Could not save. Please try again."));}finally{saving.current=false;setBusy(false);}};
 return <>
  <Pressable accessibilityRole="button" accessibilityLabel={t("Allow axons: {0}. Edit connection limit",{0:value})} disabled={busy} onPress={()=>{setDraft(value);setOpen(true);}} style={({pressed})=>({flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:10,minHeight:52,borderRadius:Chrome.controlRadius,borderWidth:1,borderColor:c.neonBorder,backgroundColor:c.card,marginBottom:16,opacity:busy?.45:pressed?.7:1})}>
   <Text style={{flex:1,color:c.text,fontSize:16}}>{t("Allow axons")}</Text><Text style={{color:c.primary,fontSize:22,fontWeight:'700'}}>{value}</Text><Ionicons name="chevron-forward" size={18} color={c.textSecondary}/>
  </Pressable>
  {!!error&&!open&&<Text accessibilityRole="alert" style={{color:c.error,marginBottom:12}}>{error}</Text>}
  <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
   <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0008',padding:12,paddingBottom:Math.max(insets.bottom,12)}}>
    <Pressable accessibilityLabel={t("Cancel editing axon limit")} accessibilityRole="button" onPress={close} style={{position:'absolute',top:0,left:0,right:0,bottom:0}}/>
    <View accessibilityViewIsModal style={{padding:20,borderRadius:Chrome.panelRadius,borderWidth:1,borderColor:c.neonBorder,backgroundColor:c.card,gap:16}}>
     <Text accessibilityRole="header" style={{color:c.text,fontSize:20,fontWeight:'700'}}>{t("Allow axons")}</Text>
     <Text style={{color:c.textSecondary}}>{t("Maximum connections to other neurons. Default: 5.")}</Text>
     <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{Array.from({length:8},(_,i)=>i+3).map(n=><Pressable key={n} accessibilityRole="radio" accessibilityLabel={`${n} axons`} accessibilityState={{checked:draft===n,disabled:busy}} disabled={busy} onPress={()=>setDraft(n)} style={{minWidth:52,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:Chrome.controlRadius,borderWidth:1,borderColor:draft===n?c.primary:c.neonBorder,backgroundColor:draft===n?c.primary:c.headerBg}}><Text style={{color:draft===n?c.textInverse:c.text,fontSize:20,fontWeight:'600'}}>{n}</Text></Pressable>)}</View>
     {!!error&&<Text accessibilityRole="alert" style={{color:c.error}}>{error}</Text>}
     <View style={{flexDirection:'row',gap:10}}><Pressable accessibilityRole="button" disabled={busy} onPress={close} style={{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:Chrome.controlRadius,backgroundColor:c.headerBg}}><Text style={{color:c.text}}>{t("Cancel")}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void save()} style={{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:Chrome.controlRadius,backgroundColor:c.primary,opacity:busy?.45:1}}><Text style={{color:c.textInverse,fontWeight:'700'}}>{busy?t("Saving…"):t("Save")}</Text></Pressable></View>
    </View>
   </View>
  </Modal>
 </>;
}
