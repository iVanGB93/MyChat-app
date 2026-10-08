import {attachmentDigest} from '../services/identity/attachmentProtocol';
import {useTheme} from '../contexts/ThemeContext';
import React,{useEffect,useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import Native from '../../modules/axonic-nearby';
import {localRootChat} from '../services/identity/localRootChat';
import {localAccountCalls,localAccountLookupIdentity} from '../services/identity/localAccountNetwork';
import {ensureRootCallPermissions} from '../screens/calls/RootAccountCallScreen';
import type {RootChatState} from '../services/identity/rootChatLedger';
import RootAttachmentBubble from './RootAttachmentBubble';
import {pickRootAttachment} from '../modules/ui/documentPicker';
import {rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../services/identity/rootAttachmentRuntime';
/** Identity-addressed local inbox; no numeric user, contact permission, or backend room. */
export default function LocalAccountChats(){
 const {colors}=useTheme();
 const [state,setState]=useState<RootChatState|null>(null),[peer,setPeer]=useState(''),[alias,setAlias]=useState(''),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [transfers,setTransfers]=useState<Awaited<ReturnType<typeof rootAttachmentProgress>>>({jobs:[],selections:[]});
 useEffect(()=>{let active=true;const refresh=()=>void rootAttachmentProgress().then(value=>{if(active)setTransfers(value);}).catch(()=>{});refresh();const timer=setInterval(refresh,1000);return()=>{active=false;clearInterval(timer);};},[]);
 useEffect(()=>{let alive=true;const refresh=()=>{void Promise.resolve().then(()=>localRootChat().snapshot()).then(s=>{if(alive)setState(s);}).catch(()=>{if(alive)setError('Unable to read chats. Your saved data was not replaced.');});};refresh();const timer=setInterval(refresh,1000);return()=>{alive=false;clearInterval(timer);};},[]);
 const contact=state?.contacts.find(c=>c.account===peer),messages=state?.messages.filter(m=>m.peer===peer)??[];
 const action=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await work();setState(await localRootChat().snapshot());}catch(e){setError(e instanceof Error?e.message:'Unable to update chat');}finally{setBusy(false);}};
 const button=(label:string,onPress:()=>void)=><Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={{padding:12,backgroundColor:colors.bubbleSent,borderRadius:12}}><Text style={{color:colors.text}}>{label}</Text></Pressable>;
 const input={color:colors.text,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12};
 return <View style={{gap:12}}><Text style={{color:colors.text,fontSize:21}}>Chats</Text>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
  {state?.contacts.map(c=><Pressable key={c.account} accessibilityRole="button" onPress={()=>{setPeer(c.account);setAlias(c.alias);setText('');}}><Text style={{color:colors.textSecondary,paddingVertical:8}}>{c.alias||c.account}{c.blocked?' · Blocked':!c.accepted?' · Message request':''}</Text></Pressable>)}
  <TextInput accessibilityLabel="Peer identity" placeholder="Paste an axonic:1: identity code" placeholderTextColor="#98a8b9" value={peer} onChangeText={v=>{setPeer(v.trim());setAlias('');}} autoCapitalize="none" autoCorrect={false} style={input}/>
  <TextInput accessibilityLabel="Local contact nickname" placeholder="Nickname (only on this device)" placeholderTextColor="#98a8b9" value={alias} onChangeText={setAlias} maxLength={80} style={input}/>
  {button('Save nickname',()=>void action(()=>localRootChat().configure(peer,{alias})))}
  {(['voice','video'] as const).map(kind=><View key={kind}>{button(kind==='voice'?'Voice call':'Video call',()=>void action(async()=>{
    await ensureRootCallPermissions(kind);
    const calls=localAccountCalls();if(!calls)throw Error('Unlock your account and wait for the network to connect.');
    const found=await localAccountLookupIdentity(peer);if(found.status!=='found')throw Error('This identity could not be verified. Check its code and connection.');
    if(calls!==localAccountCalls())throw Error('The account was locked. Try again after unlocking.');
    await calls.start(peer,kind);
  }))}</View>)}
  {!!contact&&!contact.accepted&&!contact.blocked&&button('Accept message request',()=>void action(()=>localRootChat().configure(peer,{accepted:true})))}
  {!!contact&&button(contact.blocked?'Unblock':'Block',()=>void action(()=>localRootChat().configure(peer,{blocked:!contact.blocked})))}
  {messages.slice(-100).map(m=><View key={m.direction+':'+m.id} style={{padding:12,borderRadius:12,backgroundColor:m.direction==='outgoing'?colors.bubbleSent:colors.bubbleReceived}}>{m.attachment?<RootAttachmentBubble message={m} progress={transfers.jobs.find(j=>j.digest===attachmentDigest(m.attachment!.manifest))} onError={setError}/>:<Text selectable style={{color:colors.text}}>{m.text}</Text>}<Text style={{color:colors.textSecondary,fontSize:12}}>{!m.attachment?(m.direction==='outgoing'?m.status:'Received')+' · ':''}{new Date(m.at).toLocaleTimeString()}</Text></View>)}
  {transfers.selections.filter(s=>s.peer===peer).map(s=><View key={s.id}><Text style={{color:colors.textSecondary}}>{s.name} · {s.failed?'Could not prepare attachment':'Preparing attachment'}</Text>{s.failed&&button('Retry attachment',()=>void retryRootAttachmentSelection(s.id))}{s.failed&&button('Remove selection',()=>void removeRootAttachmentSelection(s.id))}</View>)}
  <TextInput accessibilityLabel="New message" placeholder="Write a message" placeholderTextColor="#98a8b9" value={text} onChangeText={setText} multiline maxLength={1600} style={input}/>
  {button('Send message',()=>void action(async()=>{const id=await Native!.identityRandomBytes!(32);await localRootChat().enqueue(peer,id,text);setText('');}))}
  {button('Attach file',()=>void action(async()=>{const found=await localAccountLookupIdentity(peer);if(found.status!=='found')throw Error('This identity could not be verified. Check its code and connection.');await pickRootAttachment(peer);}))}
  <Text style={{color:colors.textSecondary}}>Pending messages stay on this device and can use encrypted temporary custody on reachable neurons. Delivered means the recipient saved the message.</Text>
 </View>;
}

