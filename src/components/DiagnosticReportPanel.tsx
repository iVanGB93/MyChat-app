import React,{useEffect,useRef,useState} from 'react';
import {Modal,ScrollView,Share,Text,View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';
import {localAccount} from '../modules/identity';
import {prepareDiagnosticReport,sendDiagnosticReport,clearDiagnosticLogs,REPORT_ISSUES,REPORT_WHEN,type DiagnosticDraft,type ReportIssue,type ReportWhen} from '../modules/diagnostics';
import Button from './ui/Button';
import ScreenHeader from './ui/ScreenHeader';
const issueLabels:Record<ReportIssue,string>={delivery:'Message delivery',notifications:'Notifications',slow_chats:'Slow chats',connections:'Connections',media:'Media transfer',general:'General report'};
const whenLabels:Record<ReportWhen,string>={now:'Happening now',last_5_minutes:'Last 5 minutes',last_30_minutes:'Last 30 minutes',earlier:'Earlier / not sure'};
export default function DiagnosticReportPanel(){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),navigation=useNavigation<any>();
 const [issue,setIssue]=useState<ReportIssue>('general'),[when,setWhen]=useState<ReportWhen>('now'),[draft,setDraft]=useState<DiagnosticDraft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState<{peer:string;name:string}|null>(null);
 const running=useRef(false),generation=useRef(0);
 const [reviewing,setReviewing]=useState(false),[cleared,setCleared]=useState(false);
 const bytes=draft?new TextEncoder().encode(draft.json).length:0;
 useEffect(()=>{const off=localAccount.subscribe(()=>{generation.current++;setDraft(null);setSent(null);setError('');setReviewing(false);setCleared(false);});return()=>{generation.current++;off();};},[]);
 async function preview(){if(running.current)return;running.current=true;setBusy(true);setError('');const epoch=generation.current;try{const value=await prepareDiagnosticReport(issue,when);if(epoch===generation.current)setDraft(value);}catch{if(epoch===generation.current)setError('Could not prepare the report. Unlock your account and try again; no report was sent.');}finally{running.current=false;setBusy(false);}}
 async function send(){if(!draft||running.current)return;running.current=true;setBusy(true);setError('');const selected=draft,epoch=generation.current;try{await sendDiagnosticReport(selected);if(epoch===generation.current){setDraft(null);setSent({peer:selected.recipient.account,name:selected.recipient.name});}}catch{if(epoch===generation.current)setError('Could not confirm the report was queued. Retry this same preview to avoid duplicates, or check the chat. A blocked neuron or full attachment queue may need attention.');}finally{running.current=false;setBusy(false);}}
 const secondary={color:colors.textSecondary};
 return <View style={{marginTop:20,gap:10}}><Text accessibilityRole="header" style={{color:colors.text,fontSize:19,fontWeight:'700'}}>Delivery diagnostics</Text>
  <Text style={secondary}>Send a redacted snapshot to a configured AoN through encrypted private chat. It is linked to your Axon ID. Nothing is uploaded until you review and confirm.</Text>
  <Text style={secondary}>Diagnostics are recorded automatically while unlocked and the app can run: the latest 30 minutes, up to 128 general events and 256 delivery events. Memory only; cleared on lock, account change or restart. No message content, contacts, credentials or raw logs. No extra background wake-ups are scheduled.</Text>
  <Button title="Review / share diagnostics" variant="outline" disabled={busy} onPress={()=>{setReviewing(true);setCleared(false);}}/>
  <Button title="Clear diagnostics" variant="outline" disabled={busy} onPress={()=>{generation.current++;clearDiagnosticLogs();setDraft(null);setError('');setCleared(true);}}/>
  {cleared&&<Text style={secondary}>Diagnostic event logs cleared. Automatic recording continues. Messages, queued reports and live network/media counters are unchanged.</Text>}
  <Text style={secondary}>The exact diagnostic file size is shown in the preview before you send or share.</Text>
  <Modal visible={reviewing&&!draft} animationType="slide" onRequestClose={()=>{if(!busy)setReviewing(false);}}><View style={{flex:1,backgroundColor:colors.background}}><ScreenHeader title="Review / share diagnostics" onBack={()=>{if(!busy)setReviewing(false);}}/><ScrollView contentContainerStyle={{padding:18,gap:12,paddingBottom:insets.bottom+24}}>
  <Text style={{color:colors.text}}>What went wrong?</Text><View style={{gap:6}}>{REPORT_ISSUES.map(value=><Button key={value} title={(value===issue?'✓ ':'')+issueLabels[value]} variant="outline" disabled={busy} onPress={()=>setIssue(value)}/>)}</View>
  <Text style={{color:colors.text}}>When?</Text><View style={{gap:6}}>{REPORT_WHEN.map(value=><Button key={value} title={(value===when?'✓ ':'')+whenLabels[value]} variant="outline" disabled={busy} onPress={()=>setWhen(value)}/>)}</View>
  <Button title="REVIEW DIAGNOSTIC REPORT" loading={busy&&!draft} disabled={busy} onPress={()=>void preview()}/>
  {!!error&&!draft&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
  </ScrollView></View></Modal>
  {!!sent&&<><Text style={secondary}>Queued for {sent.name}, not confirmed delivered. Existing private-chat delivery and retry rules apply. Add details or check delivery in that conversation. No automatic follow-up reports.</Text><Button title="OPEN REPORT CHAT" variant="outline" onPress={()=>navigation.navigate('ChatRoom',{peer:sent.peer})}/></>}
  <Modal visible={!!draft} animationType="slide" onRequestClose={()=>{if(!busy)setDraft(null);}}><View style={{flex:1,backgroundColor:colors.background}}><ScreenHeader title="Review diagnostic report" onBack={()=>{if(!busy)setDraft(null);}}/><ScrollView testID="diagnostic-report-text" style={{flex:1,minHeight:0}} contentContainerStyle={{padding:18,gap:12}}>
   <Text style={{color:colors.text,fontWeight:'700'}}>To: {draft?.recipient.name}</Text><Text selectable style={secondary}>{draft?.recipient.account}</Text><Text style={secondary}>{draft?.recipient.selectionBasis}. This recipient stays fixed across retries.</Text>
   <Text style={secondary}>The receiver can identify your account and keep this report in its chat history. This is a one-time snapshot, not access to your other chats. A configured AoN may need to accept your conversation before downloading the file.</Text>
   <Text style={{color:colors.text,fontWeight:'700'}}>Diagnostic file: {(bytes/1024).toFixed(1)} KiB ({bytes.toLocaleString()} bytes)</Text>
   <Text style={secondary}>The JSON below is the exact attachment. File size excludes the chat summary, encryption and transport overhead. Preview expires after 24 hours; queued files use normal attachment expiry and delivery rules.</Text>
   <Text style={secondary}>Sharing with another app exports this JSON as text through the phone's share menu, outside Axonic's encrypted private chat.</Text>
   <Text selectable style={{color:colors.text,fontSize:12}}>{draft?.summary}</Text><Text selectable style={{color:colors.text,fontSize:11}}>{draft?.json}</Text>
  </ScrollView><View testID="diagnostic-report-actions" style={{flexShrink:0,paddingHorizontal:18,paddingTop:12,paddingBottom:Math.max(insets.bottom,12),gap:8,borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.background}}>
   {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
   <Button title="CONFIRM & SEND TO THIS AON" loading={busy} disabled={busy} onPress={()=>{setReviewing(false);void send();}}/>
   <Button title="SHARE WITH ANOTHER APP" variant="outline" disabled={busy} onPress={()=>void Share.share({message:draft?.json??'',title:'Axonic diagnostic report'}).catch(()=>setError('Sharing was unavailable.'))}/>
   <Button title="CANCEL — DON'T SEND" variant="outline" disabled={busy} onPress={()=>{setReviewing(false);setDraft(null);setError('');}}/>
  </View></View></Modal>
 </View>;
}
