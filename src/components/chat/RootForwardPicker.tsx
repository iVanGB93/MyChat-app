import {t} from '../../localization/language';
import {localAccount,shortIdentity} from '../../modules/identity';
import {chatMediaPresentation} from '../../modules/storage';
import React,{useRef,useState} from 'react';
import {Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import ConversationRecipientPicker from './ConversationRecipientPicker';
import {useTheme} from '../../contexts/ThemeContext';
import type {RootChatContact,RootChatMessage} from '../../modules/messaging';
import {forwardRootMessage} from '../../modules/messaging';

export default function RootForwardPicker({message,contacts,groups=[],onClose}:{message:RootChatMessage;contacts:RootChatContact[];groups?:{id:string;name:string;accepted:boolean;blocked:boolean}[];onClose():void}){
 const {colors}=useTheme(),sending=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('');
 const source=message.group?'group:'+message.group.id:message.peer;
 const media=chatMediaPresentation(message,localAccount.status().account);
 const available=[...contacts.filter(c=>!c.blocked).map(c=>({id:c.account,name:c.alias||shortIdentity(c.account)})),...groups.filter(g=>g.accepted&&!g.blocked).map(g=>({id:'group:'+g.id,name:g.name,group:true}))].filter(choice=>choice.id!==source);
 async function send(peer:string){if(sending.current||!available.some(choice=>choice.id===peer))return;sending.current=true;setBusy(true);setError('');
  try{await forwardRootMessage(message,peer);onClose();}catch(e){setError(e instanceof Error?e.message:t("Unable to forward this message"));}finally{sending.current=false;setBusy(false);}}
 const preview=<View style={{flexDirection:'row',alignItems:'center',gap:12}}><Ionicons name={media?media.mime.startsWith('image/')?'image-outline':media.mime.startsWith('video/')?'videocam-outline':media.mime.startsWith('audio/')?'musical-notes-outline':'document-outline':'chatbubble-outline'} size={28} color={colors.primary}/><View style={{flex:1,gap:4}}><Text style={{color:colors.primary,fontSize:12,fontWeight:'600'}}>{t("FORWARDING")}</Text><Text numberOfLines={2} style={{color:colors.text,fontSize:14}}>{media?.caption||media?.name||message.text}</Text></View></View>;
 return <ConversationRecipientPicker title={t("Forward message")} choices={available} selected={selected} busy={busy} error={error} preview={preview}
  description={t("Choose a conversation to send a copy of this message.")} submitLabel="Forward" onSelect={setSelected} onSubmit={()=>{if(selected)void send(selected);}} onClose={()=>{if(!sending.current)onClose();}}/>;
}
