import {t} from '../localization/language';
import {Chrome} from '../theme';
import {subscribeRelayChanges} from '../modules/network';
import React,{useEffect,useState} from 'react';
import {Alert,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {useForegroundEvents} from '../hooks/useForegroundEvents';
import {localAccountRelayInventory,subscribeRelayInventoryAccess,localAccountWakeDiagnostics,resetLocalNetworkWork} from '../modules/network';
import {relayPacketDetails,relayCategories,relayPacketCategory,type RelayCategory,type RelayInventory} from '../modules/network';

export default function RelayInventoryPanel(){
 const {colors}=useTheme(),focused=useIsFocused();
 const [data,setData]=useState<RelayInventory|null>(null),[error,setError]=useState(''),[page,setPage]=useState(0),[expanded,setExpanded]=useState<string|null>(null);
 const [category,setCategory]=useState<RelayCategory>('content');
 const [resetting,setResetting]=useState(false);
 const confirmReset=()=>Alert.alert(t("Reset all local network work?"),
  t("This cancels pending sends, downloads, receipts and call signaling, and removes encrypted packets held for other users. Some messages or media may never arrive.\n\nChats, contacts, identity, saved media and call history stay on this phone. Nothing is deleted from other devices or AoNs; peers may send packets again.\n\nAxonic will close. Reopen it to apply the reset before networking starts. This cannot be undone."),
  [{text:t("Keep network work"),style:'cancel'},{text:t("Reset and close"),style:'destructive',onPress:()=>{setResetting(true);void resetLocalNetworkWork(true).catch(e=>Alert.alert(t("Network reset"),e instanceof Error?e.message:t("Reset could not be requested."))).finally(()=>setResetting(false));}}]);
 const [wake,setWake]=useState<ReturnType<typeof localAccountWakeDiagnostics>>(null),[showWake,setShowWake]=useState(false);
 useForegroundEvents(()=>setWake(localAccountWakeDiagnostics()),subscribeRelayChanges,focused);
 useEffect(()=>subscribeRelayInventoryAccess(()=>{setData(null);setWake(null);setExpanded(null);setPage(0);}),[]);
 useForegroundEvents(async current=>{try{const next=await localAccountRelayInventory();if(current()){setData(next);setError(next?'':t("Unlock your account to inspect relay storage."));}}catch{if(current()){setData(null);setError(t("Relay storage could not be read. No records were changed."));}}},subscribeRelayChanges,focused);
 const allRows=data?.rows??[],rows=allRows.filter(r=>relayPacketCategory(r,data?.observedAt??Date.now())===category),last=Math.max(0,Math.ceil(rows.length/50)-1),selected=Math.min(page,last),visible=rows.slice(selected*50,(selected+1)*50);
 const text={color:colors.textSecondary},button={padding:12,borderWidth:1,borderColor:colors.border,borderRadius:Chrome.controlRadius};
 return <View style={{marginTop:24,gap:12}}>
  <Text accessibilityRole="header" style={{color:colors.text,fontSize:20,fontWeight:'700'}}>{t("Relay storage for others")}</Text>
  <TouchableOpacity accessibilityRole="button" accessibilityState={{disabled:resetting||!data,busy:resetting}} disabled={resetting||!data} style={button} onPress={confirmReset}><Text style={{color:colors.error}}>{resetting?t("Preparing restart…"):t("Reset all local network work…")}</Text></TouchableOpacity>
  <Text style={text}>{t("Reset includes your own pending delivery work, not just the relay records below. Requires confirmation and an app restart. Your chat history and downloaded files are preserved.")}</Text>
  <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:showWake}} onPress={()=>setShowWake(!showWake)}><Text style={{color:colors.primary}}>{t("Wake work breakdown ·")}{showWake?'Hide':'Show'}</Text></TouchableOpacity>
  {showWake&&<><Text style={text}>{t("Private and group message wakes only. Local scheduler checks are not network requests. Gateway acceptance is not phone delivery. Counters cover this runtime; tracked items are current gauges.")}</Text><Text selectable style={text}>{wake?JSON.stringify(wake,null,2):t("No active wake scheduler.")}</Text></>}
  <Text style={text}>{t("Local relay storage only—not your own messages or a network-wide view. Metadata only; no content, keys or tokens. Refreshes every 10 seconds while visible.")}</Text>
  <Text style={text}>{t("Includes envelopes, receipts, group grants, media and the temporary call-control cache. Media chunks are grouped by content digest and counted once. Cleanup markers contain no payload. Identity caches and live audio/video streams are not stored message packets.")}</Text>
  {error?<Text accessibilityRole="alert" style={text}>{error}</Text>:!data?<Text style={text}>{t("Reading relay storage…")}</Text>:<>
   <Text style={text}>{allRows.length} {t("total storage records · Observed")}{' '}{new Date(data.observedAt).toLocaleTimeString()}</Text>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{relayCategories.map(c=><TouchableOpacity key={c.id} accessibilityRole="button" accessibilityState={{selected:category===c.id}} style={[button,{borderColor:category===c.id?colors.primary:colors.border}]} onPress={()=>{setCategory(c.id);setPage(0);setExpanded(null);}}><Text style={{color:category===c.id?colors.primary:colors.textSecondary}}>{c.label}: {allRows.filter(r=>relayPacketCategory(r,data.observedAt)===c.id).length}</Text></TouchableOpacity>)}</View>
   <Text style={text}>{relayCategories.find(c=>c.id===category)?.description}</Text>
   <Text style={text}>{t("Counts are storage records, not unique messages or network-wide pending events.")}</Text>
   {!rows.length&&<Text style={text}>{t("No records in this category.")}</Text>}
   {visible.map(r=><View key={r.key} style={{padding:12,borderWidth:1,borderColor:colors.border,borderRadius:Chrome.cardRadius,gap:6}}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:expanded===r.key}} onPress={()=>setExpanded(expanded===r.key?null:r.key)}>
     <Text style={{color:colors.text,fontWeight:'600'}}>{r.kind}</Text><Text style={text}>{r.state} · {r.storage==='disk'?t("Persistent storage"):t("Temporary memory")}</Text>
     <Text style={text}>{r.id.slice(0,12)}… · {expanded===r.key?'Hide':'Show'} {t("metadata")}</Text>
    </TouchableOpacity>
    {expanded===r.key&&relayPacketDetails(r).map(v=><View key={v.label}><Text style={text}>{v.label}</Text><Text selectable style={{color:colors.text}}>{v.value}</Text></View>)}
   </View>)}
   {rows.length>50&&<View style={{flexDirection:'row',alignItems:'center',gap:12}}><TouchableOpacity accessibilityRole="button" disabled={!selected} style={button} onPress={()=>setPage(selected-1)}><Text style={text}>{t("Previous")}</Text></TouchableOpacity><Text style={text}>{selected+1} / {last+1}</Text><TouchableOpacity accessibilityRole="button" disabled={selected===last} style={button} onPress={()=>setPage(selected+1)}><Text style={text}>{t("Next")}</Text></TouchableOpacity></View>}
  </>}
 </View>;
}


