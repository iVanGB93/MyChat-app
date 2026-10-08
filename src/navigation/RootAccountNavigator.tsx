import {pickRootAttachment} from '../modules/ui/documentPicker';

import RootMessageToast from '../components/chat/RootMessageToast';
import ReplySwipe from '../components/chat/ReplySwipe';
import RootChatStorageScreen from '../screens/profile/RootChatStorageScreen';
import {ThemedAlert as Alert} from '../components/ui/ThemedAlert';
import {Font,Spacing} from '../theme';
import dayjs from 'dayjs';
import SmartMessageText from '../components/SmartMessageText';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import ChatHeaderIdentity from '../components/chat/ChatHeaderIdentity';
import ChatAvatarActionModal from '../components/chat/chat-avatar-action-modal';
import OutgoingCallAppearance from '../screens/calls/OutgoingCallAppearance';
import {callHistoryStyles as callStyles} from '../screens/calls/call-history-styles';
import {contactListStyles as contactStyles} from '../screens/contacts/contact-list-styles';
import notifee,{EventType} from '@notifee/react-native';
import {handleRootNotificationAction} from '../modules/messaging/notifications';
import {setRootVisibleConversation,queueRootNotificationOpen,pendingRootNotificationOpen,finishRootNotificationOpen} from '../modules/messaging/notifications';
import {userInfoStyles as infoStyles} from '../screens/chat/user-info-styles';
import QRCode from 'react-native-qrcode-svg';
import RootIdentityScanner from '../components/RootIdentityScanner';
import { displayIdentity, shortIdentity, parseIdentityCode } from '../modules/identity';
import RootMessageMenu from '../components/chat/RootMessageMenu';
import {rootChatView,type RootActionKind} from '../modules/messaging';
import RootForwardPicker from '../components/chat/RootForwardPicker';
import {rootStickerDraft} from '../modules/messaging';
import StickerPicker from '../components/chat/sticker-picker';
import StickerArt from '../components/chat/sticker-art';
import StickerPreview from '../components/chat/sticker-preview';
import {stickerMessage,parseSticker,type Sticker} from '../services/stickers';
import {importedStickerUri,stickerFileMime,type ImportedSticker} from '../services/imported-stickers';
import {IMPORTED_STICKER_CONTENT} from '../services/sticker-file-format';
import RootVoiceComposer from '../components/chat/RootVoiceComposer';
import AttachmentMenu from '../components/chat/AttachmentMenu';
import {pickRootMedia} from '../modules/ui/mediaPicker';
import * as Clipboard from 'expo-clipboard';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AppState,BackHandler,FlatList,KeyboardAvoidingView,Platform,Pressable,ScrollView,Share,Text,TextInput,TouchableOpacity,View} from 'react-native';
import {NavigationContainer,DarkTheme,DefaultTheme,useIsFocused,createNavigationContainerRef} from '@react-navigation/native';
import {createNativeStackNavigator,type NativeStackScreenProps} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useHeaderHeight} from '@react-navigation/elements';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../contexts/ThemeContext';
import {useMainTabOptions} from './main-tab-options';
import ChatListRow from '../components/chat/ChatListRow';
import {chatListStyles as listStyles} from '../components/chat/chat-list-styles';
import {chatRoomStyles as roomStyles} from '../components/chat/chat-room-styles';
import {messageBubbleStyles as bubbleStyles} from '../components/chat/message-bubble-styles';
import Avatar from '../components/ui/Avatar';
import EmptyState from '../components/ui/EmptyState';
import RootAttachmentBubble from '../components/RootAttachmentBubble';
import {messaging,calling} from '../modules/messaging';
import {localAccount} from '../modules/identity';
import {conversations} from '../modules/messaging';
import type {RootChatState,RootChatMessage} from '../modules/messaging';
import {localAccountCalls} from '../modules/messaging';
import {ensureRootCallPermissions} from '../screens/calls/RootAccountCallScreen';
import {attachmentDigest} from '../modules/messaging';
import {queueRootAttachmentSource,rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../modules/messaging';
import {listOwnCallHistory,type OwnCallSummary} from '../modules/storage';
import {validAccountId} from '../modules/identity';
import {rootGroupMessages} from '../modules/messaging';
import {RootGroupCreate,RootGroupRoom,RootGroupInfo} from '../screens/chat/RootGroupScreens';
import type {RootAccountRoutes} from './rootAccountRoutes';

type Routes=RootAccountRoutes;
const Stack=createNativeStackNavigator<Routes>(),Tabs=createBottomTabNavigator();
type Screen<P extends keyof Routes>=NativeStackScreenProps<Routes,P>;
const report=(error:unknown)=>Alert.alert('Axonic',error instanceof Error?error.message:typeof error==='string'?error:'Please try again');
const ignore=()=>{};
function useOwnChat(){
 const [state,setState]=useState<RootChatState>({version:1,contacts:[],messages:[]}),[error,setError]=useState('');
 useEffect(()=>{let active=true,running=false;const refresh=async()=>{if(running)return;running=true;try{const value=await conversations().snapshot();if(active){setState(rootChatView(localAccount.status().account!,value));setError('');}}catch{if(active)setError('Unable to read chats. Your saved data was not replaced.');}finally{running=false;}};void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer);};},[]);
 return {state,error};
}
function nickname(state:RootChatState,peer:string){return state.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);}
const startCall=(peer:string,kind:'voice'|'video')=>calling.start(peer,kind,()=>ensureRootCallPermissions(kind));
function ChatList({navigation}:Screen<'Tabs'>){
 const {colors}=useTheme(),{state,error}=useOwnChat(),[avatarPeer,setAvatarPeer]=useState<string|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());
 const toggle=(peer:string)=>setSelected(old=>{const next=new Set(old);next.has(peer)?next.delete(peer):next.add(peer);return next;});
 useEffect(()=>{if(!selected.size)return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setSelected(new Set());return true;});return()=>listener.remove();},[selected.size]);
 function deleteSelected(){const chats=[...selected],owner=localAccount.status().account;Alert.alert(chats.length===1?'Delete chat?':'Delete chats?','Remove these conversations and their messages from this device only. A new message will make a chat reappear. Saved contact decisions are kept.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void messaging.deleteChats(chats,owner).then(()=>setSelected(new Set())).catch(report)}]);}
 async function markRead(peers:string[]){await messaging.markRead(peers);setSelected(new Set());}
 const latest=new Map<string,RootChatMessage>();for(const m of state.messages.filter(m=>!m.group)){const old=latest.get(m.peer);if(!old||m.at>=old.at)latest.set(m.peer,m);}
 for(const g of state.groups??[]){const m=rootGroupMessages(state,g.id).at(-1);if(m)latest.set('group:'+g.id,m);}
 const contacts=[...state.contacts,...(state.groups??[]).map(g=>({account:'group:'+g.id,alias:g.name,blocked:g.blocked,accepted:g.accepted}))].filter(c=>!state.hiddenChats?.includes(c.account)).sort((a,b)=>(latest.get(b.account)?.at??0)-(latest.get(a.account)?.at??0));
 return <View style={{flex:1,backgroundColor:colors.background}}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:16}}>{error}</Text>}
  {selected.size>0?<View style={[listStyles.selectionBar,{borderBottomColor:colors.divider}]}><Pressable accessibilityLabel="Cancel selection" onPress={()=>setSelected(new Set())}><Ionicons name="close" size={24} color={colors.primary}/></Pressable><Text style={[listStyles.selectionBarText,{color:colors.text}]}>{selected.size} selected</Text><TouchableOpacity style={listStyles.selectionBarAction} onPress={()=>void markRead([...selected]).catch(report)}><Ionicons name="checkmark-done" size={22} color={colors.primary}/><Text style={[listStyles.selectionBarText,{color:colors.primary}]}>Mark read</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Delete selected chats" style={listStyles.selectionBarAction} onPress={deleteSelected}><Ionicons name="trash-outline" size={22} color={colors.error}/><Text style={[listStyles.selectionBarText,{color:colors.error}]}>Delete</Text></TouchableOpacity></View>:state.messages.some(m=>m.direction==='incoming'&&!m.read&&!m.deleted)&&<TouchableOpacity style={[listStyles.markAllBar,{borderBottomColor:colors.divider}]} onPress={()=>void markRead(contacts.map(c=>c.account)).catch(report)}><Ionicons name="checkmark-done" size={20} color={colors.primary}/><Text style={[listStyles.markAllText,{color:colors.primary}]}>Mark all as read</Text></TouchableOpacity>}
  <FlatList data={contacts} keyExtractor={c=>c.account} contentContainerStyle={contacts.length?listStyles.list:listStyles.emptyContainer}
   ListEmptyComponent={<EmptyState iconName="chatbubbles-outline" title="No channels open" subtitle="Start a chat with someone's identity code"/>}
   ItemSeparatorComponent={()=><View style={[listStyles.separator,{backgroundColor:colors.divider}]}/>}
   renderItem={({item:c})=>{const m=latest.get(c.account);return <ChatListRow roomId={c.account} displayName={c.alias||shortIdentity(c.account)} avatarUri={null} isDirect={false} isOnline={false}
    lastMsgContent={c.blocked?'Blocked':!c.accepted?(c.account.startsWith('group:')?'Group invitation':'Message request'):m?.attachment?(m.attachment.name===IMPORTED_STICKER_CONTENT?'Sticker':m.attachment.name):parseSticker(m?.text??'')?'Sticker':m?.text??null} lastMsgTime={m?formatHistoryTime(m.at):null}
    lastMsgFromMe={m?.direction==='outgoing'} lastMsgStatus={m?.read?'read':m?.status} unread={state.messages.filter(m=>(c.account.startsWith('group:')?m.group?.id===c.account.slice(6):!m.group&&m.peer===c.account)&&m.direction==='incoming'&&!m.read&&!m.deleted).length} typingLabel={null} isMuted={state.contacts.find(contact=>contact.account===c.account)?.muted===true} selectionMode={selected.size>0} selected={selected.has(c.account)} Colors={colors}
    onOpen={peer=>peer.startsWith('group:')?navigation.navigate('GroupRoom',{id:peer.slice(6)}):navigation.navigate('ChatRoom',{peer})} onAvatarPress={setAvatarPeer} onLongPress={toggle} onToggleSelection={toggle} onMarkRead={peer=>void markRead([peer]).catch(report)}/>;}}/>
  {avatarPeer&&<ChatAvatarActionModal visible name={contacts.find(c=>c.account===avatarPeer)?.alias||shortIdentity(avatarPeer)} subtitle={avatarPeer.startsWith('group:')?null:shortIdentity(avatarPeer)} isGroup={avatarPeer.startsWith('group:')} onClose={()=>setAvatarPeer(null)} onMessage={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupRoom',{id:avatarPeer.slice(6)}):navigation.navigate('ChatRoom',{peer:avatarPeer});}} onCall={avatarPeer.startsWith('group:')?undefined:()=>{setAvatarPeer(null);navigation.navigate('OutgoingCall',{peer:avatarPeer,kind:'voice'});}} onDetails={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupInfo',{id:avatarPeer.slice(6)}):navigation.navigate('Contact',{peer:avatarPeer});}}/>}
  <TouchableOpacity accessibilityLabel="New chat" style={[listStyles.fab,{backgroundColor:colors.surface,borderColor:colors.primary,shadowColor:colors.primary}]} onPress={()=>navigation.navigate('NewChat')}><Ionicons name="add" size={32} color={colors.primary}/></TouchableOpacity>
 </View>;
}
function ChatRoom({route,navigation}:Screen<'ChatRoom'>){
 const peer=route.params.peer,{colors}=useTheme(),{state,error}=useOwnChat(),insets=useSafeAreaInsets(),header=useHeaderHeight();
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);
 const [menuY,setMenuY]=useState(0),[menu,setMenu]=useState<RootChatMessage>(),[editing,setEditing]=useState<RootChatMessage>();
 const [forwardMessage,setForwardMessage]=useState<RootChatMessage>(),[replyTo,setReplyTo]=useState<RootChatMessage>();
 const [stickersOpen,setStickersOpen]=useState(false),[stickerPreview,setStickerPreview]=useState<Sticker>();
 const [attachOpen,setAttachOpen]=useState(false),[voiceActive,setVoiceActive]=useState(false);
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[transfers,setTransfers]=useState<Awaited<ReturnType<typeof rootAttachmentProgress>>>({jobs:[],selections:[]});
 const name=nickname(state,peer),contact=state.contacts.find(c=>c.account===peer),messages=state.messages.filter(m=>m.peer===peer&&!m.group).slice().reverse();
 const list=useRef<FlatList<RootChatMessage>>(null),owner=localAccount.status().account;
 const replyReference=replyTo?{id:replyTo.id,author:replyTo.direction==='outgoing'?owner!:peer}:undefined;
 const clearReply=React.useCallback(()=>setReplyTo(undefined),[]);
 async function act(m:RootChatMessage,kind:RootActionKind,value=''){
  if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');
  await messaging.act(peer,{id:m.id,author:m.direction==='outgoing'?owner:peer},kind,value,owner);
 }
 const unread=messages.filter(m=>m.direction==='incoming'&&m.status==='delivered'&&!m.read&&!m.deleted);
 const unreadKey=unread.map(m=>m.id).sort().join(',');
 useEffect(()=>{if(!focused||!foreground||!contact?.accepted||contact.blocked||!unreadKey)return;let active=true;
  void (async()=>{for(const m of unread){if(!active||AppState.currentState!=='active')return;await act(m,'read');}})().catch(()=>{});
  return()=>{active=false;};
 },[focused,foreground,peer,unreadKey,contact?.accepted,contact?.blocked]);

 useEffect(()=>{let active=true;const refresh=()=>void rootAttachmentProgress().then(v=>{if(active)setTransfers(v);}).catch(()=>{});refresh();const timer=setInterval(refresh,1000);return()=>{active=false;clearInterval(timer);};},[]);
 useLayoutEffect(()=>{navigation.setOptions({headerTitleAlign:'left',headerBackButtonDisplayMode:'minimal',headerTitle:()=> <ChatHeaderIdentity title={name} syncing={false} color={colors.headerText} avatarUri={null} isGroup isOnline={false} onPress={()=>navigation.navigate('Contact',{peer})}/>,headerRight:()=> <View style={{flexDirection:'row',gap:8,marginRight:8}}>
  <TouchableOpacity accessibilityLabel={contact?.muted?'Unmute notifications':'Mute notifications'} onPress={()=>void conversations().configure(peer,{muted:!contact?.muted}).catch(report)} style={{width:36,height:36,borderRadius:18,backgroundColor:contact?.muted?'rgba(255,80,80,0.15)':'rgba(0,229,255,0.10)',borderWidth:1,borderColor:contact?.muted?'rgba(255,80,80,0.35)':'rgba(0,229,255,0.30)',alignItems:'center',justifyContent:'center'}}><Ionicons name={contact?.muted?'notifications-off-outline':'notifications-outline'} size={18} color={contact?.muted?'#FF5050':'#00E5FF'}/></TouchableOpacity>
  {(['video','voice'] as const).map(kind=><TouchableOpacity key={kind} testID={kind==='voice'?'axonic-voice-call':'axonic-video-call'} accessibilityLabel={kind==='voice'?'Start voice call':'Start video call'} disabled={contact?.blocked} onPress={()=>navigation.navigate('OutgoingCall',{peer,kind})} style={{width:36,height:36,borderRadius:18,backgroundColor:'rgba(0,229,255,0.10)',borderWidth:1,borderColor:'rgba(0,229,255,0.30)',alignItems:'center',justifyContent:'center',opacity:contact?.blocked?0.4:1}}><Ionicons name={kind==='voice'?'call-outline':'videocam-outline'} size={18} color="#00E5FF"/></TouchableOpacity>)}</View>});},[navigation,peer,name,colors,contact?.blocked,contact?.muted]);
 async function send(){if(busy||!text.trim()||contact?.blocked)return;const value=text,selection=replyTo;setBusy(true);try{if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;if(editing){await messaging.act(peer,{id:editing.id,author:owner!},'edit',value,owner);setEditing(undefined);}else await messaging.sendText(peer,value,selection?{id:selection.id,author:selection.direction==='outgoing'?owner!:peer}:undefined,owner);setReplyTo(current=>current===selection?undefined:current);setText(current=>current===value?'':current);list.current?.scrollToOffset({offset:0,animated:true});}catch(e){report(e);}finally{setBusy(false);}}
 async function sendSticker(sticker:Sticker){if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');await messaging.sendText(peer,stickerMessage(sticker),replyReference,owner);setReplyTo(undefined);}
 async function sendImportedSticker(sticker:ImportedSticker){if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');const uri=importedStickerUri(owner,sticker),mime=await stickerFileMime(uri);if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');await queueRootAttachmentSource(peer,uri,IMPORTED_STICKER_CONTENT,mime,owner,replyReference);setReplyTo(undefined);}
 async function attach(source:'camera'|'library'|'files'){setAttachOpen(false);if(busy||contact?.blocked)return;setBusy(true);try{if(source==='files')await pickRootAttachment(peer,replyReference);else await pickRootMedia(peer,source,replyReference);setReplyTo(undefined);}catch(e){report(e);}finally{setBusy(false);}}
 return <KeyboardAvoidingView style={{flex:1,backgroundColor:colors.chatBg}} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={header}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}
  {contact?.blocked?<Pressable onPress={()=>navigation.navigate('Contact',{peer})}><Text style={{color:colors.error,padding:12}}>This identity is blocked. Tap to manage.</Text></Pressable>:contact&&!contact.accepted&&messages.some(m=>m.direction==='incoming')?<View style={[roomStyles.requestBanner,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><Text style={{color:colors.text,flex:1}}>Message request</Text><Pressable accessibilityLabel="Accept message request" onPress={()=>void conversations().configure(peer,{accepted:true}).catch(report)}><Text style={{color:colors.primary}}>Accept</Text></Pressable><Pressable accessibilityLabel="Reject message request" accessibilityHint="Block this identity. You can unblock it in user details." onPress={()=>void conversations().configure(peer,{accepted:false,blocked:true}).catch(report)} style={{marginLeft:16}}><Text style={{color:colors.error}}>Reject</Text></Pressable></View>:null}
  <FlatList ref={list} inverted data={messages} keyExtractor={m=>m.direction+':'+m.id} style={roomStyles.messageList} contentContainerStyle={roomStyles.messagesList} keyboardShouldPersistTaps="handled"
   renderItem={({item:m})=>{const mine=m.direction==='outgoing',sticker=!m.attachment?parseSticker(m.text):undefined,quoted=m.reply?state.messages.find(q=>q.peer===peer&&q.id===m.reply!.id&&(q.direction==='outgoing'?owner:peer)===m.reply!.author):undefined;return <ReplySwipe disabled={m.deleted||contact?.blocked} onReply={()=>{setEditing(undefined);setReplyTo(m);}}><View style={[bubbleStyles.bubbleRow,mine?bubbleStyles.bubbleRowRight:bubbleStyles.bubbleRowLeft]}><Pressable accessibilityLabel={!m.attachment?m.text:undefined} onLongPress={event=>{if(!m.deleted){setMenuY(event.nativeEvent.pageY);setMenu(m);}}} style={[bubbleStyles.bubbleTouchTarget,bubbleStyles.bubble,mine?bubbleStyles.bubbleSent:bubbleStyles.bubbleReceived,{backgroundColor:mine?colors.bubbleSent:colors.bubbleReceived,borderColor:colors.neonBorder,minWidth:m.attachment?260:96},!m.deleted&&(sticker||m.attachment?.name===IMPORTED_STICKER_CONTENT)&&bubbleStyles.stickerBubble]}>
    {!m.deleted&&m.reply&&<View style={{borderLeftWidth:3,borderLeftColor:colors.primary,padding:8,marginBottom:6}}><Text style={{color:colors.primary,fontWeight:'600'}}>{m.reply.author===owner?'You':name}</Text><Text numberOfLines={2} style={{color:colors.textSecondary}}>{quoted?(quoted.attachment?(quoted.attachment.name===IMPORTED_STICKER_CONTENT?'Sticker':quoted.attachment.name):parseSticker(quoted.text)?'Sticker':quoted.text):'Original message unavailable on this device'}</Text></View>}
    {m.deleted?<Text style={{color:colors.textSecondary,fontStyle:'italic'}}>Message deleted</Text>:m.attachment?<RootAttachmentBubble message={m} progress={transfers.jobs.find(j=>j.digest===attachmentDigest(m.attachment!.manifest))} onError={report}/>:sticker?<Pressable accessibilityLabel={sticker.label+' sticker'} onPress={()=>setStickerPreview(sticker)}><StickerArt sticker={sticker} size={150}/></Pressable>:<SmartMessageText style={[bubbleStyles.messageText,{color:colors.text}]} linkColor={colors.primary}>{m.text}</SmartMessageText>}
    {!!m.reactions?.length&&<View style={{flexDirection:'row',gap:6,marginTop:6}}>{m.reactions.map(r=><Text key={r.author} style={{fontSize:18}}>{r.text}</Text>)}</View>}
    <View style={bubbleStyles.metaRow}>{m.edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>Edited </Text>}<Text style={[bubbleStyles.timeText,{color:colors.textTertiary}]}>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text>{mine&&<Ionicons accessibilityLabel={m.read?'Read':m.status==='delivered'?'Delivered':'Pending'} name={m.read?'checkmark-done':m.status==='delivered'?'checkmark':'time-outline'} size={13} color={m.read?colors.checkBlue:colors.textTertiary}/>}</View>
   </Pressable></View></ReplySwipe>;}}/>
  {transfers.selections.filter(s=>s.peer===peer).map(s=><View key={s.id} style={{padding:8,backgroundColor:colors.surface}}><Text style={{color:colors.textSecondary}}>{s.name} · {s.failed?'Could not prepare attachment':'Preparing attachment…'}</Text>{s.failed&&<View style={{flexDirection:'row',gap:20}}><Pressable onPress={()=>void retryRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Retry</Text></Pressable><Pressable onPress={()=>void removeRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Remove</Text></Pressable></View>}</View>)}
  {stickersOpen&&owner&&<StickerPicker ownerId={owner} draftStorage={rootStickerDraft(owner)} onClose={()=>setStickersOpen(false)} onSend={sendSticker} onSendImported={sendImportedSticker}/>}
  {stickerPreview&&owner&&<StickerPreview sticker={stickerPreview} userId={owner} onClose={()=>setStickerPreview(undefined)}/>}
  {menu&&<RootMessageMenu message={menu} pageY={menuY} info={()=>navigation.navigate('MessageInfo',{peer:menu.peer,id:menu.id,direction:menu.direction})} close={()=>setMenu(undefined)} copy={()=>void Clipboard.setStringAsync(menu.text).catch(report)}
    reply={()=>{setEditing(undefined);setReplyTo(menu);}} forward={()=>setForwardMessage(menu)}
    edit={()=>{setReplyTo(undefined);setEditing(menu);setText(menu.text);}}
    remove={()=>Alert.alert('Delete message?','The message will be shown as deleted on both devices.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void act(menu,'delete').catch(report)}])}
    react={value=>void act(menu,'reaction',value).catch(report)}/>}
  {editing&&<View style={[roomStyles.replyPreview,{backgroundColor:colors.surface,borderLeftColor:colors.primary}]}><Text style={{color:colors.primary,flex:1}}>Editing message</Text><Pressable accessibilityLabel="Cancel edit" onPress={()=>{setEditing(undefined);setText('');}}><Ionicons name="close" size={22} color={colors.text}/></Pressable></View>}
  {forwardMessage&&<RootForwardPicker message={forwardMessage} contacts={state.contacts} onClose={()=>setForwardMessage(undefined)}/>}
  <AttachmentMenu visible={attachOpen} onClose={()=>setAttachOpen(false)} onCamera={()=>void attach('camera')} onMultimedia={()=>void attach('library')} onFiles={()=>void attach('files')}/>
  {replyTo&&<View style={[roomStyles.replyPreview,{backgroundColor:colors.surface,borderLeftColor:colors.primary}]}><View style={{flex:1}}><Text style={[roomStyles.replyPreviewName,{color:colors.primary}]}>{replyTo.direction==='outgoing'?'Replying to yourself':'Replying to '+name}</Text><Text numberOfLines={2} style={[roomStyles.replyPreviewText,{color:colors.textSecondary}]}>{replyTo.attachment?.name===IMPORTED_STICKER_CONTENT||parseSticker(replyTo.text)?'Sticker':replyTo.text}</Text></View><Pressable accessibilityLabel="Cancel reply" onPress={()=>setReplyTo(undefined)} style={roomStyles.replyPreviewClose}><Ionicons name="close" size={22} color={colors.text}/></Pressable></View>}
  <View testID="axonic-composer-bar" style={[roomStyles.inputBar,{backgroundColor:colors.chatBg,borderTopColor:colors.neonBorder,paddingBottom:Math.max(insets.bottom,8)}]}><View style={roomStyles.inputRowWrap}>
   {!voiceActive&&<TouchableOpacity accessibilityLabel="Attach" disabled={busy||!!editing||contact?.blocked} onPress={()=>setAttachOpen(true)} style={[roomStyles.attachBtn,{borderColor:colors.neonBorder,backgroundColor:colors.surface,shadowColor:colors.primary}]}><Ionicons name="add" size={25} color={colors.primary}/></TouchableOpacity>}
   {!voiceActive&&<View style={[roomStyles.inputRow,{backgroundColor:colors.surface,borderColor:colors.neonBorder,paddingLeft:12}]}><Pressable accessibilityLabel="Open stickers" disabled={busy||!!editing||contact?.blocked} onPress={()=>setStickersOpen(true)} style={{padding:8}}><Ionicons name="happy-outline" size={24} color={colors.primary}/></Pressable><TextInput testID="axonic-message-composer" accessibilityLabel="New message" placeholder="Compose message…" placeholderTextColor={colors.textTertiary} style={[roomStyles.textInput,{color:colors.text}]} value={text} onChangeText={setText} multiline maxLength={1600} editable={!contact?.blocked}/></View>}
   {text.trim()||editing?<TouchableOpacity testID="axonic-send-message" accessibilityLabel="Send message" disabled={busy||!text.trim()||contact?.blocked} onPress={()=>void send()} style={[roomStyles.sendBtn,{backgroundColor:colors.primary,borderColor:colors.neonBorder,shadowColor:colors.primary,opacity:busy||!text.trim()||contact?.blocked?0.45:1}]}><Text style={[roomStyles.sendIcon,{color:colors.textInverse}]}>▶</Text></TouchableOpacity>:<RootVoiceComposer peer={peer} reply={replyReference} onSent={clearReply} disabled={busy||!!contact?.blocked} onError={report} onActive={setVoiceActive}/>}
  </View></View>
 </KeyboardAvoidingView>;
}
function Contact({route,navigation}:Screen<'Contact'>){
 const {colors}=useTheme(),{state,error}=useOwnChat(),peer=route.params.peer,contact=state.contacts.find(c=>c.account===peer);
 const identity=displayIdentity(peer),name=contact?.alias||shortIdentity(peer);
 const [alias,setAlias]=useState<string|null>(null),[saving,setSaving]=useState(false);
 useEffect(()=>{setAlias(null);},[peer]);
 async function save(){if(alias===null||saving)return;setSaving(true);try{await conversations().configure(peer,{alias});setAlias(null);Alert.alert('Nickname saved','Only you see this name on this phone.');}catch(e){report(e);}finally{setSaving(false);}}
 const Action=({icon,label,onPress}:{icon:React.ComponentProps<typeof Ionicons>['name'];label:string;onPress:()=>void})=><TouchableOpacity style={infoStyles.action} activeOpacity={0.72} accessibilityLabel={label} onPress={onPress}><View style={[infoStyles.actionIcon,{borderColor:colors.neonBorder,backgroundColor:colors.highlight}]}><Ionicons name={icon} size={23} color={colors.primary}/></View><Text style={[infoStyles.actionLabel,{color:colors.text}]}>{label}</Text></TouchableOpacity>;
 const section={backgroundColor:colors.surface,borderColor:colors.neonBorder};
 return <ScrollView style={{backgroundColor:colors.background}} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={infoStyles.content}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
  <View style={[infoStyles.hero,section]}>
   <Avatar name={name} size={112}/><Text selectable style={[infoStyles.name,{color:colors.text}]}>{name}</Text>
   {!!contact?.alias&&<Text selectable style={[infoStyles.username,{color:colors.textSecondary}]}>{identity}</Text>}
   <View style={[infoStyles.divider,{backgroundColor:colors.divider}]}/><View style={infoStyles.actions}>
    <Action icon="chatbubble-ellipses-outline" label="Message" onPress={()=>navigation.navigate('ChatRoom',{peer})}/>
    <Action icon="call-outline" label="Voice" onPress={()=>{if(contact?.blocked){report('Unblock this identity before calling');return;}navigation.navigate('OutgoingCall',{peer,kind:'voice'});}}/>
    <Action icon="videocam-outline" label="Video" onPress={()=>{if(contact?.blocked){report('Unblock this identity before calling');return;}navigation.navigate('OutgoingCall',{peer,kind:'video'});}}/>
   </View>
  </View>
  <View style={[infoStyles.section,section]}>
   <Text style={[infoStyles.sectionLabel,{color:colors.textSecondary}]}>AXONIC PROFILE</Text>
   <View style={infoStyles.detailRow}><Ionicons name="finger-print-outline" size={20} color={colors.primary}/><View style={infoStyles.detailText}><Text style={[infoStyles.detailLabel,{color:colors.textSecondary}]}>Axonic ID</Text><Text selectable style={[infoStyles.detailValue,{color:colors.text}]}>{identity}</Text></View></View>
   <View style={{alignItems:'center',padding:12,backgroundColor:'#fff',borderRadius:12,alignSelf:'center'}}><QRCode value={identity} size={180}/></View>
   <View style={infoStyles.actions}><Action icon="copy-outline" label="Copy ID" onPress={()=>void Clipboard.setStringAsync(identity).catch(report)}/><Action icon="share-outline" label="Share ID" onPress={()=>void Share.share({message:identity}).catch(report)}/></View>
  </View>
  <View style={[infoStyles.section,section]}>
   <Text style={[infoStyles.sectionLabel,{color:colors.textSecondary}]}>PRIVATE NICKNAME</Text><Text style={{color:colors.textSecondary}}>Only you see this name on this phone. Clear it to use their Axonic ID again.</Text>
   <TextInput accessibilityLabel="Private nickname" value={alias??contact?.alias??''} onChangeText={setAlias} editable={!saving} maxLength={80} placeholder="For example, Dad" placeholderTextColor={colors.textTertiary} style={{color:colors.text,padding:12,borderWidth:1,borderColor:colors.neonBorder,borderRadius:10}}/>
   <TouchableOpacity disabled={saving||alias===null} onPress={()=>void save()}><Text style={{color:colors.primary,fontWeight:'700',opacity:saving||alias===null?0.5:1}}>{saving?'Saving…':'Save nickname'}</Text></TouchableOpacity>
  </View>
  <TouchableOpacity style={[infoStyles.setting,section]} activeOpacity={0.72} onPress={()=>void conversations().configure(peer,{muted:!contact?.muted}).catch(report)}>
   <Ionicons name={contact?.muted?'notifications-off-outline':'notifications-outline'} size={21} color={colors.primary}/><Text style={[infoStyles.settingText,{color:colors.text}]}>{contact?.muted?'Unmute notifications':'Mute notifications'}</Text><Ionicons name="chevron-forward" size={19} color={colors.textTertiary}/>
  </TouchableOpacity>
  <TouchableOpacity style={[infoStyles.setting,section]} activeOpacity={0.72} onPress={()=>void conversations().configure(peer,{blocked:!contact?.blocked}).catch(report)}>
   <Ionicons name="ban-outline" size={21} color={colors.error}/><Text style={[infoStyles.settingText,{color:colors.error}]}>{contact?.blocked?'Unblock':'Block'}</Text><Ionicons name="chevron-forward" size={19} color={colors.textTertiary}/>
  </TouchableOpacity>
 </ScrollView>;
}
function NewChat({navigation}:Screen<'NewChat'>){
 const {colors}=useTheme(),{state}=useOwnChat(),[peer,setPeer]=useState(''),[busy,setBusy]=useState(false);
 async function open(value=peer){if(busy)return;setBusy(true);try{const account=parseIdentityCode(value);if(!account||account===localAccount.status().account)throw Error('Paste another person’s complete identity code');await conversations().configure(account,{accepted:true});navigation.replace('ChatRoom',{peer:account});}catch(e){report(e);}finally{setBusy(false);}}
 const query=peer.toLowerCase(),contacts=state.contacts.filter(c=>!c.blocked&&(!query||c.alias.toLowerCase().includes(query)||displayIdentity(c.account).toLowerCase().includes(query)));
 return <View style={[contactStyles.container,{backgroundColor:colors.background}]}>
  <View style={contactStyles.searchBar}><View style={{flex:1}}><Input accessibilityLabel="Peer identity" placeholder="Search nickname or paste an axon code…" autoCapitalize="none" autoCorrect={false} value={peer} onChangeText={setPeer} style={contactStyles.searchInput}/></View><RootIdentityScanner compact onIdentity={account=>void open(displayIdentity(account))}/></View>
  <TouchableOpacity style={[contactStyles.item,{borderBottomWidth:1,borderBottomColor:colors.divider}]} onPress={()=>navigation.navigate('GroupCreate')}><Ionicons name="people-outline" size={26} color={colors.primary}/><Text style={[contactStyles.name,{color:colors.primary,marginLeft:Spacing.md}]}>New group</Text></TouchableOpacity>
  {!!parseIdentityCode(peer)&&<View style={{padding:Spacing.md}}><Button title="START CHAT" disabled={busy} onPress={()=>void open()}/></View>}
  <FlatList data={contacts} keyExtractor={c=>c.account} contentContainerStyle={!contacts.length?contactStyles.emptyContainer:contactStyles.list} ListEmptyComponent={<EmptyState iconName="people-outline" title="No contacts" subtitle="Scan a QR code or paste an identity to start a chat"/>} renderItem={({item:c})=><TouchableOpacity style={contactStyles.item} onPress={()=>void open(displayIdentity(c.account))}><Avatar name={c.alias||shortIdentity(c.account)} size={46}/><View style={contactStyles.info}><Text numberOfLines={1} style={[contactStyles.name,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text><Text numberOfLines={1} style={[contactStyles.sub,{color:colors.textSecondary}]}>{shortIdentity(c.account)}</Text></View><Ionicons name="chatbubble-outline" size={22} color={colors.primary}/></TouchableOpacity>} ItemSeparatorComponent={()=><View style={[contactStyles.separator,{backgroundColor:colors.divider}]}/>}/>
 </View>;
}
function formatHistoryTime(at:number){const date=dayjs(at),now=dayjs();return date.isSame(now,'day')?date.format('HH:mm'):date.isSame(now.subtract(1,'day'),'day')?'Yesterday':date.format('DD/MM/YY');}
function Calls({navigation}:Screen<'Tabs'>){
 const {colors}=useTheme(),{state}=useOwnChat(),[rows,setRows]=useState<OwnCallSummary[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;const refresh=async()=>{const owner=localAccount.status().account;if(!owner)return;try{const result=await listOwnCallHistory(owner);if(active){setRows(result);setError('');}}catch{if(active)setError('Unable to read call history');}};void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{active=false;clearInterval(timer);};},[]);
 return <View style={[callStyles.container,{backgroundColor:colors.background}]}>{!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}<FlatList data={rows} keyExtractor={r=>r.id} contentContainerStyle={rows.length?callStyles.list:callStyles.emptyContainer} ListEmptyComponent={<EmptyState iconName="call-outline" title="No call history" subtitle="Start a call from a chat conversation"/>} ItemSeparatorComponent={()=><View style={[callStyles.separator,{backgroundColor:colors.divider}]}/>} renderItem={({item:r})=><TouchableOpacity accessibilityLabel={`Call ${nickname(state,r.peer)}`} onPress={()=>navigation.navigate('OutgoingCall',{peer:r.peer,kind:r.media})} activeOpacity={0.7} style={[callStyles.callItem,{borderColor:colors.neonBorder}]}><View style={[callStyles.accentBar,{backgroundColor:colors.primary}]}/><Avatar name={nickname(state,r.peer)} size={46}/><View style={callStyles.callInfo}><Text numberOfLines={1} style={[callStyles.callName,{color:colors.text}]}>{nickname(state,r.peer).toUpperCase()}</Text><View style={callStyles.callMeta}><Text style={[callStyles.directionTag,{color:colors.primary,borderColor:colors.primary}]}>{r.outgoing?'OUT':'IN'}</Text><Text style={[callStyles.callType,{color:colors.textSecondary}]}>{r.media==='video'?'VIDEO':'AUDIO'}</Text></View></View><View style={callStyles.callRight}><Text style={[callStyles.callTime,{color:colors.primary}]}>{formatHistoryTime(r.at)}</Text><View style={[callStyles.callbackBtn,{borderColor:colors.primary}]}><Ionicons name={r.media==='video'?'videocam-outline':'call-outline'} size={16} color={colors.primary}/></View></View></TouchableOpacity>}/></View>;
}
function BlockedUsers(){const {colors}=useTheme(),{state}=useOwnChat();return <FlatList style={{flex:1,backgroundColor:colors.background}} data={state.contacts.filter(c=>c.blocked)} keyExtractor={c=>c.account} contentContainerStyle={state.contacts.some(c=>c.blocked)?contactStyles.list:contactStyles.emptyContainer} ListEmptyComponent={<EmptyState iconName="ban-outline" title="No blocked users"/>} renderItem={({item:c})=><View style={contactStyles.item}><Avatar name={c.alias||shortIdentity(c.account)} size={46}/><View style={contactStyles.info}><Text style={[contactStyles.name,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text><Text style={[contactStyles.sub,{color:colors.textSecondary}]}>{shortIdentity(c.account)}</Text></View><TouchableOpacity accessibilityLabel="Unblock user" onPress={()=>Alert.alert('Unblock user?',`Unblock ${c.alias||shortIdentity(c.account)}? They will be able to message and call you again.`,[{text:'Cancel',style:'cancel'},{text:'Unblock',onPress:()=>void conversations().configure(c.account,{blocked:false}).catch(report)}])}><Text style={{color:colors.primary}}>Unblock</Text></TouchableOpacity></View>}/>;}
function MessageInfo({route}:Screen<'MessageInfo'>){const {colors}=useTheme(),{state}=useOwnChat(),message=state.messages.find(m=>m.peer===route.params.peer&&m.id===route.params.id&&m.direction===route.params.direction),insets=useSafeAreaInsets();return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:18,paddingBottom:insets.bottom+24,gap:20}}>{message?<><View style={{padding:16,borderRadius:18,backgroundColor:colors.surface,gap:14}}><Text selectable style={{color:colors.text,fontSize:17}}>{message.deleted?'This message was deleted.':message.attachment?.name||message.text}</Text><Text style={{color:colors.textSecondary}}>From</Text><Text style={{color:colors.text}}>{message.direction==='outgoing'?'You':nickname(state,message.peer)}</Text><Text style={{color:colors.textSecondary}}>Created</Text><Text style={{color:colors.text}}>{new Date(message.at).toLocaleString()}</Text><Text style={{color:colors.textSecondary}}>Type</Text><Text style={{color:colors.text}}>{message.attachment?.mime||'Text'}</Text></View><Text style={{color:colors.primary,fontSize:18,fontWeight:'700'}}>{message.read?'Read':message.status==='delivered'?'Delivered':'Pending'}</Text><Text style={{color:colors.textSecondary}}>{message.direction==='outgoing'?'Confirmed by the receiving device; exact receipt times are not recorded.':'Stored on this device.'}</Text></>:<Text style={{color:colors.textSecondary}}>This message is no longer stored on this phone.</Text>}</ScrollView>;}
function OutgoingCall({route,navigation}:Screen<'OutgoingCall'>){
 const {state}=useOwnChat(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false),proceed=useRef(false),mounted=useRef(true);
 useEffect(()=>()=>{mounted.current=false;},[]);
 useEffect(()=>navigation.addListener('beforeRemove',event=>{if(lock.current&&!proceed.current)event.preventDefault();}),[navigation]);
 async function start(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const contact=state.contacts.find(c=>c.account===route.params.peer);if(contact?.blocked)throw Error('Unblock this identity before calling');const calls=localAccountCalls();if(calls?.snapshot()&&calls.snapshot()?.status!=='ended')throw Error('Finish your current call before starting another.');await startCall(route.params.peer,route.params.kind);if(mounted.current){proceed.current=true;navigation.goBack();}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to start call');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 return <OutgoingCallAppearance name={nickname(state,route.params.peer)} kind={route.params.kind} busy={busy} error={error} start={()=>void start()} cancel={()=>{if(!lock.current)navigation.goBack();}}/>;
}
export default function RootAccountNavigator({profile,network}:{profile:React.ReactNode;network:React.ReactNode}){
 const {colors,isDark}=useTheme(),options=useMainTabOptions(),base=isDark?DarkTheme:DefaultTheme;
 const ref=useRef(createNavigationContainerRef<Routes>()).current;
 const visible=()=>{const route=ref.getCurrentRoute();setRootVisibleConversation(route?.name==='ChatRoom'?{peer:(route.params as Routes['ChatRoom']).peer}:route?.name==='GroupRoom'?{group:(route.params as Routes['GroupRoom']).id}:null);};
 useEffect(()=>{
  let alive=true,opening=false;
  const open=async()=>{if(opening||!alive||!ref.isReady()||localAccount.status().state!=='unlocked')return;opening=true;
   try{const account=localAccount.status().account!,target=await pendingRootNotificationOpen(account);if(!target||!alive||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;
    const state=await conversations().snapshot();if(!alive||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;
    if(target.group&&state.groups?.some(g=>g.id===target.group))ref.navigate('GroupRoom',{id:target.group});else ref.navigate('ChatRoom',{peer:target.sender});
    await finishRootNotificationOpen();
   }catch{}finally{opening=false;}};
  const stop=notifee.onForegroundEvent(({type,detail})=>{if(type===EventType.PRESS)void queueRootNotificationOpen(detail.notification?.data).then(open).catch(()=>{});else if(type===EventType.ACTION_PRESS)void handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data,detail.input).catch(report);});
  void notifee.getInitialNotification().then(initial=>initial?queueRootNotificationOpen(initial.notification.data):undefined).then(open).catch(()=>{});
  const timer=setInterval(()=>void open(),600);return()=>{alive=false;clearInterval(timer);stop();setRootVisibleConversation(null);};
 },[ref]);
 return <><NavigationContainer ref={ref} onReady={visible} onStateChange={visible} theme={{...base,colors:{...base.colors,background:colors.background,card:colors.headerBg,text:colors.text,primary:colors.primary,border:colors.neonBorder}}}>
  <Stack.Navigator screenOptions={{headerStyle:{backgroundColor:colors.headerBg},headerTintColor:colors.headerText,headerTitleStyle:{...Font.semiBold,color:colors.headerText},contentStyle:{backgroundColor:colors.background}}}>
   <Stack.Screen name="Tabs" options={{headerShown:false}}>{props=><Tabs.Navigator screenOptions={options}><Tabs.Screen name="Chats" options={{headerTitle:'AXONIC'}}>{()=> <ChatList {...props}/>}</Tabs.Screen><Tabs.Screen name="Calls" options={{headerTitle:'CALLS'}}>{()=> <Calls {...props}/>}</Tabs.Screen><Tabs.Screen name="Profile" options={{headerTitle:'PROFILE'}}>{()=> <>{profile}</>}</Tabs.Screen></Tabs.Navigator>}</Stack.Screen>
   <Stack.Screen name="ChatRoom" component={ChatRoom}/><Stack.Screen name="NewChat" component={NewChat} options={{title:'New chat'}}/><Stack.Screen name="Contact" component={Contact} options={{title:'User details'}}/>
   <Stack.Screen name="GroupCreate" component={RootGroupCreate} options={{title:'New group'}}/><Stack.Screen name="GroupRoom" component={RootGroupRoom}/><Stack.Screen name="GroupInfo" component={RootGroupInfo} options={{title:'Group information'}}/>
   <Stack.Screen name="ChatStorage" component={RootChatStorageScreen} options={{title:'Chat storage'}}/>
   <Stack.Screen name="BlockedUsers" component={BlockedUsers} options={{title:'Blocked users'}}/>
   <Stack.Screen name="MessageInfo" component={MessageInfo} options={{title:'Message info'}}/>
   <Stack.Screen name="OutgoingCall" component={OutgoingCall} options={{headerShown:false,presentation:'transparentModal',animation:'slide_from_bottom',contentStyle:{backgroundColor:'transparent'},gestureEnabled:false}}/>
   <Stack.Screen name="Network" options={{title:'Network'}}>{()=> <ScrollView contentContainerStyle={{padding:24,gap:16}}>{network}</ScrollView>}</Stack.Screen>
  </Stack.Navigator>
 </NavigationContainer><RootMessageToast/></>;
}


