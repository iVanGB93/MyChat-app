import {shortIdentity} from '../../modules/identity';
import React,{useRef,useState} from 'react';
import {Modal,Pressable,ScrollView,Text,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {chatRoomStyles as styles} from './chat-room-styles';
import type {RootChatContact,RootChatMessage} from '../../modules/messaging';
import {forwardRootMessage} from '../../modules/messaging';

export default function RootForwardPicker({message,contacts,onClose}:{message:RootChatMessage;contacts:RootChatContact[];onClose():void}){
 const {colors}=useTheme(),sending=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const available=contacts.filter(c=>!c.blocked);
 async function send(peer:string){if(sending.current)return;sending.current=true;setBusy(true);setError('');
  try{await forwardRootMessage(message,peer);onClose();}catch(e){setError(e instanceof Error?e.message:'Unable to forward this message');}finally{sending.current=false;setBusy(false);}}
 return <Modal transparent visible animationType="fade" onRequestClose={()=>{if(!sending.current)onClose();}}>
  <Pressable style={styles.modalBackdrop} onPress={()=>{if(!sending.current)onClose();}}>
   <Pressable accessibilityViewIsModal onPress={e=>e.stopPropagation()} style={[styles.forwardPanel,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}>
    <Text style={[styles.forwardTitle,{color:colors.text}]}>Forward to…</Text>
    <Text style={{color:colors.textSecondary,padding:12}}>{busy?'Forwarding…':'Choose a conversation to send a new copy.'}</Text>
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}
    <ScrollView style={{maxHeight:360}}>{available.map(c=><Pressable disabled={busy} key={c.account} accessibilityLabel={`Forward to ${c.alias||shortIdentity(c.account)}`} onPress={()=>void send(c.account)} style={styles.forwardRow}><Text numberOfLines={2} style={[styles.forwardRowText,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text></Pressable>)}</ScrollView>
    {!available.length&&<Text style={{color:colors.textSecondary,padding:12}}>Open a conversation with an identity code first.</Text>}
    <Pressable disabled={busy} accessibilityLabel="Cancel forwarding" onPress={onClose} style={{padding:16}}><Text style={{color:colors.primary}}>Cancel</Text></Pressable>
   </Pressable>
  </Pressable>
 </Modal>;
}
