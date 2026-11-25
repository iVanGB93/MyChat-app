import * as ImagePicker from 'expo-image-picker';
import {withRootPickedMedia} from '../../modules/storage';
import ChatHistoryLoading from '../../components/chat/ChatHistoryLoading';
import {t,languageSnapshot} from '../../localization/language';
import {useGroupCallAvailable} from '../../modules/ui/liveState';
import {usePrivateCallHistory,groupChatTimeline} from '../../modules/ui/useChatSnapshot';
import GroupCallPicker from '../calls/GroupCallPicker';
import {calling,localAccountCalls,GROUP_CALLS_ENABLED} from '../../modules/calls';
import {ensureRootCallPermissions} from '../calls/RootAccountCallScreen';
import ChatMessageRow from '../../components/chat/ChatMessageRow';
import {attachmentTimeline} from '../../modules/ui/useChatSnapshot';
import ChatScrollToBottom from '../../components/chat/ChatScrollToBottom';
import {useChatScroll,CHAT_REVEAL_SPACE} from '../../modules/ui/useChatSnapshot';
import {useReplyNavigation} from '../../modules/ui/useChatSnapshot';
import {createChatReplyLookup} from '../../modules/ui/useChatSnapshot';
import ChatDateSeparator from '../../components/chat/ChatDateSeparator';
import RootReplyContent from '../../components/chat/RootReplyContent';
import ComposerReplyPreview from '../../components/chat/ComposerReplyPreview';
import AttachmentPreparation from '../../components/chat/AttachmentPreparation';
import {useChatTransferSelections,acknowledgeAttachmentHandoffs} from '../../modules/ui/transferState';
import {ChatComposer,type ChatComposerHandle} from '../../components/chat/ChatComposer';
import {createMessageTimeFormatter} from '../../utils/message-time';
import {submitComposer} from '../../components/chat/submitComposer';
import ScreenHeader from '../../components/ui/ScreenHeader';
import {dismissRootConversationNotifications} from '../../modules/messaging/notifications';

import {KeyboardAvoidingScreen,KeyboardFormScrollView} from '../../components/ui/KeyboardForm';

import StickerPreview from '../../components/chat/sticker-preview';
import type {Sticker} from '../../services/stickers';
import {groupPhotoUri} from '../../components/chat/group-photo';
import RootForwardPicker from '../../components/chat/RootForwardPicker';

import {useChatActivity} from '../../modules/ui/useChatActivity';



import {useAttachmentPreview} from '../../components/chat/AttachmentPreview';

import {useGroupDetails,usePagedChat,useChatLayoutTiming} from '../../modules/ui/useChatSnapshot';


import {pickRootGroupAttachment} from '../../modules/ui/documentPicker';


import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';

import Avatar from '../../components/ui/Avatar';

import Input from '../../components/ui/Input';


import ChatHeaderIdentity from '../../components/chat/ChatHeaderIdentity';

import {groupCreateStyles as createStyles} from './group-create-styles';

import {groupInfoStyles as infoStyles} from './group-info-styles';

import {shortIdentity,parseIdentityInput} from '../../modules/identity';

import * as Clipboard from 'expo-clipboard';

import RootMessageMenu from '../../components/chat/RootMessageMenu';

import type {RootChatMessage,RootChatReply} from '../../modules/messaging';

import React,{useEffect,useLayoutEffect,useState} from 'react';

import {ActivityIndicator,AppState,Modal,FlatList,Pressable,Text,TouchableOpacity,View} from 'react-native';

import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {useIsFocused} from '@react-navigation/native';

import {useHeaderHeight} from '@react-navigation/elements';

import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Ionicons} from '@expo/vector-icons';

import {useTheme} from '../../contexts/ThemeContext';

import {messaging} from '../../modules/messaging';

import {localAccount} from '../../modules/identity';

import {conversations} from '../../modules/messaging';

import {rootGroupMessages} from '../../modules/messaging';

import type {RootAccountRoutes} from '../../navigation/rootAccountRoutes';

import {chatRoomStyles as styles} from '../../components/chat/chat-room-styles';




import AttachmentMenu from '../../components/chat/AttachmentMenu';

import StickerPicker from '../../components/chat/sticker-picker';

import {stickerMessage} from '../../services/stickers';

import {rootStickerDraft} from '../../modules/messaging';

import {importedStickerUri,stickerFileMime} from '../../services/imported-stickers';

import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';


import {messageListRendering} from '../../components/chat/message-list-rendering';

import {rootGroupAttachmentAudience,queueRootGroupAttachmentSource} from '../../modules/media';
import {GROUP_AVATAR_FILE,isGroupAvatarFile} from '../../services/group-avatar-file';

import {pickRootGroupMedia} from '../../modules/ui/mediaPicker';

type Screen<P extends keyof RootAccountRoutes>=NativeStackScreenProps<RootAccountRoutes,P>;


const report=(e:unknown)=>Alert.alert('Axonic',e instanceof Error?e.message:t("Please try again"));

function useGroups(group?:string){const {state,error}=useGroupDetails(group);useEffect(()=>{if(error)report(error);},[error]);return state;}

