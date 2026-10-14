import {shortIdentity} from '../../modules/identity';
import React,{useRef,useState} from 'react';
import {Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import ConversationRecipientPicker from './ConversationRecipientPicker';
import {useTheme} from '../../contexts/ThemeContext';
import type {RootChatContact,RootChatMessage} from '../../modules/messaging';
import {forwardRootMessage} from '../../modules/messaging';

export default function RootForwardPicker({message,contacts,groups=[],onClose}:{message:RootChatMessage;contacts:RootChatContact[];groups?:{id:string;name:string;accepted:boolean;blocked:boolean}[];onClose():void}){
 const {colors}=useTheme(),sending=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('');
 const available=[...contacts.filter(c=>!c.blocked).map(c=>({id:c.account,name:c.alias||shortIdentity(c.account)})),...groups.filter(g=>g.accepted&&!g.blocked).map(g=>({id:'group:'+g.id,name:g.name,group:true}))];
 async function send(peer:string){if(sending.current)return;sending.current=true;setBusy(true);setError('');
  try{await forwardRootMessage(message,peer);onClose();}catch(e){setError(e instanceof Error?e.message:'Unable to forward this message');}finally{sending.current=false;setBusy(false);}}
 const preview=<View style={{flexDirection:'row',alignItems:'center',gap:12}}><Ionicons name={message.attachment?message.attachment.mime.startsWith('image/')?'image-outline':message.attachment.mime.startsWith('video/')?'videocam-outline':message.attachment.mime.startsWith('audio/')?'musical-notes-outline':'document-outline':'chatbubble-outline'} size={28} color={colors.primary}/><View style={{flex:1,gap:4}}><Text style={{color:colors.primary,fontSize:12,fontWeight:'600'}}>FORWARDING</Text><Text numberOfLines={2} style={{color:colors.text,fontSize:14}}>{message.attachment?.caption||message.attachment?.name||message.text}</Text></View></View>;
 return <ConversationRecipientPicker title="Forward message" choices={available} selected={selected} busy={busy} error={error} preview={preview}
  description="Choose a conversation to send a copy of this message." submitLabel="Forward" onSelect={setSelected} onSubmit={()=>{if(selected)void send(selected);}} onClose={()=>{if(!sending.current)onClose();}}/>;
}
