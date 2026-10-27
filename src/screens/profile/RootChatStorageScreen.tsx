import {subscribeOwnChatWrites} from '../../modules/storage';
import {subscribeAttachmentContentChanges} from '../../modules/media';
const subscribeStorageChanges=(fn:()=>void)=>{const a=subscribeOwnChatWrites(fn),b=subscribeAttachmentContentChanges(fn);return()=>{a();b();};};
import {useForegroundEvents} from '../../hooks/useForegroundEvents';
import {useIsFocused} from '@react-navigation/native';
import React,{useState} from 'react';
import {ScrollView,Text,Pressable,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useTheme} from '../../contexts/ThemeContext';
import {conversations} from '../../modules/messaging';
import {localAccount} from '../../modules/identity';
import {rootChatView} from '../../modules/messaging';
import type {RootChatState} from '../../modules/messaging';
import type {RootAccountRoutes} from '../../navigation/rootAccountRoutes';
import {shortIdentity} from '../../modules/identity';
import {removeRootDownloadedMedia,rootAttachmentFile} from '../../modules/storage';
import {attachmentDigest} from '../../modules/media';
import RootAttachmentBubble from '../../components/RootAttachmentBubble';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import {chatStorageStyles as styles} from './chat-storage-styles';
const bytes=(n:number)=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';
export default function RootChatStorageScreen({route,navigation}:NativeStackScreenProps<RootAccountRoutes,'ChatStorage'>){
 const focused=useIsFocused();
 const {colors}=useTheme(),owner=localAccount.status().account,[state,setState]=useState<RootChatState>({version:1,contacts:[],messages:[]}),[error,setError]=useState(''),[storedSizes,setStoredSizes]=useState<Record<string,number>>({});
 useForegroundEvents(async current=>{try{const snapshot=await conversations().snapshot();if(current()&&localAccount.status().account===owner){const next=rootChatView(owner!,snapshot),sizes:Record<string,number>={};for(const message of next.messages){if(!message.attachment||message.deleted)continue;const digest=attachmentDigest(message.attachment.manifest);if(digest in sizes)continue;try{const file=rootAttachmentFile(owner!,digest);sizes[digest]=file.exists?file.size:0;}catch{sizes[digest]=0;}}setStoredSizes(old=>JSON.stringify(old)===JSON.stringify(sizes)?old:sizes);setState(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setError('');}}catch{if(current())setError('Could not read chat storage');}},subscribeStorageChanges,focused);

 const peer=route.params?.peer,group=route.params?.group;
 const messages=state.messages.filter(m=>group?m.group?.id===group:peer?!m.group&&m.peer===peer:true);
 const files=messages.filter(m=>m.attachment&&!m.deleted),unique=new Map<string,typeof files[number]>();
 for(const m of files)unique.set(attachmentDigest(m.attachment!.manifest),m);
 const rows=[...unique.values()],sizes=new Map(Object.entries(storedSizes));
 const total=rows.reduce((sum,message)=>sum+(sizes.get(attachmentDigest(message.attachment!.manifest))??0),0);

 const filtered=!!peer||!!group;
 return <ScrollView style={[styles.container,{backgroundColor:colors.background}]} contentContainerStyle={styles.content}>
  <View style={[styles.totalCard,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><Text style={[styles.title,{color:colors.primary}]}>DEVICE CHAT STORAGE</Text><Text style={[styles.hint,{color:colors.textSecondary}]}>Your messages and media on this device</Text><View style={[styles.total,{backgroundColor:colors.highlight,borderColor:colors.primary}]}><Text style={[styles.totalValue,{color:colors.primary}]}>{bytes(total)}</Text><Text style={[styles.totalLabel,{color:colors.textSecondary}]}>DOWNLOADED MEDIA</Text><Text style={[styles.detail,{color:colors.textTertiary}]}>{messages.length} messages · {rows.length} attachments</Text></View></View>
  {!!error&&<Text accessibilityRole="alert" style={[styles.error,{color:colors.error}]}>{error}</Text>}
  {!filtered?<><Text style={[styles.sectionTitle,{color:colors.primary}]}>CONVERSATIONS</Text><View style={[styles.list,{borderColor:colors.neonBorder}]}>{[...state.contacts.map(c=>({key:c.account,name:c.alias||shortIdentity(c.account),peer:c.account,group:undefined as string|undefined})),...(state.groups??[]).map(g=>({key:g.id,name:g.name,peer:undefined as string|undefined,group:g.id}))].map(c=><Pressable key={c.key} style={({pressed})=>[styles.room,pressed&&{opacity:0.7}]} onPress={()=>navigation.push('ChatStorage',{peer:c.peer,group:c.group})}><View style={styles.roomInfo}><Text numberOfLines={1} style={[styles.roomName,{color:colors.text}]}>{c.name}</Text><Text style={[styles.roomMeta,{color:colors.textSecondary}]}>{state.messages.filter(m=>c.group?m.group?.id===c.group:!m.group&&m.peer===c.peer).length} messages · {bytes(rows.filter(m=>c.group?m.group?.id===c.group:!m.group&&m.peer===c.peer).reduce((sum,m)=>sum+(sizes.get(attachmentDigest(m.attachment!.manifest))??0),0))} media</Text></View><Ionicons name="chevron-forward" size={22} color={colors.primary}/></Pressable>)}</View></>:<><Text style={[styles.sectionTitle,{color:colors.primary}]}>MEDIA & FILES</Text>{!rows.length&&<Text style={[styles.empty,{color:colors.textSecondary}]}>No attachments in this conversation.</Text>}{rows.map(m=><View key={attachmentDigest(m.attachment!.manifest)} style={[styles.totalCard,{backgroundColor:colors.surface,borderColor:colors.neonBorder,marginBottom:12}]}><RootAttachmentBubble message={m} showSize onError={message=>Alert.alert('Attachment',message)}/>{m.status==='delivered'&&<Pressable accessibilityLabel="Remove downloaded copy" style={({pressed})=>({marginTop:12,opacity:pressed?0.7:1})} onPress={()=>Alert.alert('Remove downloaded copy?','This removes the media file from this device. The message and other people’s copies remain.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{void removeRootDownloadedMedia(owner!,attachmentDigest(m.attachment!.manifest)).then(()=>setState({...state})).catch(()=>Alert.alert('Storage','Could not remove this downloaded copy.'));}}])}><Text style={{color:colors.error}}>Remove downloaded copy</Text></Pressable>}</View>)}</>}
  <Text style={[styles.footnote,{color:colors.textSecondary}]}>This counts chat media; saved Gallery and Downloads copies use additional device storage. Identity keys, delivery records, and temporary network traffic are managed separately.</Text>
 </ScrollView>;
}