export function RootGroupCreate({navigation}:Screen<'GroupCreate'>){

 const {colors}=useTheme(),state=useGroups(),[name,setName]=useState(''),[code,setCode]=useState(''),[members,setMembers]=useState<string[]>([]),[busy,setBusy]=useState(false);

 const insets=useSafeAreaInsets(),owner=localAccount.status().account,add=(peer:string)=>{if(peer===owner){report(Error(t("You are already in the group")));return;}setMembers(old=>old.includes(peer)?old.filter(p=>p!==peer):old.length<9?[...old,peer]:old);};

 async function create(){if(busy||!name.trim()||!members.length)return;setBusy(true);try{const id=await messaging.createGroup(name,members);navigation.replace('GroupRoom',{id});}catch(e){report(e);}finally{setBusy(false);}}

 const rows=[...state.contacts.filter(c=>!c.blocked),...members.filter(p=>!state.contacts.some(c=>c.account===p)).map(account=>({account,alias:'',blocked:false,accepted:true}))];

 return <KeyboardAvoidingScreen style={[createStyles.container,{backgroundColor:colors.background}]}><View style={createStyles.form}><Input accessibilityLabel={t("Group name")} placeholder={t("Group name")} value={name} onChangeText={setName} maxLength={80}/><Text style={[createStyles.helper,{color:colors.textSecondary}]}>{members.length}{t("/9 members selected")}</Text><View style={createStyles.identityRow}><View style={{flex:1}}><Input containerStyle={createStyles.identityInput} accessibilityLabel={t("Group member identity")} placeholder={t("Paste an axon code…")} autoCapitalize="none" autoCorrect={false} value={code} onChangeText={setCode}/></View><TouchableOpacity style={createStyles.addIdentity} accessibilityRole="button" accessibilityLabel={t("Add identity")} disabled={busy} onPress={()=>{const account=parseIdentityInput(code);if(!account){report(Error(t("Enter a complete Axonic identity")));return;}add(account);setCode('');}}><Ionicons name="add-circle-outline" size={28} color={colors.primary}/></TouchableOpacity></View></View>

  <FlatList style={createStyles.listViewport} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" data={rows} keyExtractor={c=>c.account} contentContainerStyle={rows.length?createStyles.list:createStyles.empty} ListEmptyComponent={<View style={createStyles.empty}><Ionicons name="people-outline" size={42} color={colors.textTertiary}/><Text style={[createStyles.emptyText,{color:colors.textSecondary}]}>{t("Choose a contact or paste an identity above.")}</Text></View>} renderItem={({item:c})=><TouchableOpacity disabled={busy} style={[createStyles.contact,{borderBottomColor:colors.divider}]} onPress={()=>add(c.account)}><Avatar name={c.alias||shortIdentity(c.account)} uri={state.avatarUris[c.account]} size={46}/><View style={createStyles.contactInfo}><Text numberOfLines={1} style={[createStyles.contactName,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text><Text style={[createStyles.contactSub,{color:colors.textSecondary}]}>{shortIdentity(c.account)}</Text></View><Ionicons name={members.includes(c.account)?'checkmark-circle':'ellipse-outline'} size={26} color={members.includes(c.account)?colors.primary:colors.textTertiary}/></TouchableOpacity>}/>

  <View style={[createStyles.footer,{backgroundColor:colors.background,borderTopColor:colors.divider,paddingBottom:16+insets.bottom}]}><TouchableOpacity accessibilityLabel={t("Create group")} disabled={busy||!name.trim()||!members.length} onPress={()=>void create()} style={[createStyles.createButton,{backgroundColor:busy||!name.trim()||!members.length?colors.surfaceVariant:colors.primary}]}><Ionicons name="people" size={19} color="#fff"/><Text style={createStyles.createText}>{busy?t("Creating…"):t("Create group")}</Text></TouchableOpacity></View>

 </KeyboardAvoidingScreen>;

}

