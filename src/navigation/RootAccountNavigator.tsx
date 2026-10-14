import {ChatComposer,type ChatComposerHandle} from '../components/chat/ChatComposer';
import {submitComposer} from '../components/chat/submitComposer';
import {MessageStatusTimes} from '../components/chat/MessageStatusTimes';
import {useForegroundPoll} from '../hooks/useForegroundPoll';
import {useMessageStateClock} from '../modules/ui/useMessageStateClock';
import {messageInfoDescription} from '../modules/messaging';
import RootMediaSize from '../components/chat/RootMediaSize';
import RootGroupMessageInfo from '../screens/chat/RootGroupMessageInfo';
import RootMessageReactions from '../components/chat/RootMessageReactions';
import {dismissRootConversationNotifications} from '../modules/messaging/notifications';

import {KeyboardAvoidingScreen,KeyboardFormScrollView} from '../components/ui/KeyboardForm';
import {KeyboardAwareTextInput as TextInput} from '../components/ui/KeyboardForm';
import {groupPhotoUri} from '../components/chat/group-photo';
import {useChatActivity} from '../modules/ui/useChatActivity';



import {useChatSnapshot as useOwnChat} from '../modules/ui/useChatSnapshot';
import ChatConnectionBar from '../components/chat/ChatConnectionBar';

import {useAttachmentPreview} from '../components/chat/AttachmentPreview';

import RootSharePicker from '../components/chat/RootSharePicker';

import {rootMessageStatus,deliveryStatusIcon,deliveryStatusLabel} from '../modules/messaging';

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

import { displayIdentity, shortIdentity, parseIdentityInput, identityLink, takeIdentityLink } from '../modules/identity';

import RootMessageMenu from '../components/chat/RootMessageMenu';

import {type RootActionKind} from '../modules/messaging';

import RootForwardPicker from '../components/chat/RootForwardPicker';

import {rootStickerDraft} from '../modules/messaging';

import StickerPicker from '../components/chat/sticker-picker';

import StickerArt from '../components/chat/sticker-art';

import StickerPreview from '../components/chat/sticker-preview';

import {stickerMessage,parseSticker,type Sticker} from '../services/stickers';

import {importedStickerUri,stickerFileMime,type ImportedSticker} from '../services/imported-stickers';

import {IMPORTED_STICKER_CONTENT} from '../services/sticker-file-format';



import AttachmentMenu from '../components/chat/AttachmentMenu';

import {pickRootMedia} from '../modules/ui/mediaPicker';

import * as Clipboard from 'expo-clipboard';

import React,{useCallback,useMemo,useEffect,useLayoutEffect,useRef,useState} from 'react';

import {AppState,BackHandler,Keyboard,Modal,useWindowDimensions,FlatList,Pressable,ScrollView,Share,Text,TouchableOpacity,View} from 'react-native';

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

import {CHAT_STICKER_SIZE,messageBubbleStyles as bubbleStyles} from '../components/chat/message-bubble-styles';

import Avatar from '../components/ui/Avatar';

import EmptyState from '../components/ui/EmptyState';

import RootAttachmentBubble from '../components/RootAttachmentBubble';

import {messaging,calling} from '../modules/messaging';

import {localAccount} from '../modules/identity';

import {conversations} from '../modules/messaging';

import type {RootChatState,RootChatMessage} from '../modules/messaging';

import {localAccountCalls,subscribeLocalAccountCalls} from '../modules/messaging';

import {ensureRootCallPermissions} from '../screens/calls/RootAccountCallScreen';

import {attachmentDigest} from '../modules/messaging';

import {queueRootAttachmentSource,rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../modules/messaging';

import {listOwnCallHistory,type OwnCallSummary} from '../modules/storage';

import {rootGroupMessages} from '../modules/messaging';

import {RootGroupCreate,RootGroupRoom,RootGroupInfo} from '../screens/chat/RootGroupScreens';

import type {RootAccountRoutes} from './rootAccountRoutes';

type Routes=RootAccountRoutes;

const Stack=createNativeStackNavigator<Routes>(),Tabs=createBottomTabNavigator();

type Screen<P extends keyof Routes>=NativeStackScreenProps<Routes,P>;

const report=(error:unknown)=>Alert.alert('Axonic',error instanceof Error?error.message:typeof error==='string'?error:'Please try again');

function nickname(state:RootChatState,peer:string){return state.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);}

const startCall=(peer:string,kind:'voice'|'video')=>calling.start(peer,kind,()=>ensureRootCallPermissions(kind));

