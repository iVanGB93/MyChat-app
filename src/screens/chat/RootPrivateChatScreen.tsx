import ChatHistoryLoading from '../../components/chat/ChatHistoryLoading';
import {t,languageSnapshot} from '../../localization/language';
import ChatMessageRow from '../../components/chat/ChatMessageRow';
import {nextVoiceMessage} from '../../services/voicePlayback';
import {useChatMediaViewer} from '../../components/chat/useChatMediaViewer';
import {attachmentTimeline,type PreparationRow} from '../../modules/ui/useChatSnapshot';
import ChatScrollToBottom from '../../components/chat/ChatScrollToBottom';
import {useChatScroll,CHAT_REVEAL_SPACE} from '../../modules/ui/useChatSnapshot';
import {useReplyNavigation} from '../../modules/ui/useChatSnapshot';
import {createChatReplyLookup} from '../../modules/ui/useChatSnapshot';
import ChatDateSeparator from '../../components/chat/ChatDateSeparator';
import RootReplyContent from '../../components/chat/RootReplyContent';
import ComposerReplyPreview from '../../components/chat/ComposerReplyPreview';
import AttachmentPreparation from '../../components/chat/AttachmentPreparation';
import {ChatComposer,type ChatComposerHandle} from '../../components/chat/ChatComposer';
import {createMessageTimeFormatter} from '../../utils/message-time';
import {submitComposer} from '../../components/chat/submitComposer';
import {dismissRootConversationNotifications} from '../../modules/messaging/notifications';
import {KeyboardAvoidingScreen} from '../../components/ui/KeyboardForm';
import {useChatActivity} from '../../modules/ui/useChatActivity';
import {usePagedChat as useOwnChat,useChatLayoutTiming,usePrivateCallHistory,privateChatTimeline,type PrivateChatRow} from '../../modules/ui/useChatSnapshot';
import {useAttachmentPreview} from '../../components/chat/AttachmentPreview';
import {pickRootAttachment} from '../../modules/ui/documentPicker';
import {useConfirm} from '../../contexts/ConfirmContext';
import ChatHeaderIdentity from '../../components/chat/ChatHeaderIdentity';
import RootMessageMenu from '../../components/chat/RootMessageMenu';
import {type RootActionKind} from '../../modules/messaging';
import RootForwardPicker from '../../components/chat/RootForwardPicker';
import {rootStickerDraft} from '../../modules/messaging';
import StickerPicker from '../../components/chat/sticker-picker';
import StickerPreview from '../../components/chat/sticker-preview';
import {stickerMessage,type Sticker} from '../../services/stickers';
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
import {messaging} from '../../modules/messaging';
import {localAccount} from '../../modules/identity';
import {conversations} from '../../modules/messaging';
import type {RootChatMessage} from '../../modules/messaging';
import {messageListRendering} from '../../components/chat/message-list-rendering';
import {queueRootAttachmentSource} from '../../modules/media';
import {useChatTransferSelections,acknowledgeAttachmentHandoffs} from '../../modules/ui/transferState';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report,nickname} from '../rootScreenSupport';
export default function ChatRoom({route,navigation}:Screen<'ChatRoom'>){
 const {confirm}=useConfirm();

 const activity=useChatActivity();

 const peer=route.params.peer,{colors}=useTheme(),{state,error,references,hasMore,loading,initialLoading,retry,loadMore,revealMessage}=useOwnChat(peer),header=useHeaderHeight();
 const onChatLayout=useChatLayoutTiming('private_chat_layout');

 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const messageTime=useMemo(()=>createMessageTimeFormatter(),[focused,foreground,languageSnapshot()]);

 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);

 const [stickerSource,setStickerSource]=useState<string>();
 const [menuY,setMenuY]=useState(0),[menu,setMenu]=useState<RootChatMessage>(),[editing,setEditing]=useState<RootChatMessage>();

 const [forwardMessage,setForwardMessage]=useState<RootChatMessage>(),[replyTo,setReplyTo]=useState<RootChatMessage>();

 const [stickersOpen,setStickersOpen]=useState(false),[stickerPreview,setStickerPreview]=useState<Sticker>();

 const attachmentPreview=useAttachmentPreview();

 const [attachOpen,setAttachOpen]=useState(false);



 const [busy,setBusy]=useState(false),selections=useChatTransferSelections(peer);

 const name=nickname(state,peer),contact=state.contacts.find(c=>c.account===peer),messages=useMemo(()=>state.messages.filter(m=>m.peer===peer&&!m.group).slice().reverse(),[state.messages,peer,languageSnapshot()]);

 const {open:openMedia,modal:mediaViewer}=useChatMediaViewer(peer,messages,hasMore?{loading,error,load:loadMore}:undefined);
 const composer=useRef<ChatComposerHandle>(null),sending=useRef(false);
 const setText=(next:string|((current:string)=>string))=>composer.current?.setText(next);
 useEffect(()=>{const blur=()=>composer.current?.blur();const remove=navigation.addListener('beforeRemove',blur),unfocus=navigation.addListener('blur',blur);return()=>{remove();unfocus();};},[navigation]);
 const openMessageMenu=React.useCallback((message:RootChatMessage,event:{nativeEvent:{pageY:number}})=>{if(message.deleted||message.localPending)return;setMenuY(event.nativeEvent.pageY);setMenu(message);},[]);
 const replyToMessage=React.useCallback((message:RootChatMessage)=>{setEditing(undefined);setReplyTo(message);},[]);
 const calls=usePrivateCallHistory(peer,false,!initialLoading),timeline=useMemo(()=>attachmentTimeline(privateChatTimeline(messages,calls.rows,peer,hasMore),selections,s=>'message:outgoing:'+s.id),[messages,calls.rows,peer,hasMore,selections]);
 useEffect(()=>{acknowledgeAttachmentHandoffs(messages);},[messages]);
 const list=useRef<FlatList<PrivateChatRow|PreparationRow>>(null),owner=localAccount.status().account;
 const [composerHeight,setComposerHeight]=useState(90);
 const {listProps:chatScroll,showScrollToBottom,scrollToBottom,stopFollowing,keyboardAnimationChanged}=useChatScroll(list,owner+':'+peer,timeline[0]?.key);
 const replyNavigation=useReplyNavigation({beforeJump:stopFollowing,scope:owner+':'+peer,rows:timeline,message:row=>row.message,list,loading,error,reveal:revealMessage,report});

 useEffect(()=>{if(focused&&foreground&&owner)void dismissRootConversationNotifications(owner,{peer}).catch(()=>{});},[focused,foreground,owner,peer]);

 const replyReference=replyTo?{id:replyTo.id,author:replyTo.direction==='outgoing'?owner!:peer}:undefined;

 useEffect(()=>()=>{activity.notify(peer,false);},[peer]);

 const clearReply=React.useCallback(()=>setReplyTo(undefined),[languageSnapshot()]);
 const mediaSent=React.useCallback(()=>{clearReply();scrollToBottom();},[clearReply,scrollToBottom,languageSnapshot()]);

 const act=React.useCallback(async(m:RootChatMessage,kind:RootActionKind,value='')=>{

  if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error(t("Unlock your account"));

  await messaging.act(peer,{id:m.id,author:m.direction==='outgoing'?owner:peer},kind,value,owner);

 },[owner,peer]);
 const reactToMessage=React.useCallback((m:RootChatMessage,value:string)=>{void act(m,'reaction',value).catch(report);},[act]);

 const unread=messages.filter(m=>m.direction==='incoming'&&m.status==='delivered'&&!m.read&&!m.deleted);

 const unreadKey=unread.map(m=>m.id).sort().join(',');

 useEffect(()=>{if(!focused||!foreground||!contact?.accepted||contact.blocked||!unreadKey)return;let active=true;

  void (async()=>{for(let i=0;i<unread.length;i+=20){if(!active||AppState.currentState!=='active')return;await messaging.readMessages(peer,unread.slice(i,i+20).map(m=>m.id),owner);}})().catch(()=>{});

  return()=>{active=false;};

 },[focused,foreground,peer,unreadKey,contact?.accepted,contact?.blocked]);


 useLayoutEffect(()=>{navigation.setOptions({headerTitleAlign:'left',headerBackVisible:false,headerTitle:'',headerLeft:()=> <ChatHeaderIdentity onBack={()=>navigation.goBack()} title={name} activity={activity.recording.includes(peer)?t("Recording…"):activity.typing.includes(peer)?t("Typing…"):undefined} syncing={false} color={colors.headerText} avatarUri={state.avatarUris[peer]} isGroup={false} isOnline={activity.online.includes(peer)} onPress={()=>navigation.navigate('Contact',{peer})}/>,headerRight:()=> <View style={{flexDirection:'row',gap:8,marginRight:8}}>

  <TouchableOpacity accessibilityLabel={contact?.muted?t("Unmute notifications"):t("Mute notifications")} onPress={()=>void conversations().configure(peer,{muted:!contact?.muted}).catch(report)} style={{width:36,height:36,borderRadius:18,backgroundColor:contact?.muted?'rgba(255,80,80,0.15)':'rgba(0,229,255,0.10)',borderWidth:1,borderColor:contact?.muted?'rgba(255,80,80,0.35)':'rgba(0,229,255,0.30)',alignItems:'center',justifyContent:'center'}}><Ionicons name={contact?.muted?'notifications-off-outline':'notifications-outline'} size={18} color={contact?.muted?'#FF5050':'#00E5FF'}/></TouchableOpacity>

  {(['video','voice'] as const).map(kind=><TouchableOpacity key={kind} testID={kind==='voice'?'axonic-voice-call':'axonic-video-call'} accessibilityLabel={kind==='voice'?t("Start voice call"):t("Start video call")} disabled={contact?.blocked} onPress={()=>navigation.navigate('OutgoingCall',{peer,kind})} style={{width:36,height:36,borderRadius:18,backgroundColor:'rgba(0,229,255,0.10)',borderWidth:1,borderColor:'rgba(0,229,255,0.30)',alignItems:'center',justifyContent:'center',opacity:contact?.blocked?0.4:1}}><Ionicons name={kind==='voice'?'call-outline':'videocam-outline'} size={18} color="#00E5FF"/></TouchableOpacity>)}</View>});},[navigation,peer,name,colors,contact?.blocked,contact?.muted,activity.online.join(),activity.typing.join(),activity.recording.join(),state.avatarUris[peer],languageSnapshot()]);

 async function send(value:string){
 const input=composer.current,update=input?.setText;
 if(sending.current||busy||!value.trim()||contact?.blocked||!update)return;
 if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
 const selection=replyTo,edit=editing;
 sending.current=true;setBusy(true);input.focus();input.clear();
 try{await submitComposer(value,update,async()=>{
  if(edit){await messaging.act(peer,{id:edit.id,author:owner!},'edit',value,owner);setEditing(current=>current===edit?undefined:current);}
  else await messaging.sendText(peer,value,selection?{id:selection.id,author:selection.direction==='outgoing'?owner!:peer}:undefined,owner);
 });setReplyTo(current=>current===selection?undefined:current);scrollToBottom();}
 catch(e){report(e);}finally{sending.current=false;setBusy(false);}
 }

 async function sendSticker(sticker:Sticker){if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error(t("Unlock your account"));await messaging.sendText(peer,stickerMessage(sticker),replyReference,owner);setReplyTo(undefined);scrollToBottom();}

 async function sendImportedSticker(sticker:ImportedSticker){if(!owner||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error(t("Unlock your account"));const uri=importedStickerUri(owner,sticker),mime=await stickerFileMime(uri);if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error(t("Unlock your account"));await queueRootAttachmentSource(peer,uri,IMPORTED_STICKER_CONTENT,mime,owner,replyReference);setReplyTo(undefined);scrollToBottom();}

 async function attach(source:'camera'|'camera-video'|'library'|'files'){setAttachOpen(false);if(busy||contact?.blocked)return;setBusy(true);try{const selection=source==='files'?await pickRootAttachment(peer,replyReference,attachmentPreview.confirm):await pickRootMedia(peer,source,replyReference,undefined,attachmentPreview.confirm,attachmentPreview.capture);if(selection){setReplyTo(undefined);scrollToBottom();}}catch(e){report(e);}finally{setBusy(false);}}


 const findReply=useMemo(()=>createChatReplyLookup(state.messages,references,owner,peer),[state.messages,references,owner,peer]);
 const messageList=useMemo(()=>(<FlatList {...messageListRendering} {...chatScroll} ListHeaderComponent={<View style={{height:CHAT_REVEAL_SPACE+composerHeight}}/>} onEndReached={loadMore} onEndReachedThreshold={0.25} maintainVisibleContentPosition={{minIndexForVisible:1}} ListFooterComponent={hasMore?<Pressable disabled={loading} onPress={loadMore} style={{padding:16}}><Text style={{color:colors.primary}}>{loading?t("Loading older messages..."):t("Load older messages")}</Text></Pressable>:null} ref={list} onScrollToIndexFailed={replyNavigation.failed} inverted data={timeline} keyExtractor={row=>row.key} style={roomStyles.messageList} contentContainerStyle={[roomStyles.messagesList,chatScroll.contentContainerStyle,{paddingBottom:header+8}]} keyboardShouldPersistTaps="handled"

   renderItem={({item:row,index})=>{const date=<ChatDateSeparator at={row.at} olderAt={timeline[index+1]?.at}/>;if('preparation' in row)return <View>{date}<AttachmentPreparation selection={row.preparation} colors={colors} report={report}/></View>;if(row.call){const call=row.call,label=(call.outgoing?t("Outgoing"):t("Incoming"))+' '+(call.media==='video'?'video':'voice')+' call',when=new Date(call.at).toLocaleDateString()+' · '+messageTime(call.at);return <View>{date}<Pressable accessibilityRole="button" accessibilityLabel={label+', '+when+'. Call again'} disabled={contact?.blocked} onPress={()=>navigation.navigate('OutgoingCall',{peer,kind:call.media})} style={{alignSelf:call.outgoing?'flex-end':'flex-start',flexDirection:'row',alignItems:'center',gap:12,marginVertical:8,marginHorizontal:12,padding:14,borderRadius:16,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:call.outgoing?colors.bubbleSent:colors.bubbleReceived}}><Ionicons name={call.media==='video'?'videocam-outline':'call-outline'} size={24} color={colors.primary}/><View><Text style={{color:colors.text}}>{label}</Text><Text style={{color:colors.textSecondary,fontSize:12,marginTop:4}}>{when}</Text></View></Pressable></View>;}const message=row.message;
    return <ChatMessageRow message={message} at={row.at} olderAt={timeline[index+1]?.at} time={messageTime(message.at)}
     owner={owner} disabled={!!contact?.blocked} highlighted={replyNavigation.isHighlighted(message)}
     quoted={message.reply?findReply(message.reply):undefined} onJump={replyNavigation.jump}
     onReply={replyToMessage} onMenu={openMessageMenu} onReact={reactToMessage} onSticker={setStickerPreview} onMedia={openMedia} nextVoice={nextVoiceMessage(message,timeline[index-1]?.message)} onError={report}/>;
   }}/>),[timeline,findReply,hasMore,loading,loadMore,peer,owner,colors,contact?.blocked,messageTime,navigation,replyNavigation.highlight,replyNavigation.jump,chatScroll,header,composerHeight,replyToMessage,openMessageMenu,reactToMessage,openMedia,languageSnapshot()]);

 return <KeyboardAvoidingScreen onLayout={onChatLayout} style={{flex:1,backgroundColor:colors.chatBg}} keyboardVerticalOffset={0} animateKeyboard onKeyboardAnimationChange={keyboardAnimationChanged}>

  <View style={{marginTop:(error||calls.error||contact?.blocked||contact&&!contact.accepted&&messages.some(m=>m.direction==='incoming'))?header:0}}>
  {!!(error||calls.error)&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error||calls.error}</Text>}

  {contact?.blocked?<Pressable onPress={()=>navigation.navigate('Contact',{peer})}><Text style={{color:colors.error,padding:12}}>{t("This identity is blocked. Tap to manage.")}</Text></Pressable>:contact&&!contact.accepted&&messages.some(m=>m.direction==='incoming')?<View style={[roomStyles.requestBanner,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><Text style={{color:colors.text,flex:1}}>{t("Message request")}</Text><Pressable accessibilityLabel={t("Accept message request")} onPress={()=>void conversations().configure(peer,{accepted:true}).catch(report)}><Text style={{color:colors.primary}}>{t("Accept")}</Text></Pressable><Pressable accessibilityLabel={t("Reject message request")} accessibilityHint={t("Block this identity. You can unblock it in user details.")} onPress={()=>void conversations().configure(peer,{accepted:false,blocked:true}).catch(report)} style={{marginLeft:16}}><Text style={{color:colors.error}}>{t("Reject")}</Text></Pressable></View>:null}

  </View>

  {initialLoading?<ChatHistoryLoading error={error} retry={retry}/>:messageList}
  {!initialLoading&&showScrollToBottom&&<ChatScrollToBottom bottom={composerHeight+12} onPress={scrollToBottom}/>}

  <View pointerEvents="box-none" onLayout={event=>setComposerHeight(event.nativeEvent.layout.height)} style={{position:'absolute',left:0,right:0,bottom:0,zIndex:2}}>





  {stickersOpen&&owner&&<StickerPicker ownerId={owner} initialUri={stickerSource} draftStorage={rootStickerDraft(owner)} onClose={()=>{setStickersOpen(false);setStickerSource(undefined);}} onSend={sendSticker} onSendImported={sendImportedSticker}/>}

  {stickerPreview&&owner&&<StickerPreview sticker={stickerPreview} userId={owner} onClose={()=>setStickerPreview(undefined)}/>}

  {menu&&<RootMessageMenu message={menu} createSticker={uri=>{setStickerSource(uri);setStickersOpen(true);}} pageY={menuY} info={()=>navigation.navigate('MessageInfo',{peer:menu.peer,id:menu.id,direction:menu.direction})} close={()=>setMenu(undefined)} copy={()=>void Clipboard.setStringAsync(menu.text).catch(report)}

    reply={()=>{setEditing(undefined);setReplyTo(menu);}} forward={()=>setForwardMessage(menu)}

    edit={()=>{setReplyTo(undefined);setEditing(menu);setText(menu.text);}}

    remove={()=>confirm({title:t("Delete message?"),message:t("The message will be shown as deleted on both devices."),icon:'trash-outline',buttons:[{text:t("Cancel"),style:'cancel'},{text:t("Delete"),style:'destructive',onPress:()=>void act(menu,'delete').catch(report)}]})}

    react={value=>void act(menu,'reaction',value).catch(report)}/>}

  {editing&&<View style={[roomStyles.replyPreview,{backgroundColor:colors.surface,borderLeftColor:colors.primary}]}><Text style={{color:colors.primary,flex:1}}>{t("Editing message")}</Text><Pressable accessibilityLabel={t("Cancel edit")} onPress={()=>{setEditing(undefined);setText('');}}><Ionicons name="close" size={22} color={colors.text}/></Pressable></View>}

  {forwardMessage&&<RootForwardPicker message={forwardMessage} contacts={state.contacts} groups={state.groups} onClose={()=>setForwardMessage(undefined)}/>}

  {attachmentPreview.modal}
  {mediaViewer}

  <AttachmentMenu visible={attachOpen} onClose={()=>setAttachOpen(false)} onCamera={()=>void attach('camera')} onMultimedia={()=>void attach('library')} onFiles={()=>void attach('files')}/>


  <ChatComposer replyPreview={replyTo&&<ComposerReplyPreview cancelLabel={t("Cancel reply")} onCancel={()=>setReplyTo(undefined)}><RootReplyContent hideMediaLabel message={replyTo}/></ComposerReplyPreview>} ref={composer} owner={owner} peer={peer} disabled={busy||!!contact?.blocked} cannotCompose={!!contact?.blocked} editing={!!editing} reply={replyReference} onSend={send} onAttach={()=>setAttachOpen(true)} onCamera={video=>void attach(video?'camera-video':'camera')} onStickers={()=>setStickersOpen(true)} onSent={mediaSent} onTyping={value=>activity.notify(peer,value)} onRecording={value=>activity.notifyRecording(peer,value)} onError={report}/>

  </View>

 </KeyboardAvoidingScreen>;

}
