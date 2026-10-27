import {pendingMessages} from '../../modules/messaging';
import {ChatComposer,type ChatComposerHandle} from '../../components/chat/ChatComposer';
import {createMessageTimeFormatter} from '../../utils/message-time';
import {submitComposer} from '../../components/chat/submitComposer';
import RootMediaSize from '../../components/chat/RootMediaSize';
import RootMessageReactions from '../../components/chat/RootMessageReactions';
import {dismissRootConversationNotifications} from '../../modules/messaging/notifications';
import {KeyboardAvoidingScreen} from '../../components/ui/KeyboardForm';
import {useChatActivity} from '../../modules/ui/useChatActivity';
import {useChatSnapshot as useOwnChat,useChatLayoutTiming} from '../../modules/ui/useChatSnapshot';
import ChatConnectionBar from '../../components/chat/ChatConnectionBar';
import {useAttachmentPreview} from '../../components/chat/AttachmentPreview';
import {rootMessageStatus,deliveryStatusIcon,deliveryStatusLabel} from '../../modules/messaging';
import {pickRootAttachment} from '../../modules/ui/documentPicker';
import ReplySwipe from '../../components/chat/ReplySwipe';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import SmartMessageText from '../../components/SmartMessageText';
import ChatHeaderIdentity from '../../components/chat/ChatHeaderIdentity';
import RootMessageMenu from '../../components/chat/RootMessageMenu';
import {type RootActionKind} from '../../modules/messaging';
import RootForwardPicker from '../../components/chat/RootForwardPicker';
import {rootStickerDraft} from '../../modules/messaging';
import StickerPicker from '../../components/chat/sticker-picker';
import StickerArt from '../../components/chat/sticker-art';
import StickerPreview from '../../components/chat/sticker-preview';
import {stickerMessage,parseSticker,type Sticker} from '../../services/stickers';
import {importedStickerUri,stickerFileMime,type ImportedSticker} from '../../services/imported-stickers';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import AttachmentMenu from '../../components/chat/AttachmentMenu';
import {pickRootMedia} from '../../modules/ui/mediaPicker';
import * as Clipboard from 'expo-clipboard';
import React,{useMemo,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AppState,FlatList,Pressable,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useHeaderHeight} from '@react-navigation/elements';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {chatRoomStyles as roomStyles} from '../../components/chat/chat-room-styles';
import {CHAT_STICKER_SIZE,messageBubbleStyles as bubbleStyles} from '../../components/chat/message-bubble-styles';
import RootAttachmentBubble from '../../components/RootAttachmentBubble';
import {messaging} from '../../modules/messaging';
import {localAccount} from '../../modules/identity';
import {conversations} from '../../modules/messaging';
import type {RootChatMessage} from '../../modules/messaging';
import {messageListRendering} from '../../components/chat/message-list-rendering';
import {queueRootAttachmentSource,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../../modules/media';
import {useTransferState} from '../../modules/ui/transferState';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report,nickname} from '../rootScreenSupport';
export default function ChatRoom({route,navigation}:Screen<'ChatRoom'>){

 const activity=useChatActivity();

 const peer=route.params.peer,{colors}=useTheme(),{state,error}=useOwnChat(peer),header=useHeaderHeight();
 const onChatLayout=useChatLayoutTiming('private_chat_layout');

 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const messageTime=useMemo(()=>createMessageTimeFormatter(),[focused,foreground]);

 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);

 const [stickerSource,setStickerSource]=useState<string>();
 const [menuY,setMenuY]=useState(0),[menu,setMenu]=useState<RootChatMessage>(),[editing,setEditing]=useState<RootChatMessage>();

 const [forwardMessage,setForwardMessage]=useState<RootChatMessage>(),[replyTo,setReplyTo]=useState<RootChatMessage>();

 const [stickersOpen,setStickersOpen]=useState(false),[stickerPreview,setStickerPreview]=useState<Sticker>();

 const attachmentPreview=useAttachmentPreview();

 const [attachOpen,setAttachOpen]=useState(false);



 const [busy,setBusy]=useState(false),transfers=useTransferState();
 const [mediaRevision,refreshMedia]=React.useReducer((n:number)=>n+1,0);

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


 const messageList=useMemo(()=>(<FlatList {...messageListRendering} ref={list} inverted data={messages} keyExtractor={m=>m.direction+':'+m.id} style={roomStyles.messageList} contentContainerStyle={roomStyles.messagesList} keyboardShouldPersistTaps="handled"

   renderItem={({item:m})=>{const mine=m.direction==='outgoing',sticker=!m.attachment?parseSticker(m.text):undefined,quoted=m.reply?state.messages.find(q=>q.peer===peer&&q.id===m.reply!.id&&(q.direction==='outgoing'?owner:peer)===m.reply!.author):undefined;return <ReplySwipe disabled={m.deleted||contact?.blocked||m.localPending} onReply={()=>{setEditing(undefined);setReplyTo(m);}}><View onLayout={()=>pendingMessages.laidOut(owner,m.group?.messageId??m.id)} style={[bubbleStyles.bubbleRow,mine?bubbleStyles.bubbleRowRight:bubbleStyles.bubbleRowLeft]}><RootMessageReactions message={m} owner={owner} disabled={!!contact?.blocked||m.localPending} onReact={value=>void act(m,'reaction',value).catch(report)}><Pressable accessibilityLabel={!m.attachment?m.text:undefined} onLongPress={event=>{if(!m.deleted&&!m.localPending){setMenuY(event.nativeEvent.pageY);setMenu(m);}}} style={[bubbleStyles.bubble,mine?bubbleStyles.bubbleSent:bubbleStyles.bubbleReceived,{backgroundColor:mine?colors.bubbleSent:colors.bubbleReceived,borderColor:colors.neonBorder,minWidth:m.attachment?260:96},!m.deleted&&m.attachment&&bubbleStyles.mediaBubble,!m.deleted&&m.attachment?.mime.startsWith('audio/')&&bubbleStyles.voiceBubble,!m.deleted&&m.attachment&&/^(image|video)\//.test(m.attachment.mime)&&m.attachment.name!==IMPORTED_STICKER_CONTENT&&bubbleStyles.photoBubble,!m.deleted&&(sticker||m.attachment?.name===IMPORTED_STICKER_CONTENT)&&bubbleStyles.stickerBubble]}>

    {!m.deleted&&m.reply&&<View style={{borderLeftWidth:3,borderLeftColor:colors.primary,padding:8,marginBottom:6}}><Text style={{color:colors.primary,fontWeight:'600'}}>{m.reply.author===owner?'You':name}</Text><Text numberOfLines={2} style={{color:colors.textSecondary}}>{quoted?(quoted.attachment?(quoted.attachment.name===IMPORTED_STICKER_CONTENT?'Sticker':quoted.attachment.name):parseSticker(quoted.text)?'Sticker':quoted.text):'Original message unavailable on this device'}</Text></View>}

    {m.deleted?<Text style={{color:colors.textSecondary,fontStyle:'italic'}}>Message deleted</Text>:m.attachment?<RootAttachmentBubble onLongPress={event=>{setMenuY(event.nativeEvent.pageY);setMenu(m);}} audioFooter={m.attachment?.mime.startsWith('audio/')?<View style={[bubbleStyles.metaRow,{marginTop:0,flexShrink:0}]}><RootMediaSize message={m}/>{m.edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>Edited </Text>}<Text style={[bubbleStyles.timeText,{color:colors.textTertiary}]}>{messageTime(m.at)}</Text>{mine&&<Ionicons accessibilityLabel={deliveryStatusLabel(rootMessageStatus(m))} name={deliveryStatusIcon(rootMessageStatus(m))} size={13} color={rootMessageStatus(m)==='read'?colors.checkBlue:colors.textTertiary}/>}</View>:undefined} message={m} onError={report}/>:sticker?<Pressable accessibilityLabel={sticker.label+' sticker'} onPress={()=>setStickerPreview(sticker)}><StickerArt sticker={sticker} size={CHAT_STICKER_SIZE}/></Pressable>:<SmartMessageText style={[bubbleStyles.messageText,{color:colors.text}]} linkColor={colors.primary}>{m.text}</SmartMessageText>}



    {(!m.attachment?.mime.startsWith('audio/')||m.deleted)&&<View style={bubbleStyles.metaRow}><RootMediaSize message={m}/>{m.edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>Edited </Text>}<Text style={[bubbleStyles.timeText,{color:colors.textTertiary}]}>{messageTime(m.at)}</Text>{mine&&<Ionicons accessibilityLabel={deliveryStatusLabel(rootMessageStatus(m))} name={deliveryStatusIcon(rootMessageStatus(m))} size={13} color={rootMessageStatus(m)==='read'?colors.checkBlue:colors.textTertiary}/>}</View>}

   </Pressable></RootMessageReactions></View></ReplySwipe>;}}/>),[messages,state.messages,peer,owner,name,colors,contact?.blocked,mediaRevision,messageTime]);

 return <KeyboardAvoidingScreen onLayout={onChatLayout} style={{flex:1,backgroundColor:colors.chatBg}} keyboardVerticalOffset={header}>
  <ChatConnectionBar peer={peer}/>

  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}

  {contact?.blocked?<Pressable onPress={()=>navigation.navigate('Contact',{peer})}><Text style={{color:colors.error,padding:12}}>This identity is blocked. Tap to manage.</Text></Pressable>:contact&&!contact.accepted&&messages.some(m=>m.direction==='incoming')?<View style={[roomStyles.requestBanner,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><Text style={{color:colors.text,flex:1}}>Message request</Text><Pressable accessibilityLabel="Accept message request" onPress={()=>void conversations().configure(peer,{accepted:true}).catch(report)}><Text style={{color:colors.primary}}>Accept</Text></Pressable><Pressable accessibilityLabel="Reject message request" accessibilityHint="Block this identity. You can unblock it in user details." onPress={()=>void conversations().configure(peer,{accepted:false,blocked:true}).catch(report)} style={{marginLeft:16}}><Text style={{color:colors.error}}>Reject</Text></Pressable></View>:null}

  {messageList}

  {activity.typing.includes(peer)&&<Text style={{color:colors.primary,paddingHorizontal:16,paddingVertical:4}}>{name} is typing…</Text>}

  {transfers.selections.filter(s=>s.peer===peer).map(s=><View key={s.id} style={{padding:8,backgroundColor:colors.surface}}><Text style={{color:colors.textSecondary}}>{s.name} · {s.failed?'Could not prepare attachment':'Preparing attachment…'}</Text>{s.failed&&<View style={{flexDirection:'row',gap:20}}><Pressable onPress={()=>void retryRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Retry</Text></Pressable><Pressable onPress={()=>void removeRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Remove</Text></Pressable></View>}</View>)}

  {stickersOpen&&owner&&<StickerPicker ownerId={owner} initialUri={stickerSource} draftStorage={rootStickerDraft(owner)} onClose={()=>{setStickersOpen(false);setStickerSource(undefined);}} onSend={sendSticker} onSendImported={sendImportedSticker}/>}

  {stickerPreview&&owner&&<StickerPreview sticker={stickerPreview} userId={owner} onClose={()=>setStickerPreview(undefined)}/>}

  {menu&&<RootMessageMenu message={menu} onMediaChanged={refreshMedia} createSticker={uri=>{setStickerSource(uri);setStickersOpen(true);}} pageY={menuY} info={()=>navigation.navigate('MessageInfo',{peer:menu.peer,id:menu.id,direction:menu.direction})} close={()=>setMenu(undefined)} copy={()=>void Clipboard.setStringAsync(menu.text).catch(report)}

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