function ChatList({navigation}:Screen<'Tabs'>){

 const activity=useChatActivity();

 const {colors}=useTheme(),{state,error}=useOwnChat(),[avatarPeer,setAvatarPeer]=useState<string|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());

 const toggle=useCallback((peer:string)=>setSelected(old=>{const next=new Set(old);next.has(peer)?next.delete(peer):next.add(peer);return next;}),[]);

 useEffect(()=>{if(!selected.size)return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setSelected(new Set());return true;});return()=>listener.remove();},[selected.size]);

 function deleteSelected(){const chats=[...selected],owner=localAccount.status().account;Alert.alert(chats.length===1?'Delete chat?':'Delete chats?','Remove these conversations and their messages from this device only. A new message will make a chat reappear. Saved contact decisions are kept.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void messaging.deleteChats(chats,owner).then(()=>setSelected(new Set())).catch(report)}]);}

 const markRead=useCallback(async(peers:string[])=>{await messaging.markRead(peers);setSelected(new Set());},[]);
 const openChat=useCallback((peer:string)=>peer.startsWith('group:')?navigation.navigate('GroupRoom',{id:peer.slice(6)}):navigation.navigate('ChatRoom',{peer}),[navigation]);
 const markOneRead=useCallback((peer:string)=>void markRead([peer]).catch(report),[markRead]);

 const unreadCounts=useMemo(()=>{const counts=new Map<string,number>();for(const m of state.messages){if(m.direction!=='incoming'||m.read||m.deleted)continue;const key=m.group?'group:'+m.group.id:m.peer;counts.set(key,(counts.get(key)??0)+1);}return counts;},[state.messages]);
 const latest=useMemo(()=>{const result=new Map<string,RootChatMessage>();for(const m of state.messages){if(m.group)continue;const old=result.get(m.peer);if(!old||m.at>=old.at)result.set(m.peer,m);}for(const g of state.groups??[]){const m=rootGroupMessages(state,g.id).at(-1);if(m)result.set('group:'+g.id,m);}return result;},[state.messages,state.groups]);


 const contacts=[...state.contacts,...(state.groups??[]).map(g=>({account:'group:'+g.id,alias:g.name,blocked:g.blocked,accepted:g.accepted}))].filter(c=>!state.hiddenChats?.includes(c.account)).sort((a,b)=>(latest.get(b.account)?.at??0)-(latest.get(a.account)?.at??0));

 return <View style={{flex:1,backgroundColor:colors.background}}>

  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:16}}>{error}</Text>}

  {selected.size>0?<View style={[listStyles.selectionBar,{borderBottomColor:colors.divider}]}><Pressable accessibilityLabel="Cancel selection" onPress={()=>setSelected(new Set())}><Ionicons name="close" size={24} color={colors.primary}/></Pressable><Text style={[listStyles.selectionBarText,{color:colors.text}]}>{selected.size} selected</Text><TouchableOpacity accessibilityLabel="Select all chats" style={listStyles.selectionBarAction} onPress={()=>setSelected(new Set(selected.size===contacts.length?[]:contacts.map(c=>c.account)))}><Ionicons name="checkbox-outline" size={22} color={colors.primary}/></TouchableOpacity><TouchableOpacity style={listStyles.selectionBarAction} onPress={()=>void markRead([...selected]).catch(report)}><Ionicons name="checkmark-done" size={22} color={colors.primary}/><Text style={[listStyles.selectionBarText,{color:colors.primary}]}>Mark read</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Delete selected chats" style={listStyles.selectionBarAction} onPress={deleteSelected}><Ionicons name="trash-outline" size={22} color={colors.error}/><Text style={[listStyles.selectionBarText,{color:colors.error}]}>Delete</Text></TouchableOpacity></View>:state.messages.some(m=>m.direction==='incoming'&&!m.read&&!m.deleted)&&<TouchableOpacity style={[listStyles.markAllBar,{borderBottomColor:colors.divider}]} onPress={()=>void markRead(contacts.map(c=>c.account)).catch(report)}><Ionicons name="checkmark-done" size={20} color={colors.primary}/><Text style={[listStyles.markAllText,{color:colors.primary}]}>Mark all as read</Text></TouchableOpacity>}

  <FlatList data={contacts} keyExtractor={c=>c.account} contentContainerStyle={contacts.length?listStyles.list:listStyles.emptyContainer}

   ListEmptyComponent={<EmptyState iconName="chatbubbles-outline" title="No channels open" subtitle="Start a chat with someone's identity code"/>}

   ItemSeparatorComponent={()=><View style={[listStyles.separator,{backgroundColor:colors.divider}]}/>}

   renderItem={({item:c})=>{const m=latest.get(c.account);return <ChatListRow roomId={c.account} displayName={c.alias||shortIdentity(c.account)} avatarUri={c.account.startsWith('group:')?groupPhotoUri(state,c.account.slice(6),localAccount.status().account):state.avatarUris[c.account]} isDirect={!c.account.startsWith('group:')} isOnline={activity.online.includes(c.account)}

    lastMsgContent={c.blocked?'Blocked':!c.accepted?(c.account.startsWith('group:')?'Group invitation':'Message request'):m?.attachment?(m.attachment.name===IMPORTED_STICKER_CONTENT?'Sticker':m.attachment.caption||m.attachment.name):parseSticker(m?.text??'')?'Sticker':m?.text??null} lastMsgTime={m?formatHistoryTime(m.at):null}

    lastMsgFromMe={m?.direction==='outgoing'} lastMsgStatus={m?rootMessageStatus(m):undefined} unread={unreadCounts.get(c.account)??0} typingLabel={activity.typing.includes(c.account)?'Typing…':null} isMuted={c.account.startsWith('group:')?state.groups?.find(g=>g.id===c.account.slice(6))?.muted===true:state.contacts.find(contact=>contact.account===c.account)?.muted===true} selectionMode={selected.size>0} selected={selected.has(c.account)} Colors={colors}

    onOpen={openChat} onAvatarPress={setAvatarPeer} onLongPress={toggle} onToggleSelection={toggle} onMarkRead={markOneRead}/>;}}/>

  {avatarPeer&&<ChatAvatarActionModal visible avatarUri={avatarPeer.startsWith('group:')?groupPhotoUri(state,avatarPeer.slice(6),localAccount.status().account):state.avatarUris[avatarPeer]} name={contacts.find(c=>c.account===avatarPeer)?.alias||shortIdentity(avatarPeer)} subtitle={avatarPeer.startsWith('group:')?null:shortIdentity(avatarPeer)} isGroup={avatarPeer.startsWith('group:')} onClose={()=>setAvatarPeer(null)} onMessage={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupRoom',{id:avatarPeer.slice(6)}):navigation.navigate('ChatRoom',{peer:avatarPeer});}} onCall={avatarPeer.startsWith('group:')?undefined:()=>{setAvatarPeer(null);navigation.navigate('OutgoingCall',{peer:avatarPeer,kind:'voice'});}} onDetails={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupInfo',{id:avatarPeer.slice(6)}):navigation.navigate('Contact',{peer:avatarPeer});}}/>}

  <TouchableOpacity accessibilityLabel="New chat" style={[listStyles.fab,{backgroundColor:colors.surface,borderColor:colors.primary,shadowColor:colors.primary}]} onPress={()=>navigation.navigate('NewChat')}><Ionicons name="add" size={32} color={colors.primary}/></TouchableOpacity>

 </View>;

}

