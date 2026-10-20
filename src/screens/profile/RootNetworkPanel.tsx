import {subscribeLocalNetworkChanges} from '../../modules/network';
import ConnectedAxons from './ConnectedAxons';
import DiagnosticReportPanel from '../../components/DiagnosticReportPanel';
import React,{useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {useForegroundEvents} from '../../hooks/useForegroundEvents';
import {Text,View,StyleSheet} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import AxonLimitSetting from '../../components/AxonLimitSetting';
import NetworkDiagnostics from '../../components/NetworkDiagnostics';
import {localAccountLookupIdentity,localAccountNetworkSnapshot,startLocalAccountNetwork,localAccountDirectorySnapshot} from '../../modules/network';
export default function RootNetworkPanel({snapshot,replicas}:{snapshot:ReturnType<ReturnType<typeof startLocalAccountNetwork>['snapshot']>|null;replicas:ReturnType<typeof localAccountDirectorySnapshot>}){
 const {colors}=useTheme(),connected=snapshot?.pool?.connections.filter(c=>c.state==='connected')??[],pending=snapshot?.pool?.connections.filter(c=>c.state==='authenticating').length??0,text={color:colors.textSecondary,fontSize:15,lineHeight:23};
return <View><AxonLimitSetting/><Text accessibilityRole="header" style={[styles.title,{color:colors.text}]}>Your neuron</Text><Text style={text}>Your app connects automatically to other neurons to help deliver messages.</Text><View style={[styles.card,{backgroundColor:colors.card,borderColor:colors.neonBorder}]}><Text accessibilityRole="header" style={[styles.heading,{color:colors.text}]}>{connected.length?'Connected':'Finding neurons…'}</Text><Text style={[styles.count,{color:colors.text}]}>{connected.length} active {connected.length===1?'axon':'axons'}</Text><Text style={text}>Nearby: {connected.filter(c=>c.route==='lan').length} · Private network: {connected.filter(c=>c.route==='private').length} · Internet: {connected.filter(c=>c.route==='internet').length}</Text><Text style={text}>Identity copies: {replicas?.confirmed??0}/3 confirmed on connected neurons</Text>{pending>0&&<Text style={text}>Connecting to {pending} neurons…</Text>}{!!snapshot?.error&&<Text style={text}>{snapshot.error}</Text>}<ConnectedAxons connections={connected}/></View><NetworkDiagnostics lookup={localAccountLookupIdentity}/><DiagnosticReportPanel/><Text style={[text,styles.explanation]}>Participation pauses while the app is locked. Incoming messages can wake this device when local unlock preferences allow it.</Text></View>;
}
const styles=StyleSheet.create({title:{fontSize:27,fontWeight:'700',marginBottom:8},heading:{fontSize:18,fontWeight:'700',marginBottom:10},count:{fontSize:25,fontWeight:'600',marginBottom:6},card:{padding:18,borderWidth:1,borderRadius:16,marginTop:18,gap:6},explanation:{marginTop:18}});

export function LiveNetworkPanel(){
 const focused=useIsFocused(),[snapshot,setSnapshot]=useState(localAccountNetworkSnapshot),[replicas,setReplicas]=useState(localAccountDirectorySnapshot);
 useForegroundEvents(()=>{const next=localAccountNetworkSnapshot(),copies=localAccountDirectorySnapshot();setSnapshot(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setReplicas(old=>JSON.stringify(old)===JSON.stringify(copies)?old:copies);},subscribeLocalNetworkChanges,focused);
 return <RootNetworkPanel snapshot={snapshot} replicas={replicas}/>;
}
