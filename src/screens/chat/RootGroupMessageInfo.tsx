import {MessageStatusTimes} from '../../components/chat/MessageStatusTimes';
import React,{useMemo} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {RootAccountRoutes} from '../../navigation/rootAccountRoutes';
import {useTheme} from '../../contexts/ThemeContext';
import {useChatSnapshot} from '../../modules/ui/useChatSnapshot';
import {useMessageStateClock} from '../../modules/ui/useMessageStateClock';
import {localAccount,shortIdentity} from '../../modules/identity';
import {groupMessageInfo,deliveryStatusIcon,deliveryStatusLabel} from '../../modules/messaging';
export default function RootGroupMessageInfo({route}:NativeStackScreenProps<RootAccountRoutes,'GroupMessageInfo'>){
 const {colors}=useTheme(),{state,error}=useChatSnapshot(),insets=useSafeAreaInsets(),owner=localAccount.status().account;
 const {group,messageId,author}=route.params;
 const tracked=useMemo(()=>state.messages.filter(m=>m.group?.id===group&&m.group.messageId===messageId&&(m.direction==='outgoing'?owner:m.peer)===author),[state.messages,group,messageId,author,owner]);
 const now=useMessageStateClock(tracked),info=owner?groupMessageInfo(state,owner,group,{id:messageId,author},now):null;
 const name=(peer:string)=>peer===owner?'You':state.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);
 return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:18,paddingBottom:insets.bottom+24,gap:18}}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
  {info?<><View style={{padding:16,borderRadius:16,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface,gap:12}}>
   <Text style={{color:colors.primary,fontWeight:'700'}}>{state.groups?.find(g=>g.id===group)?.name||'Group message'}</Text>
   <Text selectable style={{color:colors.text,fontSize:17}}>{info.message.deleted?'Message deleted':info.message.attachment?.caption||info.message.attachment?.name||info.message.text}</Text>
   <Text style={{color:colors.textSecondary}}>From: {name(author)}</Text>
   <Text style={{color:colors.textSecondary}}>Created: {new Date(info.at).toLocaleString()}</Text>
   {!!info.recipients.length&&<Text style={{color:colors.textSecondary}}>{info.pending} pending · {info.stored} stored on Axonic network · {info.delivered-info.read} delivered (not read) · {info.read} read</Text>}
  </View>
  {!info.recipients.length&&<View style={{gap:8}}><Text style={{color:colors.primary,fontSize:18,fontWeight:'700'}}>{deliveryStatusLabel(info.status)}</Text><Text style={{color:colors.textSecondary}}>{info.description}</Text><MessageStatusTimes message={info.message} now={now}/></View>}
  {!!info.recipients.length&&<Text accessibilityRole="header" style={{color:colors.text,fontWeight:'700'}}>Recipients</Text>}
  {info.recipients.map(r=><View key={r.peer} style={{padding:16,borderRadius:16,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface,flexDirection:'row',alignItems:'center',gap:12}}>
   <View style={{flex:1}}><Text style={{color:colors.text,fontWeight:'600'}}>{name(r.peer)}</Text><Text style={{color:colors.textSecondary,marginTop:4}}>{deliveryStatusLabel(r.status)}</Text><Text style={{color:colors.textSecondary,marginTop:4}}>{r.description}</Text><MessageStatusTimes message={r.message} now={now}/></View>
   <Ionicons accessibilityLabel={deliveryStatusLabel(r.status)} name={deliveryStatusIcon(r.status)} size={22} color={r.status==='read'?colors.checkBlue:colors.textSecondary}/>
  </View>)}</>:<Text style={{color:colors.textSecondary}}>Message information is unavailable on this device.</Text>}
 </ScrollView>;
}
