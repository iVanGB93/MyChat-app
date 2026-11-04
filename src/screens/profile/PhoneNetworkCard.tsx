import {t,languageSnapshot} from '../../localization/language';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {phoneNetworkInfo,type PhoneNetworkInfo} from '../../modules/network';
import {useTheme} from '../../contexts/ThemeContext';
import {Chrome} from '../../theme';

export default function PhoneNetworkCard(){
 const {colors:c}=useTheme(),[info,setInfo]=useState<PhoneNetworkInfo|null>(null),[loading,setLoading]=useState(true);
 const alive=useRef(false),running=useRef(false);
 const refresh=useCallback(async()=>{if(running.current)return;running.current=true;setLoading(true);const next=await phoneNetworkInfo();running.current=false;if(alive.current){setInfo(next);setLoading(false);}},[languageSnapshot()]);
 useEffect(()=>{alive.current=true;void refresh();const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>{alive.current=false;sub.remove();};},[refresh]);
 const rows: Array<[string,string]>=info?[
  ['Connection',info.transport],['Internet',!info.connected?'Offline':info.validated?t("Validated by Android"):t("Not validated by Android")],
  [t("Local IP / prefix"),info.addresses.join('\n')||t("Not available")],['Gateway',info.gateways.join('\n')||t("Not reported")],
  [t("DNS servers"),info.dns.join('\n')||t("Not reported")],['Interface',info.interfaceName||t("Not reported")],
  [t("MTU"),info.mtu&&info.mtu>0?`${info.mtu} bytes`:t("Not reported")],['Metered',info.connected?(info.metered?t("Yes"):t("No")):t("Not applicable")]
 ]:[];
 return <View style={{padding:18,borderWidth:1,borderRadius:Chrome.cardRadius,marginTop:18,gap:12,backgroundColor:c.card,borderColor:c.neonBorder}}>
  <View style={{flexDirection:'row',alignItems:'center'}}><Text accessibilityRole="header" style={{flex:1,color:c.text,fontSize:18,fontWeight:'700'}}>{t("Phone connection")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Refresh phone network information")} disabled={loading} onPress={()=>void refresh()} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:loading?.45:1}}><Ionicons name="refresh-outline" size={22} color={c.primary}/></Pressable></View>
  {loading?<Text style={{color:c.textSecondary}}>{t("Reading network information…")}</Text>:!info?<Text style={{color:c.textSecondary}}>{t("Network details are unavailable on this build.")}</Text>:rows.map(([label,value])=><View key={label} style={{gap:3}}><Text style={{color:c.textSecondary,fontSize:12}}>{label}</Text><Text selectable style={{color:c.text,fontSize:15}}>{value}</Text></View>)}
  <Text style={{color:c.textSecondary,fontSize:12}}>{t("Current Android connection. A VPN may show its virtual interface. These are local addresses, not your public internet IP. Refresh after switching networks.")}</Text>
 </View>;
}