export function RootGroupInfo({route,navigation}:Screen<'GroupInfo'>){

 const {colors}=useTheme(),{state,loading,error}=useGroupDetails(route.params.id),g=state.groups?.find(g=>g.id===route.params.id),owner=localAccount.status().account,[name,setName]=useState(''),[member,setMember]=useState(''),[renaming,setRenaming]=useState(false),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[choosingPhoto,setChoosingPhoto]=useState(false);

 useEffect(()=>{setName(g?.name??'');},[g?.name]);

 async function update(members:string[]){if(!g||busy)return;setBusy(true);try{await messaging.updateGroup(g.id,name,members);setAdding(false);setRenaming(false);setMember('');}catch(e){report(e);}finally{setBusy(false);}}

 async function setPhoto(photo:string|null){if(!g||busy)return;setBusy(true);try{await messaging.updateGroup(g.id,g.name,g.members,photo);setChoosingPhoto(false);}catch(e){report(e);}finally{setBusy(false);}}
 const [galleryPhoto,setGalleryPhoto]=useState<{group:string;owner:string;id:string}>();
 async function pickGalleryPhoto(){
  if(!g||!owner||g.admin!==owner||busy||galleryPhoto)return;
  setBusy(true);
  try{
   const audience=await rootGroupAttachmentAudience(g.id);
   const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.8});
   if(result.canceled)return;
   const image=result.assets[0];
   if(!image?.uri)throw Error(t("The selected media is unavailable"));
   const id=await withRootPickedMedia([{uri:image.uri,mime:image.mimeType||'image/jpeg',assetId:image.assetId}],([item])=>
    queueRootGroupAttachmentSource(audience,item.uri,GROUP_AVATAR_FILE,item.mime));
   setGalleryPhoto({group:g.id,owner,id});
  }catch(error){report(error);}finally{setBusy(false);}
 }
 useEffect(()=>{
  if(!galleryPhoto)return;
  if(galleryPhoto.group!==route.params.id||galleryPhoto.owner!==owner){setGalleryPhoto(undefined);return;}
  if(!g||g.admin!==owner||busy||!state.messages.some(m=>m.direction==='outgoing'&&!m.deleted&&isGroupAvatarFile(m.attachment)&&m.group?.id===g.id&&m.group.messageId===galleryPhoto.id))return;
  setGalleryPhoto(undefined);
  void setPhoto(galleryPhoto.id);
 },[galleryPhoto,route.params.id,owner,g,busy,state.messages]);
 const photos=rootGroupMessages(state,route.params.id).filter(m=>m.direction==='outgoing'&&!m.deleted&&m.attachment&&/^(image|video)\//.test(m.attachment.mime)&&m.attachment.name!==IMPORTED_STICKER_CONTENT&&!isGroupAvatarFile(m.attachment)&&!!g&&!!groupPhotoUri({...state,groups:[{...g,photo:m.group!.messageId}]},g.id,owner));
 const insets=useSafeAreaInsets();

 if(loading)return <View accessibilityLiveRegion="polite" style={{flex:1,alignItems:'center',justifyContent:'center',gap:12,backgroundColor:colors.background}}>
  <ActivityIndicator color={colors.primary}/>
  <Text style={{color:colors.textSecondary}}>{t("Loading group information…")}</Text>
 </View>;
 if(!g)return <Text accessibilityRole={error?'alert':undefined} style={{color:colors.text,padding:24}}>{error||t("Group unavailable")}</Text>;

 return <KeyboardFormScrollView style={{backgroundColor:colors.background}} contentContainerStyle={[infoStyles.list,{paddingBottom:insets.bottom+24}]} keyboardShouldPersistTaps="handled">

  <View style={[infoStyles.hero,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><TouchableOpacity disabled={g.admin!==owner||busy} accessibilityLabel={g.admin===owner?t("Change group photo"):t("Group photo")} style={infoStyles.photoWrap} onPress={()=>setChoosingPhoto(true)}><Avatar name={g.name} uri={groupPhotoUri(state,g.id,owner)} size={82}/>{g.admin===owner&&<View style={[infoStyles.cameraBadge,{backgroundColor:colors.primary}]}><Ionicons name="camera" size={16} color={colors.textInverse}/></View>}</TouchableOpacity><View style={infoStyles.nameRow}><Text numberOfLines={1} style={[infoStyles.name,{color:colors.text}]}>{g.name}</Text>{g.admin===owner&&<TouchableOpacity accessibilityLabel={t("Rename group")} onPress={()=>setRenaming(!renaming)}><Ionicons name="pencil" size={19} color={colors.primary}/></TouchableOpacity>}</View><Text style={[infoStyles.count,{color:colors.textSecondary}]}>{g.members.length} {t("members")}</Text><View style={[infoStyles.divider,{backgroundColor:colors.divider}]}/><View style={infoStyles.heroActions}><TouchableOpacity style={infoStyles.heroAction} onPress={()=>navigation.navigate('GroupRoom',{id:g.id})}><View style={[infoStyles.heroActionIcon,{backgroundColor:colors.highlight,borderColor:colors.neonBorder}]}><Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary}/></View><Text style={[infoStyles.heroActionText,{color:colors.text}]}>{t("Message")}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={g.muted?t("Unmute group"):t("Mute group")} disabled={busy} style={infoStyles.heroAction} onPress={()=>void conversations().configureGroup(g.id,{muted:!g.muted}).catch(report)}><View style={[infoStyles.heroActionIcon,{backgroundColor:colors.highlight,borderColor:colors.neonBorder}]}><Ionicons name={g.muted?'notifications-off-outline':'notifications-outline'} size={22} color={colors.primary}/></View><Text style={[infoStyles.heroActionText,{color:colors.text}]}>{g.muted?t("Unmute"):t("Mute")}</Text></TouchableOpacity></View></View>

  {renaming&&g.admin===owner&&<View style={{padding:16}}><Input accessibilityLabel={t("Group name")} value={name} onChangeText={setName} maxLength={80}/><TouchableOpacity disabled={busy||!name.trim()} onPress={()=>void update(g.members)}><Text style={{color:colors.primary}}>{t("Save group name")}</Text></TouchableOpacity></View>}

  {g.admin===owner&&<TouchableOpacity style={[infoStyles.action,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]} onPress={()=>setAdding(!adding)}><Ionicons name="person-add-outline" size={20} color={colors.primary}/><Text style={[infoStyles.actionText,{color:colors.text}]}>{t("Add members")}</Text></TouchableOpacity>}

  {adding&&g.admin===owner&&<View style={{padding:16}}><Input accessibilityLabel={t("New group member identity")} value={member} onChangeText={setMember} placeholder={t("Paste an axon code…")} autoCapitalize="none" autoCorrect={false}/><TouchableOpacity disabled={busy} onPress={()=>{const account=parseIdentityInput(member);if(!account){report(Error(t("Enter a complete Axonic identity")));return;}void update([...new Set([...g.members,account])]);}}><Text style={{color:colors.primary}}>{t("Add identity")}</Text></TouchableOpacity>{state.contacts.filter(c=>!c.blocked&&!g.members.includes(c.account)).map(c=><TouchableOpacity key={c.account} disabled={busy} style={infoStyles.contact} onPress={()=>void update([...g.members,c.account])}><Avatar name={c.alias||shortIdentity(c.account)} uri={state.avatarUris[c.account]} size={44}/><View style={infoStyles.memberInfo}><Text style={[infoStyles.memberName,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text></View><Ionicons name="add-circle-outline" size={26} color={colors.primary}/></TouchableOpacity>)}</View>}

  <Text style={[infoStyles.section,{color:colors.textSecondary}]}>{t("MEMBERS")}</Text>{g.members.map(peer=>{
   const isSelf=peer===owner;
   const canRemove=g.admin===owner&&!isSelf;
   const name=isSelf?t("You"):state.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);
   return <View key={peer} style={[infoStyles.member,{borderBottomColor:colors.divider}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("Open details for ")+name}
     onPress={()=>isSelf?navigation.navigate('Tabs',{screen:'Profile'}):navigation.navigate('Contact',{peer})}
     style={({pressed})=>({flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:10,opacity:pressed?0.7:1})}>
     <Avatar uri={state.avatarUris[peer]} name={name} size={44}/>
     <View style={infoStyles.memberInfo}>
      <Text style={[infoStyles.memberName,{color:colors.text}]}>{name}</Text>
      <Text style={[infoStyles.memberSub,{color:colors.textSecondary}]}>{shortIdentity(peer)}</Text>
     </View>
     {peer===g.admin&&<Text style={[infoStyles.admin,{color:colors.primary,borderColor:colors.primary}]}>{t("ADMIN")}</Text>}
    </Pressable>
    {canRemove&&<TouchableOpacity accessibilityLabel={t("Remove member")} disabled={busy} style={infoStyles.remove} onPress={()=>Alert.alert(t("Remove member?"),t("This changes the group membership for everyone."),[{text:t("Cancel"),style:'cancel'},{text:t("Remove"),style:'destructive',onPress:()=>void update(g.members.filter(m=>m!==peer))}])}><Ionicons name="person-remove-outline" size={20} color={colors.error}/></TouchableOpacity>}</View>;
  })}

  <View style={infoStyles.footer}><TouchableOpacity style={[infoStyles.leave,{borderColor:colors.error}]} onPress={()=>void conversations().configureGroup(g.id,{blocked:!g.blocked}).catch(report)}><Ionicons name="ban-outline" size={19} color={colors.error}/><Text style={[infoStyles.leaveText,{color:colors.error}]}>{g.blocked?t("Unblock group"):t("Block group")}</Text></TouchableOpacity><TouchableOpacity disabled={busy} style={[infoStyles.leave,{borderColor:colors.error,marginTop:16}]} onPress={()=>Alert.alert(g.admin===owner?t("Close group?"):t("Leave group?"),g.admin===owner?t("All other members will be removed."):t("A leave request will be delivered to the creator."),[{text:t("Cancel"),style:'cancel'},{text:'Confirm',style:'destructive',onPress:()=>void messaging.leaveGroup(g.id).then(()=>navigation.goBack()).catch(report)}])}><Ionicons name="exit-outline" size={19} color={colors.error}/><Text style={[infoStyles.leaveText,{color:colors.error}]}>{g.admin===owner?t("Close group"):t("Leave group")}</Text></TouchableOpacity></View>

 <Modal visible={choosingPhoto&&g.admin===owner} animationType="slide" onRequestClose={()=>setChoosingPhoto(false)}><View style={[infoStyles.picker,{backgroundColor:colors.background,paddingBottom:insets.bottom}]}><ScreenHeader title={t("Group photo")} backLabel="Close group photo picker" onBack={()=>setChoosingPhoto(false)}/><FlatList data={photos} keyExtractor={m=>m.group!.messageId} ListHeaderComponent={<View style={{padding:16,gap:8}}><TouchableOpacity accessibilityRole="button" disabled={busy||!!galleryPhoto} style={[infoStyles.action,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]} onPress={()=>void pickGalleryPhoto()}><Ionicons name="images-outline" size={22} color={colors.primary}/><Text style={[infoStyles.actionText,{color:colors.text}]}>{t("Choose from gallery")}</Text></TouchableOpacity>{galleryPhoto&&<View style={{flexDirection:'row',alignItems:'center',gap:8}}><ActivityIndicator color={colors.primary}/><Text style={{color:colors.textSecondary}}>{t("Preparing group photo…")}</Text><TouchableOpacity onPress={()=>setGalleryPhoto(undefined)} accessibilityRole="button"><Text style={{color:colors.primary}}>{t("Cancel")}</Text></TouchableOpacity></View>}</View>} ListEmptyComponent={<Text style={[infoStyles.empty,{color:colors.textSecondary}]}>{t("No shared photos available.")}</Text>} renderItem={({item:m})=><TouchableOpacity disabled={busy} style={[infoStyles.contact,{borderBottomColor:colors.divider}]} onPress={()=>void setPhoto(m.group!.messageId)}><Avatar name="Photo" uri={groupPhotoUri({...state,groups:[{...g,photo:m.group!.messageId}]},g.id,owner)} size={54}/><View style={infoStyles.memberInfo}><Text numberOfLines={1} style={[infoStyles.memberName,{color:colors.text}]}>{m.attachment!.caption||m.attachment!.name}</Text><Text style={[infoStyles.memberSub,{color:colors.textSecondary}]}>{new Date(m.at).toLocaleDateString()}</Text></View>{g.photo===m.group!.messageId&&<Ionicons name="checkmark-circle" size={24} color={colors.primary}/>}</TouchableOpacity>}/>{!!g.photo&&<TouchableOpacity disabled={busy} style={[infoStyles.leave,{margin:16,borderColor:colors.error}]} onPress={()=>void setPhoto(null)}><Text style={[infoStyles.leaveText,{color:colors.error}]}>{t("Remove group photo")}</Text></TouchableOpacity>}</View></Modal>

 </KeyboardFormScrollView>;

}

export function RootGroupRoom({route,navigation}:Screen<'GroupRoom'>){const {colors}=useTheme(),page=usePagedChat('group:'+route.params.id),state=page.state,g=state.groups?.find(g=>g.id===route.params.id),owner=localAccount.status().account,header=useHeaderHeight(),[reply,setReply]=useState<RootChatReply>(),[editing,setEditing]=useState<RootChatMessage>(),[menu,setMenu]=useState<RootChatMessage>(),[busy,setBusy]=useState(false),[attach,setAttach]=useState(false),[stickers,setStickers]=useState(false),selections=useChatTransferSelections(route.params.id,true);
 const [callKind,setCallKind]=useState<'voice'|'video'>();
 const onChatLayout=useChatLayoutTiming('group_chat_layout');
 useEffect(()=>{if(page.error)report(page.error);},[page.error]);

 const [stickerSource,setStickerSource]=useState<string>();
 const [stickerPreview,setStickerPreview]=useState<Sticker>();
 const [menuY,setMenuY]=useState<number>();
 const [forwardMessage,setForwardMessage]=useState<RootChatMessage>();

 const attachmentPreview=useAttachmentPreview(),activity=useChatActivity(route.params.id);

 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active'),unread=React.useMemo(()=>state.messages.filter(m=>m.group?.id===route.params.id&&m.direction==='incoming'&&!m.read).length,[state.messages,route.params.id,languageSnapshot()]);
 const messageTime=React.useMemo(()=>createMessageTimeFormatter(),[focused,foreground,languageSnapshot()]);

 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);

 useEffect(()=>{if(focused&&foreground&&g?.accepted&&!g.blocked&&unread)void conversations().markGroupRead(route.params.id).catch(report);},[focused,foreground,g?.accepted,g?.blocked,unread,route.params.id]);


 const recordingNames=activity.recording.filter(p=>g?.members.includes(p)).map(p=>state.contacts.find(c=>c.account===p)?.alias||shortIdentity(p)).join(', ');
 const typingNames=activity.typing.filter(p=>g?.members.includes(p)).map(p=>state.contacts.find(c=>c.account===p)?.alias||shortIdentity(p)).join(', ');
 useLayoutEffect(()=>navigation.setOptions({headerTitleAlign:'left',headerBackVisible:false,headerTitle:'',headerLeft:()=> <ChatHeaderIdentity onBack={()=>navigation.goBack()} title={g?.name??t("Group")} activity={recordingNames?recordingNames+' recording...':typingNames?typingNames+' typing...':undefined} syncing={false} avatarUri={groupPhotoUri(page.photoState,route.params.id,owner)} isGroup isOnline={false} color={colors.headerText} onPress={()=>navigation.navigate('GroupInfo',{id:route.params.id})}/>,headerRight:()=> <View style={{flexDirection:'row',gap:8,marginRight:8}}>
  <TouchableOpacity accessibilityRole="button" accessibilityLabel={g?.muted?t("Unmute group notifications"):t("Mute group notifications")} accessibilityState={{disabled:!g}} disabled={!g} onPress={()=>void conversations().configureGroup(route.params.id,{muted:!g?.muted}).catch(report)} style={{width:36,height:36,borderRadius:18,backgroundColor:g?.muted?'rgba(255,80,80,0.15)':colors.highlight,borderWidth:1,borderColor:g?.muted?colors.error:colors.neonBorder,alignItems:'center',justifyContent:'center',opacity:g?1:0.4}}><Ionicons name={g?.muted?'notifications-off-outline':'notifications-outline'} size={18} color={g?.muted?colors.error:colors.primary}/></TouchableOpacity>
  {(['video','voice'] as const).map(kind=><TouchableOpacity key={kind} accessibilityRole="button" accessibilityLabel={'Group '+kind+' call'} accessibilityState={{disabled:!GROUP_CALLS_ENABLED||!g?.accepted||!!g?.blocked}} disabled={!GROUP_CALLS_ENABLED||!g?.accepted||!!g?.blocked} onPress={()=>setCallKind(kind)} style={{width:36,height:36,borderRadius:18,backgroundColor:colors.highlight,borderWidth:1,borderColor:colors.neonBorder,alignItems:'center',justifyContent:'center',opacity:GROUP_CALLS_ENABLED&&g?.accepted&&!g.blocked?1:0.35}}><Ionicons name={kind==='voice'?'call-outline':'videocam-outline'} size={18} color={colors.primary}/></TouchableOpacity>)}
 </View>}),[navigation,recordingNames,typingNames,g,g?.name,g?.muted,!!g,route.params.id,colors,page.photoState,owner,languageSnapshot()]);

 const composer=React.useRef<ChatComposerHandle>(null);
 const setText=(next:string|((current:string)=>string))=>composer.current?.setText(next);
 useEffect(()=>{const blur=()=>composer.current?.blur();const remove=navigation.addListener('beforeRemove',blur),unfocus=navigation.addListener('blur',blur);return()=>{remove();unfocus();};},[navigation]);
 const cannotCompose=!g||g.blocked||!g.accepted||!g.members.includes(owner!);
 const disabled=busy||cannotCompose;
 useEffect(()=>{if(focused&&foreground&&owner)void dismissRootConversationNotifications(owner,{group:route.params.id}).catch(()=>{});},[focused,foreground,owner,route.params.id]);

 const working=React.useRef(false);
 const work=React.useCallback(async(fn:()=>Promise<unknown>)=>{if(working.current)return;working.current=true;setBusy(true);try{await fn();}catch(e){report(e);}finally{working.current=false;setBusy(false);}},[]);

 const clearReply=React.useCallback(()=>setReply(current=>current===reply?undefined:current),[reply,languageSnapshot()]);
 const target=React.useCallback((m:RootChatMessage):RootChatReply=>({id:m.group!.messageId,author:m.direction==='outgoing'?owner!:m.peer}),[owner]);

 const act=React.useCallback((m:RootChatMessage,kind:'edit'|'delete'|'reaction',value='')=>work(async()=>{await messaging.actGroup(route.params.id,target(m),kind,value,owner);}),[route.params.id,target,owner,work]);
 const reactToMessage=React.useCallback((m:RootChatMessage,value:string)=>{void act(m,'reaction',value);},[act]);
 const replyToMessage=React.useCallback((m:RootChatMessage)=>{setEditing(undefined);setReply(target(m));},[target]);
 const openSender=React.useCallback((peer:string)=>navigation.navigate('Contact',{peer}),[navigation]);

 const send=(value:string)=>{const update=composer.current?.setText;composer.current?.focus();return work(async()=>{if(!update)return;composer.current?.clear();await submitComposer(value,update,()=>editing?messaging.actGroup(route.params.id,target(editing),'edit',value,owner):messaging.sendGroupText(route.params.id,value,reply,owner));for(const peer of g?.members??[])if(peer!==owner)activity.notify(peer,false);setReply(undefined);setEditing(undefined);scrollToBottom();});};

 const openMessageMenu=React.useCallback((message:RootChatMessage,event:{nativeEvent:{pageY:number}})=>{if(disabled||message.deleted||message.localPending)return;setMenuY(event.nativeEvent.pageY);setMenu(message);},[disabled]);
 const messages=React.useMemo(()=>rootGroupMessages(state,route.params.id).reverse(),[state,route.params.id,languageSnapshot()]);
 useEffect(()=>{acknowledgeAttachmentHandoffs(messages);},[messages]);
 const calls=usePrivateCallHistory(route.params.id,true,!page.initialLoading);
 const joinAvailable=useGroupCallAvailable(calls.rows[0]?.room);
 useEffect(()=>{if(calls.error)report(Error(calls.error));},[calls.error]);
 const timeline=React.useMemo(()=>attachmentTimeline(groupChatTimeline(messages,calls.rows,route.params.id,page.hasMore),selections,s=>'own:'+s.group!.messageId),[messages,calls.rows,page.hasMore,selections,route.params.id]);
 const list=React.useRef<FlatList<(typeof timeline)[number]>>(null);
 const [composerHeight,setComposerHeight]=useState(90);
 const {listProps:chatScroll,showScrollToBottom,scrollToBottom,stopFollowing,keyboardAnimationChanged}=useChatScroll(list,owner+':group:'+route.params.id,timeline[0]?.key);
 const mediaSent=React.useCallback(()=>{clearReply();scrollToBottom();},[clearReply,scrollToBottom,languageSnapshot()]);
 const replyNavigation=useReplyNavigation({beforeJump:stopFollowing,scope:owner+':'+route.params.id,rows:timeline,message:row=>row.message,list,loading:page.loading,error:page.error,reveal:page.revealMessage,report});
 const memberName=(account:string)=>account===owner?t("You"):state.contacts.find(c=>c.account===account)?.alias||shortIdentity(account);
 const findReply=React.useMemo(()=>createChatReplyLookup(messages,page.references,owner),[messages,page.references,owner]);



 const messageList=React.useMemo(()=>(<FlatList {...messageListRendering} {...chatScroll} ListHeaderComponent={<View style={{height:CHAT_REVEAL_SPACE+composerHeight}}/>} onEndReached={page.loadMore} onEndReachedThreshold={0.25} maintainVisibleContentPosition={{minIndexForVisible:1}} ListFooterComponent={page.hasMore?<Pressable disabled={page.loading} onPress={page.loadMore} style={{padding:16}}><Text style={{color:colors.primary}}>{page.loading?t("Loading older messages..."):t("Load older messages")}</Text></Pressable>:null} ref={list} onScrollToIndexFailed={replyNavigation.failed} inverted data={timeline} keyExtractor={row=>row.key} style={styles.messageList} contentContainerStyle={[styles.messagesList,chatScroll.contentContainerStyle,{paddingBottom:header+8}]} keyboardShouldPersistTaps="handled" renderItem={({item:row,index})=>{if('preparation' in row)return <View><ChatDateSeparator at={row.at} olderAt={timeline[index+1]?.at}/><AttachmentPreparation selection={row.preparation} colors={colors} report={report}/></View>;if(row.call){const c=row.call,label=(c.media==='video'?t("Group video call"):t("Group voice call"));return <View><ChatDateSeparator at={row.at} olderAt={timeline[index+1]?.at}/><Pressable accessibilityRole="button" accessibilityLabel={label+'. Choose members to call again'} onPress={()=>setCallKind(c.media)} disabled={disabled||!GROUP_CALLS_ENABLED} style={{alignSelf:c.outgoing?'flex-end':'flex-start',flexDirection:'row',alignItems:'center',gap:12,margin:12,padding:14,borderRadius:20,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:c.outgoing?colors.bubbleSent:colors.bubbleReceived}}><Ionicons name={c.media==='video'?'videocam-outline':'call-outline'} size={24} color={colors.primary}/><View><Text style={{color:colors.text}}>{label}</Text><Text style={{color:colors.textSecondary}}>{memberName(c.peer)} · {c.members?.length??0} {t("participants")}</Text><Text style={{color:colors.textTertiary,fontSize:12}}>{messageTime(c.at)}</Text>{GROUP_CALLS_ENABLED&&!disabled&&joinAvailable&&c.room&&c.room.revision===g?.revision&&c.id===calls.rows[0]?.id&&<Pressable accessibilityRole="button" accessibilityLabel={t("Join group call")} disabled={busy} onPress={event=>{event.stopPropagation();void work(async()=>{await ensureRootCallPermissions(c.media);await localAccountCalls()?.joinGroup(c.room!,c.media);});}} style={{alignSelf:'flex-start',paddingHorizontal:16,paddingVertical:8,marginTop:8,borderRadius:16,borderWidth:1,borderColor:colors.primary}}><Text style={{color:colors.primary}}>{t("Join")}</Text></Pressable>}</View></Pressable></View>;}const message=row.message,previous=timeline[index+1]?.message;
  const author=message.direction==='outgoing'?owner:message.peer;
  if(!message.deleted&&g&&author===g.admin&&message.group&&isGroupAvatarFile(message.attachment)){
   const label=g.photo===message.group.messageId
    ?author===owner?t("You changed the group avatar"):t("{0} changed the group avatar",{'0':memberName(author)})
    :t("Group avatar");
   return <View><ChatDateSeparator at={row.at} olderAt={timeline[index+1]?.at}/><Text style={{alignSelf:'center',textAlign:'center',marginHorizontal:24,marginVertical:8,color:colors.textSecondary,fontSize:13}}>{label}</Text></View>;
  }
  const showSender=message.direction==='incoming'&&(!previous||previous.direction==='outgoing'||previous.peer!==message.peer);
  return <ChatMessageRow message={message} at={row.at} olderAt={timeline[index+1]?.at} time={messageTime(message.at)}
   owner={owner} disabled={disabled} highlighted={replyNavigation.isHighlighted(message)}
   senderName={showSender?memberName(message.peer):undefined} onSender={openSender}
   quoted={message.reply?findReply(message.reply):undefined} quoteAuthorName={message.reply?memberName(message.reply.author):undefined}
   onJump={replyNavigation.jump} onReply={replyToMessage} onMenu={openMessageMenu} onReact={reactToMessage} onSticker={setStickerPreview} onError={report}/>;
 }} />),[joinAvailable,busy,calls.rows,timeline,state.contacts,findReply,page.hasMore,page.loading,page.loadMore,owner,colors,disabled,navigation,route.params.id,messageTime,replyNavigation.highlight,replyNavigation.jump,chatScroll,header,composerHeight,g?.revision,g?.photo,g?.admin,work,openSender,replyToMessage,openMessageMenu,reactToMessage,languageSnapshot()]);

 return <KeyboardAvoidingScreen onLayout={onChatLayout} style={{flex:1,backgroundColor:colors.chatBg}} keyboardVerticalOffset={0} animateKeyboard onKeyboardAnimationChange={keyboardAnimationChanged}>

  <View style={{marginTop:g&&(!g.accepted||g.blocked||!g.members.includes(owner!))?header:0}}>
  {g&&!g.accepted&&!g.blocked&&<View style={[styles.requestBanner,{backgroundColor:colors.surface}]}><Text style={{color:colors.text,flex:1}}>{g.recoveryPending?t("Confirm recovered group"):t("Group invitation")}</Text><Pressable accessibilityLabel={g.recoveryPending?t("Review recovered group"):t("Accept group")} onPress={()=>g.recoveryPending?Alert.alert(t("Confirm recovered group"),g.name+'\n\nThese older group details came from another member and have no creator signature. Confirm only if the name and members are correct.\n\n'+g.members.join('\n'),[{text:t("Cancel"),style:'cancel'},{text:'Confirm',onPress:()=>void conversations().configureGroup(g.id,{accepted:true}).catch(report)}]):void conversations().configureGroup(g.id,{accepted:true}).catch(report)}><Text style={{color:colors.primary}}>{g.recoveryPending?'Review':t("Accept")}</Text></Pressable></View>}

  {g?.blocked&&<Text style={{color:colors.error,padding:12}}>{t("This group is blocked.")}</Text>}{g&&!g.members.includes(owner!)&&<Text style={{color:colors.textSecondary,padding:12}}>{t("You are no longer a member.")}</Text>}

  </View>

  {page.initialLoading?<ChatHistoryLoading error={page.error} retry={page.retry}/>:messageList}
  {!page.initialLoading&&showScrollToBottom&&<ChatScrollToBottom bottom={composerHeight+12} onPress={scrollToBottom}/>}

  <View pointerEvents="box-none" onLayout={event=>setComposerHeight(event.nativeEvent.layout.height)} style={{position:'absolute',left:0,right:0,bottom:0,zIndex:2}}>





  {stickerPreview&&<StickerPreview sticker={stickerPreview} userId={owner??undefined} onClose={()=>setStickerPreview(undefined)}/>}

  {menu&&<RootMessageMenu info={()=>navigation.navigate('GroupMessageInfo',{group:route.params.id,messageId:menu.group!.messageId,author:menu.direction==='outgoing'?owner!:menu.peer})} pageY={menuY} message={menu} createSticker={uri=>{setStickerSource(uri);setStickers(true);}} forward={()=>setForwardMessage(menu)} close={()=>setMenu(undefined)} copy={()=>void Clipboard.setStringAsync(menu.text).catch(report)} reply={()=>{setEditing(undefined);setReply(target(menu));}} edit={()=>{setReply(undefined);setEditing(menu);setText(menu.text);}} remove={()=>Alert.alert(t("Delete message?"),t("Group members will see a deleted-message placeholder."),[{text:t("Cancel"),style:'cancel'},{text:t("Delete"),style:'destructive',onPress:()=>void act(menu,'delete')}])} react={value=>void act(menu,'reaction',value)}/>}


  {forwardMessage&&<RootForwardPicker message={forwardMessage} contacts={state.contacts} groups={state.groups} onClose={()=>setForwardMessage(undefined)}/>}

  {callKind&&g&&owner&&<GroupCallPicker name={g.name} initialKind={callKind} members={g.members.filter(id=>id!==owner).map(id=>({id,name:state.contacts.find(c=>c.account===id)?.alias||shortIdentity(id),avatar:state.avatarUris[id],blocked:!!state.contacts.find(c=>c.account===id)?.blocked}))} onClose={()=>setCallKind(undefined)} onCall={(ids,kind)=>calling.startGroup({...g,members:[owner,...ids]},kind,()=>ensureRootCallPermissions(kind)).then(()=>{})}/>}
  {attachmentPreview.modal}

  <AttachmentMenu visible={attach} onClose={()=>setAttach(false)} onCamera={()=>{setAttach(false);void work(async()=>{const queued=await pickRootGroupMedia(route.params.id,'camera',attachmentPreview.confirm,reply,attachmentPreview.capture);if(queued){clearReply();scrollToBottom();}});}} onMultimedia={()=>{setAttach(false);void work(async()=>{const queued=await pickRootGroupMedia(route.params.id,'library',attachmentPreview.confirm,reply);if(queued){clearReply();scrollToBottom();}});}} onFiles={()=>{setAttach(false);void work(async()=>{const queued=await pickRootGroupAttachment(route.params.id,attachmentPreview.confirm,reply);if(queued){clearReply();scrollToBottom();}});}}/>

  {stickers&&owner&&<StickerPicker ownerId={owner} initialUri={stickerSource} draftStorage={rootStickerDraft(owner)} onClose={()=>{setStickers(false);setStickerSource(undefined);}} onSend={s=>work(async()=>{await messaging.sendGroupText(route.params.id,stickerMessage(s),reply,owner);clearReply();scrollToBottom();})} onSendImported={s=>work(async()=>{const uri=importedStickerUri(owner,s);await queueRootGroupAttachmentSource(await rootGroupAttachmentAudience(route.params.id,reply),uri,IMPORTED_STICKER_CONTENT,await stickerFileMime(uri));clearReply();scrollToBottom();})}/>}

  <ChatComposer replyPreview={(reply||editing)&&<ComposerReplyPreview editing={!!editing} cancelLabel={t("Cancel group reply or edit")} onCancel={()=>{setReply(undefined);if(editing)setText('');setEditing(undefined);}}><Text numberOfLines={1} style={[styles.replyPreviewName,{color:colors.primary}]}>{editing?t("Editing message"):reply!.author===owner?t("Replying to yourself"):t("Replying to ")+memberName(reply!.author)}</Text><RootReplyContent hideMediaLabel={!editing} message={editing??findReply(reply!)}/></ComposerReplyPreview>} peer={route.params.id} onError={report} ref={composer} owner={owner} groupId={route.params.id} disabled={disabled} cannotCompose={cannotCompose} editing={!!editing} reply={reply} onSend={send} onAttach={()=>setAttach(true)} onCamera={()=>{void work(async()=>{const queued=await pickRootGroupMedia(route.params.id,'camera',attachmentPreview.confirm,reply,attachmentPreview.capture);if(queued){clearReply();scrollToBottom();}});}} onStickers={()=>setStickers(true)} onRecording={value=>{for(const peer of g?.members??[])if(peer!==owner)activity.notifyRecording(peer,value);}} onSent={mediaSent} onTyping={value=>{for(const peer of g?.members??[])if(peer!==owner)activity.notify(peer,value);}}/>


  </View>

 </KeyboardAvoidingScreen>;

}