function ChatRoom({route,navigation}:Screen<'ChatRoom'>){

 const activity=useChatActivity();

 const peer=route.params.peer,{colors}=useTheme(),{state,error}=useOwnChat(),header=useHeaderHeight();

 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');

 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);

 const [stickerSource,setStickerSource]=useState<string>();
 const [menuY,setMenuY]=useState(0),[menu,setMenu]=useState<RootChatMessage>(),[editing,setEditing]=useState<RootChatMessage>();

 const [forwardMessage,setForwardMessage]=useState<RootChatMessage>(),[replyTo,setReplyTo]=useState<RootChatMessage>();

 const [stickersOpen,setStickersOpen]=useState(false),[stickerPreview,setStickerPreview]=useState<Sticker>();

 const attachmentPreview=useAttachmentPreview();

 const [attachOpen,setAttachOpen]=useState(false);



 const [busy,setBusy]=useState(false),[transfers,setTransfers]=useState<Awaited<ReturnType<typeof rootAttachmentProgress>>>({jobs:[],selections:[]});

 const name=nickname(state,peer),contact=state.contacts.find(c=>c.account===peer),messages=useMemo(()=>state.messages.filter(m=>m.peer===peer&&!m.group).slice().reverse(),[state.messages,peer]);

 const composer=useRef<ChatComposerHandle>(null),sending=useRef(false);
 const setText=(next:string|((current:string)=>string))=>composer.current?.setText(next);
 useEffect(()=>{const blur=()=>composer.current?.blur();const remove=navigation.addListener('beforeRemove',blur),unfocus=navigation.addListener('blur',blur);return()=>{remove();unfocus();};},[navigation]);
 const list=useRef<FlatList<RootChatMessage>>(null),owner=localAccount.status().account;

 useEffect(()=>{if(focused&&foreground&&owner)void dismissRootConversationNotifications(owner,{peer}).catch(()=>{});},[focused,foreground,owner,peer]);

 const replyReference=replyTo?{id:replyTo.id,author:replyTo.direction==='outgoing'?owner!:peer}:undefined;

 useEffect(()=>()=>{activity.notify(peer,false);},[peer]);

 const clearReply=React.useCallback(()=>setReplyTo(undefined),[]);

 async function act(m:RootChatMessage,kind:RootActionKind,value=''){

  if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');

  await messaging.act(peer,{id:m.id,author:m.direction==='outgoing'?owner:peer},kind,value,owner);

 }

 const unread=messages.filter(m=>m.direction==='incoming'&&m.status==='delivered'&&!m.read&&!m.deleted);

 const unreadKey=unread.map(m=>m.id).sort().join(',');

 useEffect(()=>{if(!focused||!foreground||!contact?.accepted||contact.blocked||!unreadKey)return;let active=true;

  void (async()=>{for(let i=0;i<unread.length;i+=20){if(!active||AppState.currentState!=='active')return;await messaging.readMessages(peer,unread.slice(i,i+20).map(m=>m.id),owner);}})().catch(()=>{});

  return()=>{active=false;};

 },[focused,foreground,peer,unreadKey,contact?.accepted,contact?.blocked]);

 useEffect(()=>{if(!focused||!foreground)return;let active=true,running=false,last='';const refresh=async()=>{if(running)return;running=true;try{const v=await rootAttachmentProgress(),raw=JSON.stringify(v);if(active&&raw!==last){last=raw;setTransfers(v);}}catch{}finally{running=false;}};void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer);};},[focused,foreground]);

 useLayoutEffect(()=>{navigation.setOptions({headerTitleAlign:'left',headerBackVisible:false,headerTitle:'',headerLeft:()=> <ChatHeaderIdentity onBack={()=>navigation.goBack()} title={name} syncing={false} color={colors.headerText} avatarUri={state.avatarUris[peer]} isGroup={false} isOnline={activity.online.includes(peer)} onPress={()=>navigation.navigate('Contact',{peer})}/>,headerRight:()=> <View style={{flexDirection:'row',gap:8,marginRight:8}}>

  <TouchableOpacity accessibilityLabel={contact?.muted?'Unmute notifications':'Mute notifications'} onPress={()=>void conversations().configure(peer,{muted:!contact?.muted}).catch(report)} style={{width:36,height:36,borderRadius:18,backgroundColor:contact?.muted?'rgba(255,80,80,0.15)':'rgba(0,229,255,0.10)',borderWidth:1,borderColor:contact?.muted?'rgba(255,80,80,0.35)':'rgba(0,229,255,0.30)',alignItems:'center',justifyContent:'center'}}><Ionicons name={contact?.muted?'notifications-off-outline':'notifications-outline'} size={18} color={contact?.muted?'#FF5050':'#00E5FF'}/></TouchableOpacity>

  {(['video','voice'] as const).map(kind=><TouchableOpacity key={kind} testID={kind==='voice'?'axonic-voice-call':'axonic-video-call'} accessibilityLabel={kind==='voice'?'Start voice call':'Start video call'} disabled={contact?.blocked} onPress={()=>navigation.navigate('OutgoingCall',{peer,kind})} style={{width:36,height:36,borderRadius:18,backgroundColor:'rgba(0,229,255,0.10)',borderWidth:1,borderColor:'rgba(0,229,255,0.30)',alignItems:'center',justifyContent:'center',opacity:contact?.blocked?0.4:1}}><Ionicons name={kind==='voice'?'call-outline':'videocam-outline'} size={18} color="#00E5FF"/></TouchableOpacity>)}</View>});},[navigation,peer,name,colors,contact?.blocked,contact?.muted,activity.online.join(),state.avatarUris[peer]]);

 async function send(value:string){
 const input=composer.current,update=input?.setText;
 if(sending.current||busy||!value.trim()||contact?.blocked||!update)return;
 if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
 const selection=replyTo,edit=editing;
 sending.current=true;setBusy(true);input.focus();input.clear();
 try{await submitComposer(value,update,async()=>{
  if(edit){await messaging.act(peer,{id:edit.id,author:owner!},'edit',value,owner);setEditing(current=>current===edit?undefined:current);}
  else await messaging.sendText(peer,value,selection?{id:selection.id,author:selection.direction==='outgoing'?owner!:peer}:undefined,owner);
 });setReplyTo(current=>current===selection?undefined:current);list.current?.scrollToOffset({offset:0,animated:true});}
 catch(e){report(e);}finally{sending.current=false;setBusy(false);}
 }

 async function sendSticker(sticker:Sticker){if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');await messaging.sendText(peer,stickerMessage(sticker),replyReference,owner);setReplyTo(undefined);}

 async function sendImportedSticker(sticker:ImportedSticker){if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');const uri=importedStickerUri(owner,sticker),mime=await stickerFileMime(uri);if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');await queueRootAttachmentSource(peer,uri,IMPORTED_STICKER_CONTENT,mime,owner,replyReference);setReplyTo(undefined);}

 async function attach(source:'camera'|'library'|'files'){setAttachOpen(false);if(busy||contact?.blocked)return;setBusy(true);try{const selection=source==='files'?await pickRootAttachment(peer,replyReference,attachmentPreview.confirm):await pickRootMedia(peer,source,replyReference,undefined,attachmentPreview.confirm);if(selection)setReplyTo(undefined);}catch(e){report(e);}finally{setBusy(false);}}

 const messageList=useMemo(()=>(<FlatList ref={list} inverted data={messages} keyExtractor={m=>m.direction+':'+m.id} style={roomStyles.messageList} contentContainerStyle={roomStyles.messagesList} keyboardShouldPersistTaps="handled"

   renderItem={({item:m})=>{const mine=m.direction==='outgoing',sticker=!m.attachment?parseSticker(m.text):undefined,quoted=m.reply?state.messages.find(q=>q.peer===peer&&q.id===m.reply!.id&&(q.direction==='outgoing'?owner:peer)===m.reply!.author):undefined;return <ReplySwipe disabled={m.deleted||contact?.blocked} onReply={()=>{setEditing(undefined);setReplyTo(m);}}><View style={[bubbleStyles.bubbleRow,mine?bubbleStyles.bubbleRowRight:bubbleStyles.bubbleRowLeft]}><RootMessageReactions message={m} owner={owner} disabled={!!contact?.blocked} onReact={value=>void act(m,'reaction',value).catch(report)}><Pressable accessibilityLabel={!m.attachment?m.text:undefined} onLongPress={event=>{if(!m.deleted){setMenuY(event.nativeEvent.pageY);setMenu(m);}}} style={[bubbleStyles.bubble,mine?bubbleStyles.bubbleSent:bubbleStyles.bubbleReceived,{backgroundColor:mine?colors.bubbleSent:colors.bubbleReceived,borderColor:colors.neonBorder,minWidth:m.attachment?260:96},!m.deleted&&m.attachment&&bubbleStyles.mediaBubble,!m.deleted&&m.attachment?.mime.startsWith('audio/')&&bubbleStyles.voiceBubble,!m.deleted&&m.attachment&&/^(image|video)\//.test(m.attachment.mime)&&m.attachment.name!==IMPORTED_STICKER_CONTENT&&bubbleStyles.photoBubble,!m.deleted&&(sticker||m.attachment?.name===IMPORTED_STICKER_CONTENT)&&bubbleStyles.stickerBubble]}>

    {!m.deleted&&m.reply&&<View style={{borderLeftWidth:3,borderLeftColor:colors.primary,padding:8,marginBottom:6}}><Text style={{color:colors.primary,fontWeight:'600'}}>{m.reply.author===owner?'You':name}</Text><Text numberOfLines={2} style={{color:colors.textSecondary}}>{quoted?(quoted.attachment?(quoted.attachment.name===IMPORTED_STICKER_CONTENT?'Sticker':quoted.attachment.name):parseSticker(quoted.text)?'Sticker':quoted.text):'Original message unavailable on this device'}</Text></View>}

    {m.deleted?<Text style={{color:colors.textSecondary,fontStyle:'italic'}}>Message deleted</Text>:m.attachment?<RootAttachmentBubble onLongPress={event=>{setMenuY(event.nativeEvent.pageY);setMenu(m);}} audioFooter={m.attachment?.mime.startsWith('audio/')?<View style={[bubbleStyles.metaRow,{marginTop:0,flexShrink:0}]}><RootMediaSize message={m}/>{m.edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>Edited </Text>}<Text style={[bubbleStyles.timeText,{color:colors.textTertiary}]}>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text>{mine&&<Ionicons accessibilityLabel={deliveryStatusLabel(rootMessageStatus(m))} name={deliveryStatusIcon(rootMessageStatus(m))} size={13} color={rootMessageStatus(m)==='read'?colors.checkBlue:colors.textTertiary}/>}</View>:undefined} message={m} progress={transfers.jobs.find(j=>j.digest===attachmentDigest(m.attachment!.manifest))} onError={report}/>:sticker?<Pressable accessibilityLabel={sticker.label+' sticker'} onPress={()=>setStickerPreview(sticker)}><StickerArt sticker={sticker} size={CHAT_STICKER_SIZE}/></Pressable>:<SmartMessageText style={[bubbleStyles.messageText,{color:colors.text}]} linkColor={colors.primary}>{m.text}</SmartMessageText>}



    {(!m.attachment?.mime.startsWith('audio/')||m.deleted)&&<View style={bubbleStyles.metaRow}><RootMediaSize message={m}/>{m.edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>Edited </Text>}<Text style={[bubbleStyles.timeText,{color:colors.textTertiary}]}>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text>{mine&&<Ionicons accessibilityLabel={deliveryStatusLabel(rootMessageStatus(m))} name={deliveryStatusIcon(rootMessageStatus(m))} size={13} color={rootMessageStatus(m)==='read'?colors.checkBlue:colors.textTertiary}/>}</View>}

   </Pressable></RootMessageReactions></View></ReplySwipe>;}}/>),[messages,state.messages,peer,owner,name,colors,contact?.blocked,transfers.jobs]);

 return <KeyboardAvoidingScreen style={{flex:1,backgroundColor:colors.chatBg}} keyboardVerticalOffset={header}>
  <ChatConnectionBar peer={peer}/>

  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}

  {contact?.blocked?<Pressable onPress={()=>navigation.navigate('Contact',{peer})}><Text style={{color:colors.error,padding:12}}>This identity is blocked. Tap to manage.</Text></Pressable>:contact&&!contact.accepted&&messages.some(m=>m.direction==='incoming')?<View style={[roomStyles.requestBanner,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><Text style={{color:colors.text,flex:1}}>Message request</Text><Pressable accessibilityLabel="Accept message request" onPress={()=>void conversations().configure(peer,{accepted:true}).catch(report)}><Text style={{color:colors.primary}}>Accept</Text></Pressable><Pressable accessibilityLabel="Reject message request" accessibilityHint="Block this identity. You can unblock it in user details." onPress={()=>void conversations().configure(peer,{accepted:false,blocked:true}).catch(report)} style={{marginLeft:16}}><Text style={{color:colors.error}}>Reject</Text></Pressable></View>:null}

  {messageList}

  {activity.typing.includes(peer)&&<Text style={{color:colors.primary,paddingHorizontal:16,paddingVertical:4}}>{name} is typing…</Text>}

  {transfers.selections.filter(s=>s.peer===peer).map(s=><View key={s.id} style={{padding:8,backgroundColor:colors.surface}}><Text style={{color:colors.textSecondary}}>{s.name} · {s.failed?'Could not prepare attachment':'Preparing attachment…'}</Text>{s.failed&&<View style={{flexDirection:'row',gap:20}}><Pressable onPress={()=>void retryRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Retry</Text></Pressable><Pressable onPress={()=>void removeRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Remove</Text></Pressable></View>}</View>)}

  {stickersOpen&&owner&&<StickerPicker ownerId={owner} initialUri={stickerSource} draftStorage={rootStickerDraft(owner)} onClose={()=>{setStickersOpen(false);setStickerSource(undefined);}} onSend={sendSticker} onSendImported={sendImportedSticker}/>}

  {stickerPreview&&owner&&<StickerPreview sticker={stickerPreview} userId={owner} onClose={()=>setStickerPreview(undefined)}/>}

  {menu&&<RootMessageMenu message={menu} onMediaChanged={()=>setTransfers(current=>({...current}))} createSticker={uri=>{setStickerSource(uri);setStickersOpen(true);}} pageY={menuY} info={()=>navigation.navigate('MessageInfo',{peer:menu.peer,id:menu.id,direction:menu.direction})} close={()=>setMenu(undefined)} copy={()=>void Clipboard.setStringAsync(menu.text).catch(report)}

    reply={()=>{setEditing(undefined);setReplyTo(menu);}} forward={()=>setForwardMessage(menu)}

    edit={()=>{setReplyTo(undefined);setEditing(menu);setText(menu.text);}}

    remove={()=>Alert.alert('Delete message?','The message will be shown as deleted on both devices.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void act(menu,'delete').catch(report)}])}

    react={value=>void act(menu,'reaction',value).catch(report)}/>}

  {editing&&<View style={[roomStyles.replyPreview,{backgroundColor:colors.surface,borderLeftColor:colors.primary}]}><Text style={{color:colors.primary,flex:1}}>Editing message</Text><Pressable accessibilityLabel="Cancel edit" onPress={()=>{setEditing(undefined);setText('');}}><Ionicons name="close" size={22} color={colors.text}/></Pressable></View>}

  {forwardMessage&&<RootForwardPicker message={forwardMessage} contacts={state.contacts} groups={state.groups} onClose={()=>setForwardMessage(undefined)}/>}

  {attachmentPreview.modal}

  <AttachmentMenu visible={attachOpen} onClose={()=>setAttachOpen(false)} onCamera={()=>void attach('camera')} onMultimedia={()=>void attach('library')} onFiles={()=>void attach('files')}/>

  {replyTo&&<View style={[roomStyles.replyPreview,{backgroundColor:colors.surface,borderLeftColor:colors.primary}]}><View style={{flex:1}}><Text style={[roomStyles.replyPreviewName,{color:colors.primary}]}>{replyTo.direction==='outgoing'?'Replying to yourself':'Replying to '+name}</Text><Text numberOfLines={2} style={[roomStyles.replyPreviewText,{color:colors.textSecondary}]}>{replyTo.attachment?.name===IMPORTED_STICKER_CONTENT||parseSticker(replyTo.text)?'Sticker':replyTo.text}</Text></View><Pressable accessibilityLabel="Cancel reply" onPress={()=>setReplyTo(undefined)} style={roomStyles.replyPreviewClose}><Ionicons name="close" size={22} color={colors.text}/></Pressable></View>}

  <ChatComposer ref={composer} owner={owner} peer={peer} disabled={busy||!!contact?.blocked} cannotCompose={!!contact?.blocked} editing={!!editing} reply={replyReference} onSend={send} onAttach={()=>setAttachOpen(true)} onStickers={()=>setStickersOpen(true)} onSent={clearReply} onTyping={value=>activity.notify(peer,value)} onError={report}/>

 </KeyboardAvoidingScreen>;

}

function Contact({route,navigation}:Screen<'Contact'>){

 const {colors}=useTheme(),{state,error}=useOwnChat(),peer=route.params.peer,contact=state.contacts.find(c=>c.account===peer);

 const identity=displayIdentity(peer),name=contact?.alias||shortIdentity(peer);

 const header=useHeaderHeight(),insets=useSafeAreaInsets();

 const [alias,setAlias]=useState<string|null>(null),[saving,setSaving]=useState(false),[qrOpen,setQrOpen]=useState(false);
 const {width,height}=useWindowDimensions();
 const qrSize=Math.max(1,Math.min(width-insets.left-insets.right-64,height-insets.top-insets.bottom-160,480));

 useEffect(()=>{setAlias(null);setQrOpen(false);},[peer]);

 async function save(){if(alias===null||saving)return;setSaving(true);try{await conversations().configure(peer,{alias});setAlias(null);Alert.alert('Nickname saved','Only you see this name on this phone.');}catch(e){report(e);}finally{setSaving(false);}}

 const Action=({icon,label,onPress}:{icon:React.ComponentProps<typeof Ionicons>['name'];label:string;onPress:()=>void})=><TouchableOpacity style={infoStyles.action} activeOpacity={0.72} accessibilityLabel={label} onPress={onPress}><View style={[infoStyles.actionIcon,{borderColor:colors.neonBorder,backgroundColor:colors.highlight}]}><Ionicons name={icon} size={23} color={colors.primary}/></View><Text style={[infoStyles.actionLabel,{color:colors.text}]}>{label}</Text></TouchableOpacity>;

 const section={backgroundColor:colors.surface,borderColor:colors.neonBorder};

 return <KeyboardFormScrollView keyboardVerticalOffset={header} style={{backgroundColor:colors.background}} contentContainerStyle={[infoStyles.content,{paddingBottom:insets.bottom+24}]}>

  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}

  <View style={[infoStyles.hero,section]}>

   <View style={infoStyles.identityHeading}><Avatar name={name} uri={state.avatarUris[peer]} size={64}/><View style={infoStyles.identityHeadingText}><Text selectable style={[infoStyles.name,{color:colors.text}]}>{name}</Text>

   {!!contact?.alias&&<Text selectable style={[infoStyles.username,{color:colors.textSecondary}]}>{shortIdentity(peer)}</Text>}</View></View>

   <View style={[infoStyles.divider,{backgroundColor:colors.divider}]}/><View style={infoStyles.actions}>

    <Action icon="chatbubble-ellipses-outline" label="Message" onPress={()=>navigation.navigate('ChatRoom',{peer})}/>

    <Action icon="call-outline" label="Voice" onPress={()=>{if(contact?.blocked){report('Unblock this identity before calling');return;}navigation.navigate('OutgoingCall',{peer,kind:'voice'});}}/>

    <Action icon="videocam-outline" label="Video" onPress={()=>{if(contact?.blocked){report('Unblock this identity before calling');return;}navigation.navigate('OutgoingCall',{peer,kind:'video'});}}/>

   </View>

  </View>

  <View style={[infoStyles.section,section]}>

   <Text style={[infoStyles.sectionLabel,{color:colors.textSecondary}]}>PRIVATE NICKNAME</Text><Text style={{color:colors.textSecondary}}>Only you see this name on this phone. Clear it to use their Axonic ID again.</Text>

   <TextInput accessibilityLabel="Private nickname" value={alias??contact?.alias??''} onChangeText={setAlias} editable={!saving} maxLength={80} placeholder="Enter a private nickname" placeholderTextColor={colors.textTertiary} style={{color:colors.text,padding:12,borderWidth:1,borderColor:colors.neonBorder,borderRadius:10}}/>

   <TouchableOpacity disabled={saving||alias===null} onPress={()=>void save()}><Text style={{color:colors.primary,fontWeight:'700',opacity:saving||alias===null?0.5:1}}>{saving?'Saving…':'Save nickname'}</Text></TouchableOpacity>

  </View>

  <View style={[infoStyles.section,section]}>

   <Text style={[infoStyles.sectionLabel,{color:colors.textSecondary}]}>AXONIC PROFILE</Text>

   <View style={infoStyles.detailRow}><Ionicons name="finger-print-outline" size={20} color={colors.primary}/><View style={infoStyles.detailText}><Text style={[infoStyles.detailLabel,{color:colors.textSecondary}]}>Axonic ID</Text><Text selectable style={[infoStyles.detailValue,{color:colors.text}]}>{identity}</Text></View></View>

   <View style={[infoStyles.actions,{alignItems:'center'}]}><Action icon="copy-outline" label="Copy ID" onPress={()=>void Clipboard.setStringAsync(identity).catch(report)}/><TouchableOpacity accessibilityRole="button" accessibilityLabel="Enlarge public identity QR code" onPress={()=>{Keyboard.dismiss();setQrOpen(true);}} style={infoStyles.qrBox}><QRCode value={identity} size={80} backgroundColor="#fff" color="#000"/></TouchableOpacity><Action icon="share-outline" label="Share ID" onPress={()=>void Share.share({message:identityLink(identity)}).catch(report)}/></View>

  </View>

  <TouchableOpacity style={[infoStyles.setting,section]} activeOpacity={0.72} onPress={()=>void conversations().configure(peer,{muted:!contact?.muted}).catch(report)}>

   <Ionicons name={contact?.muted?'notifications-off-outline':'notifications-outline'} size={21} color={colors.primary}/><Text style={[infoStyles.settingText,{color:colors.text}]}>{contact?.muted?'Unmute notifications':'Mute notifications'}</Text><Ionicons name="chevron-forward" size={19} color={colors.textTertiary}/>

  </TouchableOpacity>

  <TouchableOpacity style={[infoStyles.setting,section]} activeOpacity={0.72} onPress={()=>void conversations().configure(peer,{blocked:!contact?.blocked}).catch(report)}>

   <Ionicons name="ban-outline" size={21} color={colors.error}/><Text style={[infoStyles.settingText,{color:colors.error}]}>{contact?.blocked?'Unblock':'Block'}</Text><Ionicons name="chevron-forward" size={19} color={colors.textTertiary}/>

  </TouchableOpacity>

 <Modal visible={qrOpen} animationType="fade" onRequestClose={()=>setQrOpen(false)}><TouchableOpacity activeOpacity={1} accessibilityRole="button" accessibilityLabel="Close enlarged QR code" onPress={()=>setQrOpen(false)} style={[infoStyles.qrScreen,{backgroundColor:colors.background,paddingTop:insets.top+24,paddingBottom:insets.bottom+24}]}><Text style={{color:colors.text,fontSize:22,fontWeight:'700'}}>{name}</Text><View style={infoStyles.qrBox}><QRCode value={identity} size={qrSize} backgroundColor="#fff" color="#000"/></View><Text style={{color:colors.textSecondary}}>Tap anywhere to return</Text></TouchableOpacity></Modal>
 </KeyboardFormScrollView>;

}

function NewChat({navigation,route}:Screen<'NewChat'>){

 const {colors}=useTheme(),[peer,setPeer]=useState(route.params?.identity??''),[busy,setBusy]=useState(false);

 useEffect(()=>{if(route.params?.identity)setPeer(route.params.identity);},[route.params?.identity]);

 async function open(value=peer){if(busy)return;setBusy(true);try{const account=parseIdentityInput(value);if(!account||account===localAccount.status().account)throw Error('Paste another person’s complete identity code or identity link');await conversations().configure(account,{accepted:true});navigation.replace('ChatRoom',{peer:account});}catch(e){report(e);}finally{setBusy(false);}}

 const identity=parseIdentityInput(peer),ownIdentity=identity===localAccount.status().account;
 const canStart=!!identity&&!ownIdentity;

 return <KeyboardAvoidingScreen style={[contactStyles.container,{backgroundColor:colors.background}]}>

  <View style={contactStyles.searchBar}><View style={{flex:1}}><Input accessibilityLabel="Identity code or link" placeholder="Paste an ID or identity link…" autoCapitalize="none" autoCorrect={false} value={peer} onChangeText={setPeer} containerStyle={contactStyles.searchInput}/></View><RootIdentityScanner compact onIdentity={account=>void open(displayIdentity(account))}/></View>

  {!peer.length&&<TouchableOpacity style={[contactStyles.item,{borderBottomWidth:1,borderBottomColor:colors.divider}]} onPress={()=>navigation.navigate('GroupCreate')}><Ionicons name="people-outline" size={26} color={colors.primary}/><Text style={[contactStyles.name,{color:colors.primary,marginLeft:Spacing.md}]}>New group</Text></TouchableOpacity>}

  {canStart?<View style={{padding:Spacing.md}}><Button title="START CHAT" loading={busy} onPress={()=>void open()}/></View>:<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:Spacing.lg,gap:12}}>
   <Ionicons name="chatbubble-ellipses-outline" size={42} color={colors.textTertiary}/>
   <Text style={{color:colors.text,fontSize:18,fontWeight:'600',textAlign:'center'}}>Start a new conversation</Text>
   <Text style={{color:colors.textSecondary,fontSize:14,lineHeight:22,textAlign:'center',maxWidth:320}}>Ask the person to share their Axonic ID or identity link. Paste it above, or tap the QR button to scan their identity.</Text>
   {ownIdentity&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>This is your identity. Paste someone else’s ID.</Text>}
  </View>}

 </KeyboardAvoidingScreen>;

}

function formatHistoryTime(at:number){const date=dayjs(at),now=dayjs();return date.isSame(now,'day')?date.format('HH:mm'):date.isSame(now.subtract(1,'day'),'day')?'Yesterday':date.format('DD/MM/YY');}

function Calls({navigation}:Screen<'Tabs'>){

 const {colors}=useTheme(),{state}=useOwnChat(),[rows,setRows]=useState<OwnCallSummary[]>([]),[error,setError]=useState('');

 const focused=useIsFocused();
 useForegroundPoll(async current=>{const owner=localAccount.status().account;if(!owner)return;try{const result=await listOwnCallHistory(owner);if(current()&&localAccount.status().account===owner){setRows(previous=>JSON.stringify(previous)===JSON.stringify(result)?previous:result);setError('');}}catch{if(current())setError('Unable to read call history');}},3000,focused);

 return <View style={[callStyles.container,{backgroundColor:colors.background}]}>{!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}<FlatList data={rows} keyExtractor={r=>r.id} contentContainerStyle={rows.length?callStyles.list:callStyles.emptyContainer} ListEmptyComponent={<EmptyState iconName="call-outline" title="No call history" subtitle="Start a call from a chat conversation"/>} ItemSeparatorComponent={()=><View style={[callStyles.separator,{backgroundColor:colors.divider}]}/>} renderItem={({item:r})=><TouchableOpacity accessibilityLabel={`Call ${nickname(state,r.peer)}`} onPress={()=>navigation.navigate('OutgoingCall',{peer:r.peer,kind:r.media})} activeOpacity={0.7} style={[callStyles.callItem,{borderColor:colors.neonBorder}]}><View style={[callStyles.accentBar,{backgroundColor:colors.primary}]}/><Avatar name={nickname(state,r.peer)} uri={state.avatarUris[r.peer]} size={46}/><View style={callStyles.callInfo}><Text numberOfLines={1} style={[callStyles.callName,{color:colors.text}]}>{nickname(state,r.peer).toUpperCase()}</Text><View style={callStyles.callMeta}><Text style={[callStyles.directionTag,{color:colors.primary,borderColor:colors.primary}]}>{r.outgoing?'OUT':'IN'}</Text><Text style={[callStyles.callType,{color:colors.textSecondary}]}>{r.media==='video'?'VIDEO':'AUDIO'}</Text></View></View><View style={callStyles.callRight}><Text style={[callStyles.callTime,{color:colors.primary}]}>{formatHistoryTime(r.at)}</Text><View style={[callStyles.callbackBtn,{borderColor:colors.primary}]}><Ionicons name={r.media==='video'?'videocam-outline':'call-outline'} size={16} color={colors.primary}/></View></View></TouchableOpacity>}/></View>;

}

function BlockedUsers(){const {colors}=useTheme(),{state}=useOwnChat();return <FlatList style={{flex:1,backgroundColor:colors.background}} data={state.contacts.filter(c=>c.blocked)} keyExtractor={c=>c.account} contentContainerStyle={state.contacts.some(c=>c.blocked)?contactStyles.list:contactStyles.emptyContainer} ListEmptyComponent={<EmptyState iconName="ban-outline" title="No blocked users"/>} renderItem={({item:c})=><View style={contactStyles.item}><Avatar name={c.alias||shortIdentity(c.account)} uri={state.avatarUris[c.account]} size={46}/><View style={contactStyles.info}><Text style={[contactStyles.name,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text><Text style={[contactStyles.sub,{color:colors.textSecondary}]}>{shortIdentity(c.account)}</Text></View><TouchableOpacity accessibilityLabel="Unblock user" onPress={()=>Alert.alert('Unblock user?',`Unblock ${c.alias||shortIdentity(c.account)}? They will be able to message and call you again.`,[{text:'Cancel',style:'cancel'},{text:'Unblock',onPress:()=>void conversations().configure(c.account,{blocked:false}).catch(report)}])}><Text style={{color:colors.primary}}>Unblock</Text></TouchableOpacity></View>}/>;}

function MessageInfo({route}:Screen<'MessageInfo'>){
 const {colors}=useTheme(),{state}=useOwnChat(),message=state.messages.find(m=>m.peer===route.params.peer&&m.id===route.params.id&&m.direction===route.params.direction),insets=useSafeAreaInsets();
 const tracked=useMemo(()=>message?[message]:[],[message]),now=useMessageStateClock(tracked);
 return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:18,paddingBottom:insets.bottom+24,gap:20}}>{message?<><View style={{padding:16,borderRadius:16,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface,gap:14}}><Text selectable style={{color:colors.text,fontSize:17}}>{message.deleted?'This message was deleted.':message.attachment?.name||message.text}</Text><Text style={{color:colors.textSecondary}}>From</Text><Text style={{color:colors.text}}>{message.direction==='outgoing'?'You':nickname(state,message.peer)}</Text><Text style={{color:colors.textSecondary}}>Created</Text><Text style={{color:colors.text}}>{new Date(message.at).toLocaleString()}</Text><Text style={{color:colors.textSecondary}}>Type</Text><Text style={{color:colors.text}}>{message.attachment?.mime||'Text'}</Text></View><Text style={{color:colors.primary,fontSize:18,fontWeight:'700'}}>{deliveryStatusLabel(rootMessageStatus(message,now))}</Text><Text style={{color:colors.textSecondary}}>{messageInfoDescription(message,now)}</Text><MessageStatusTimes message={message} now={now}/></>:<Text style={{color:colors.textSecondary}}>This message is no longer stored on this phone.</Text>}</ScrollView>;
}

function OutgoingCall({route,navigation}:Screen<'OutgoingCall'>){

 const {state}=useOwnChat(),[busy,setBusy]=useState(false),[finding,setFinding]=useState(false),[error,setError]=useState(''),lock=useRef(false),proceed=useRef(false),mounted=useRef(true),callId=useRef<string|null>(null);
 const cancel=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const id=callId.current;if(id)await localAccountCalls()?.end(id);if(mounted.current){proceed.current=true;navigation.goBack();}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to cancel call');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>navigation.addListener('beforeRemove',event=>{
  if(proceed.current)return;if(lock.current){event.preventDefault();return;}
  if(callId.current){event.preventDefault();void cancel();}
 }),[navigation]);
 const update=useCallback((call:ReturnType<NonNullable<ReturnType<typeof localAccountCalls>>['snapshot']>)=>{
  if(!mounted.current||proceed.current||!callId.current||call?.id!==callId.current)return;
  if(call.status==='finding'){setFinding(true);return;}
  setFinding(false);
  if(call.status==='ended'){callId.current=null;setError(call.reason||'Peer unavailable');return;}
  proceed.current=true;navigation.goBack();
 },[navigation]);
 useEffect(()=>subscribeLocalAccountCalls(update),[update]);
 async function start(){if(lock.current||callId.current)return;lock.current=true;setBusy(true);setError('');try{
  const contact=state.contacts.find(c=>c.account===route.params.peer);if(contact?.blocked)throw Error('Unblock this identity before calling');
  const calls=localAccountCalls();if(calls?.snapshot()&&calls.snapshot()?.status!=='ended')throw Error('Finish your current call before starting another.');
  const id=await startCall(route.params.peer,route.params.kind);callId.current=id;
  if(mounted.current){setFinding(true);update(localAccountCalls()?.snapshot()??null);}
  else void localAccountCalls()?.end(id).catch(()=>{});
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to start call');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 return <OutgoingCallAppearance name={nickname(state,route.params.peer)} kind={route.params.kind} busy={busy} finding={finding} error={error} start={()=>void start()} cancel={()=>void cancel()}/>;

}

export default function RootAccountNavigator({profile,network}:{profile:React.ReactNode;network:React.ReactNode}){

 const {colors,isDark}=useTheme(),options=useMainTabOptions(),base=isDark?DarkTheme:DefaultTheme;

 const ref=useRef(createNavigationContainerRef<Routes>()).current;

 const visibleRoom=useRef<string|null>(null);
 const visible=()=>{const route=ref.getCurrentRoute(),room=route&&['ChatRoom','GroupRoom'].includes(route.name)?route.key:null;if(visibleRoom.current&&visibleRoom.current!==room)Keyboard.dismiss();visibleRoom.current=room;setRootVisibleConversation(route?.name==='ChatRoom'?{peer:(route.params as Routes['ChatRoom']).peer}:route?.name==='GroupRoom'?{group:(route.params as Routes['GroupRoom']).id}:null);};

 useEffect(()=>{

  let alive=true,opening=false;

  const open=async()=>{if(AppState.currentState!=='active'||opening||!alive||!ref.isReady()||localAccount.status().state!=='unlocked')return;opening=true;

   try{const link=takeIdentityLink();if(link&&link!==localAccount.status().account){ref.navigate('NewChat',{identity:displayIdentity(link)});return;}const account=localAccount.status().account!,target=await pendingRootNotificationOpen(account);if(!target||!alive||AppState.currentState!=='active'||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;

    const state=await conversations().snapshot();if(!alive||AppState.currentState!=='active'||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;

    if(target.inbox)ref.navigate('Tabs',{screen:'Chats'});else if(target.group&&state.groups?.some(g=>g.id===target.group))ref.navigate('GroupRoom',{id:target.group});else ref.navigate('ChatRoom',{peer:target.sender});

    await finishRootNotificationOpen();

   }catch{}finally{opening=false;}};

  const stop=notifee.onForegroundEvent(({type,detail})=>{if(type===EventType.PRESS)void queueRootNotificationOpen(detail.notification?.data).then(open).catch(()=>{});else if(type===EventType.ACTION_PRESS)void handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data,detail.input).catch(report);});

  void notifee.getInitialNotification().then(initial=>initial?queueRootNotificationOpen(initial.notification.data):undefined).then(open).catch(()=>{});

  let timer:ReturnType<typeof setInterval>|undefined;const resume=()=>{if(timer!==undefined)clearInterval(timer);timer=undefined;if(AppState.currentState==='active'){void open();timer=setInterval(()=>void open(),600);}};const appState=AppState.addEventListener('change',resume);resume();return()=>{alive=false;if(timer!==undefined)clearInterval(timer);appState.remove();stop();setRootVisibleConversation(null);};

 },[ref]);

 return <><NavigationContainer ref={ref} onReady={visible} onStateChange={visible} theme={{...base,colors:{...base.colors,background:colors.background,card:colors.headerBg,text:colors.text,primary:colors.primary,border:colors.neonBorder}}}>

  <Stack.Navigator screenOptions={{headerStyle:{backgroundColor:colors.headerBg},headerTintColor:colors.headerText,headerTitleStyle:{...Font.semiBold,color:colors.headerText},contentStyle:{backgroundColor:colors.background}}}>

   <Stack.Screen name="Tabs" options={{headerShown:false}}>{props=><Tabs.Navigator detachInactiveScreens={false} screenOptions={options}><Tabs.Screen name="Chats" options={{headerTitle:'AXONIC'}}>{()=> <ChatList {...props}/>}</Tabs.Screen><Tabs.Screen name="Calls" options={{headerTitle:'CALLS'}}>{()=> <Calls {...props}/>}</Tabs.Screen><Tabs.Screen name="Profile" options={{headerTitle:'PROFILE'}}>{()=> <>{profile}</>}</Tabs.Screen></Tabs.Navigator>}</Stack.Screen>

   <Stack.Screen name="ChatRoom" component={ChatRoom}/><Stack.Screen name="NewChat" component={NewChat} options={{title:'New chat'}}/><Stack.Screen name="Contact" component={Contact} options={{title:'User details'}}/>

   <Stack.Screen name="GroupCreate" component={RootGroupCreate} options={{title:'New group'}}/><Stack.Screen name="GroupRoom" component={RootGroupRoom}/><Stack.Screen name="GroupMessageInfo" component={RootGroupMessageInfo} options={{title:'Message info'}}/><Stack.Screen name="GroupInfo" component={RootGroupInfo} options={{title:'Group information'}}/>

   <Stack.Screen name="ChatStorage" component={RootChatStorageScreen} options={{title:'Chat storage'}}/>

   <Stack.Screen name="BlockedUsers" component={BlockedUsers} options={{title:'Blocked users'}}/>

   <Stack.Screen name="MessageInfo" component={MessageInfo} options={{title:'Message info'}}/>

   <Stack.Screen name="OutgoingCall" component={OutgoingCall} options={{headerShown:false,presentation:'transparentModal',animation:'slide_from_bottom',contentStyle:{backgroundColor:'transparent'},gestureEnabled:false}}/>

   <Stack.Screen name="Network" options={{title:'Network'}}>{()=> <ScrollView contentContainerStyle={{padding:24,gap:16}}>{network}</ScrollView>}</Stack.Screen>

  </Stack.Navigator>

 </NavigationContainer><RootSharePicker onSent={target=>{if(ref.isReady())target.startsWith('group:')?ref.navigate('GroupRoom',{id:target.slice(6)}):ref.navigate('ChatRoom',{peer:target});}}/><RootMessageToast/></>;

}

