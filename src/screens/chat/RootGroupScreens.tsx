import RootMediaSize from '../../components/chat/RootMediaSize';
import RootMessageReactions from '../../components/chat/RootMessageReactions';
import {dismissRootConversationNotifications} from '../../modules/messaging/notifications';
import type {TextInput as NativeTextInput} from 'react-native';
import {KeyboardAvoidingScreen,KeyboardFormScrollView} from '../../components/ui/KeyboardForm';
import {KeyboardAwareTextInput as TextInput} from '../../components/ui/KeyboardForm';
import StickerPreview from '../../components/chat/sticker-preview';
import type {Sticker} from '../../services/stickers';
import {groupPhotoUri} from '../../components/chat/group-photo';
import RootForwardPicker from '../../components/chat/RootForwardPicker';

import {useChatActivity} from '../../modules/ui/useChatActivity';

import {useChatDraft} from '../../hooks/use-chat-draft';

import {useAttachmentPreview} from '../../components/chat/AttachmentPreview';

import {useChatSnapshot} from '../../modules/ui/useChatSnapshot';

import {rootMessageStatus,deliveryStatusIcon,deliveryStatusLabel} from '../../modules/messaging';

import {pickRootGroupAttachment} from '../../modules/ui/documentPicker';

import ReplySwipe from '../../components/chat/ReplySwipe';

import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';

import Avatar from '../../components/ui/Avatar';

import Input from '../../components/ui/Input';

import SmartMessageText from '../../components/SmartMessageText';

import ChatHeaderIdentity from '../../components/chat/ChatHeaderIdentity';

import {groupCreateStyles as createStyles} from './group-create-styles';

import {groupInfoStyles as infoStyles} from './group-info-styles';

import {shortIdentity,parseIdentityInput} from '../../modules/identity';

import * as Clipboard from 'expo-clipboard';

import RootMessageMenu from '../../components/chat/RootMessageMenu';

import type {RootChatMessage,RootChatReply} from '../../modules/messaging';

import React,{useEffect,useLayoutEffect,useState} from 'react';

import {AppState,Modal,FlatList,Pressable,Text,TouchableOpacity,View} from 'react-native';

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

import {messageBubbleStyles as bubbles} from '../../components/chat/message-bubble-styles';

import RootAttachmentBubble from '../../components/RootAttachmentBubble';

import RootVoiceComposer from '../../components/chat/RootVoiceComposer';

import AttachmentMenu from '../../components/chat/AttachmentMenu';

import StickerPicker from '../../components/chat/sticker-picker';

import StickerArt from '../../components/chat/sticker-art';

import {parseSticker,stickerMessage} from '../../services/stickers';

import {rootStickerDraft} from '../../modules/messaging';

import {importedStickerUri,stickerFileMime} from '../../services/imported-stickers';

import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';

import {attachmentDigest} from '../../modules/messaging';

import {rootGroupAttachmentAudience,queueRootGroupAttachmentSource,rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../../modules/messaging';

import {pickRootGroupMedia} from '../../modules/ui/mediaPicker';

type Screen<P extends keyof RootAccountRoutes>=NativeStackScreenProps<RootAccountRoutes,P>;

function messagePreview(message?:RootChatMessage){return !message?'Original message unavailable on this device':message.deleted?'Message deleted':message.attachment?.name===IMPORTED_STICKER_CONTENT||parseSticker(message.text)?'Sticker':message.attachment?.caption||message.attachment?.name||message.text;}

const report=(e:unknown)=>Alert.alert('Axonic',e instanceof Error?e.message:'Please try again');

function useGroups(){const {state,error}=useChatSnapshot();useEffect(()=>{if(error)report(error);},[error]);return state;}

export function RootGroupCreate({navigation}:Screen<'GroupCreate'>){

 const {colors}=useTheme(),state=useGroups(),[name,setName]=useState(''),[code,setCode]=useState(''),[members,setMembers]=useState<string[]>([]),[busy,setBusy]=useState(false);

 const insets=useSafeAreaInsets(),owner=localAccount.status().account,add=(peer:string)=>{if(peer===owner){report(Error('You are already in the group'));return;}setMembers(old=>old.includes(peer)?old.filter(p=>p!==peer):old.length<9?[...old,peer]:old);};

 async function create(){if(busy||!name.trim()||!members.length)return;setBusy(true);try{const id=await messaging.createGroup(name,members);navigation.replace('GroupRoom',{id});}catch(e){report(e);}finally{setBusy(false);}}

 const rows=[...state.contacts.filter(c=>!c.blocked),...members.filter(p=>!state.contacts.some(c=>c.account===p)).map(account=>({account,alias:'',blocked:false,accepted:true}))];

 return <KeyboardAvoidingScreen style={[createStyles.container,{backgroundColor:colors.background}]}><KeyboardFormScrollView avoidKeyboard={false} style={{flexGrow:0,flexShrink:1}} contentContainerStyle={createStyles.form}><Input accessibilityLabel="Group name" placeholder="Group name" value={name} onChangeText={setName} maxLength={80}/><Text style={[createStyles.helper,{color:colors.textSecondary}]}>{members.length}/9 members selected</Text><View style={{flexDirection:'row',alignItems:'center',gap:8}}><View style={{flex:1}}><Input accessibilityLabel="Group member identity" placeholder="Paste an axon code…" autoCapitalize="none" autoCorrect={false} value={code} onChangeText={setCode}/></View><TouchableOpacity accessibilityLabel="Add identity" disabled={busy} onPress={()=>{const account=parseIdentityInput(code);if(!account){report(Error('Enter a complete Axonic identity'));return;}add(account);setCode('');}}><Ionicons name="add-circle-outline" size={28} color={colors.primary}/></TouchableOpacity></View></KeyboardFormScrollView>

  <FlatList keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" data={rows} keyExtractor={c=>c.account} contentContainerStyle={rows.length?[createStyles.list,{paddingBottom:88+insets.bottom}]:createStyles.empty} ListEmptyComponent={<View style={createStyles.empty}><Ionicons name="people-outline" size={42} color={colors.textTertiary}/><Text style={[createStyles.emptyText,{color:colors.textSecondary}]}>Choose a contact or paste an identity above.</Text></View>} renderItem={({item:c})=><TouchableOpacity disabled={busy} style={[createStyles.contact,{borderBottomColor:colors.divider}]} onPress={()=>add(c.account)}><Avatar name={c.alias||shortIdentity(c.account)} size={46}/><View style={createStyles.contactInfo}><Text numberOfLines={1} style={[createStyles.contactName,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text><Text style={[createStyles.contactSub,{color:colors.textSecondary}]}>{shortIdentity(c.account)}</Text></View><Ionicons name={members.includes(c.account)?'checkmark-circle':'ellipse-outline'} size={26} color={members.includes(c.account)?colors.primary:colors.textTertiary}/></TouchableOpacity>}/>

  <View style={[createStyles.footer,{position:'relative',left:undefined,right:undefined,bottom:undefined,backgroundColor:colors.background,borderTopColor:colors.divider,paddingBottom:16+insets.bottom}]}><TouchableOpacity accessibilityLabel="Create group" disabled={busy||!name.trim()||!members.length} onPress={()=>void create()} style={[createStyles.createButton,{backgroundColor:busy||!name.trim()||!members.length?colors.surfaceVariant:colors.primary}]}><Ionicons name="people" size={19} color="#fff"/><Text style={createStyles.createText}>{busy?'Creating…':'Create group'}</Text></TouchableOpacity></View>

 </KeyboardAvoidingScreen>;

}

export function RootGroupInfo({route,navigation}:Screen<'GroupInfo'>){

 const {colors}=useTheme(),state=useGroups(),g=state.groups?.find(g=>g.id===route.params.id),owner=localAccount.status().account,[name,setName]=useState(''),[member,setMember]=useState(''),[renaming,setRenaming]=useState(false),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[choosingPhoto,setChoosingPhoto]=useState(false);

 useEffect(()=>{setName(g?.name??'');},[g?.name]);

 async function update(members:string[]){if(!g||busy)return;setBusy(true);try{await messaging.updateGroup(g.id,name,members);setAdding(false);setRenaming(false);setMember('');}catch(e){report(e);}finally{setBusy(false);}}

 async function setPhoto(photo:string|null){if(!g||busy)return;setBusy(true);try{await messaging.updateGroup(g.id,g.name,g.members,photo);setChoosingPhoto(false);}catch(e){report(e);}finally{setBusy(false);}}
 const photos=rootGroupMessages(state,route.params.id).filter(m=>m.direction==='outgoing'&&!m.deleted&&m.attachment&&/^(image|video)\//.test(m.attachment.mime)&&m.attachment.name!==IMPORTED_STICKER_CONTENT&&!!g&&!!groupPhotoUri({...state,groups:[{...g,photo:m.group!.messageId}]},g.id,owner));
 const insets=useSafeAreaInsets();

 if(!g)return <Text style={{color:colors.text,padding:24}}>Group unavailable</Text>;

 return <KeyboardFormScrollView style={{backgroundColor:colors.background}} contentContainerStyle={[infoStyles.list,{paddingBottom:insets.bottom+24}]} keyboardShouldPersistTaps="handled">

  <View style={[infoStyles.hero,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><TouchableOpacity disabled={g.admin!==owner||busy} accessibilityLabel={g.admin===owner?'Change group photo':'Group photo'} style={infoStyles.photoWrap} onPress={()=>setChoosingPhoto(true)}><Avatar name={g.name} uri={groupPhotoUri(state,g.id,owner)} size={82}/>{g.admin===owner&&<View style={[infoStyles.cameraBadge,{backgroundColor:colors.primary}]}><Ionicons name="camera" size={16} color={colors.textInverse}/></View>}</TouchableOpacity><View style={infoStyles.nameRow}><Text numberOfLines={1} style={[infoStyles.name,{color:colors.text}]}>{g.name}</Text>{g.admin===owner&&<TouchableOpacity accessibilityLabel="Rename group" onPress={()=>setRenaming(!renaming)}><Ionicons name="pencil" size={19} color={colors.primary}/></TouchableOpacity>}</View><Text style={[infoStyles.count,{color:colors.textSecondary}]}>{g.members.length} members</Text><View style={[infoStyles.divider,{backgroundColor:colors.divider}]}/><View style={infoStyles.heroActions}><TouchableOpacity style={infoStyles.heroAction} onPress={()=>navigation.navigate('GroupRoom',{id:g.id})}><View style={[infoStyles.heroActionIcon,{backgroundColor:colors.highlight,borderColor:colors.neonBorder}]}><Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary}/></View><Text style={[infoStyles.heroActionText,{color:colors.text}]}>Message</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={g.muted?'Unmute group':'Mute group'} disabled={busy} style={infoStyles.heroAction} onPress={()=>void conversations().configureGroup(g.id,{muted:!g.muted}).catch(report)}><View style={[infoStyles.heroActionIcon,{backgroundColor:colors.highlight,borderColor:colors.neonBorder}]}><Ionicons name={g.muted?'notifications-off-outline':'notifications-outline'} size={22} color={colors.primary}/></View><Text style={[infoStyles.heroActionText,{color:colors.text}]}>{g.muted?'Unmute':'Mute'}</Text></TouchableOpacity></View></View>

  {renaming&&g.admin===owner&&<View style={{padding:16}}><Input accessibilityLabel="Group name" value={name} onChangeText={setName} maxLength={80}/><TouchableOpacity disabled={busy||!name.trim()} onPress={()=>void update(g.members)}><Text style={{color:colors.primary}}>Save group name</Text></TouchableOpacity></View>}

  {g.admin===owner&&<TouchableOpacity style={[infoStyles.action,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]} onPress={()=>setAdding(!adding)}><Ionicons name="person-add-outline" size={20} color={colors.primary}/><Text style={[infoStyles.actionText,{color:colors.text}]}>Add members</Text></TouchableOpacity>}

  {adding&&g.admin===owner&&<View style={{padding:16}}><Input accessibilityLabel="New group member identity" value={member} onChangeText={setMember} placeholder="Paste an axon code…" autoCapitalize="none" autoCorrect={false}/><TouchableOpacity disabled={busy} onPress={()=>{const account=parseIdentityInput(member);if(!account){report(Error('Enter a complete Axonic identity'));return;}void update([...new Set([...g.members,account])]);}}><Text style={{color:colors.primary}}>Add identity</Text></TouchableOpacity>{state.contacts.filter(c=>!c.blocked&&!g.members.includes(c.account)).map(c=><TouchableOpacity key={c.account} disabled={busy} style={infoStyles.contact} onPress={()=>void update([...g.members,c.account])}><Avatar name={c.alias||shortIdentity(c.account)} size={44}/><View style={infoStyles.memberInfo}><Text style={[infoStyles.memberName,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text></View><Ionicons name="add-circle-outline" size={26} color={colors.primary}/></TouchableOpacity>)}</View>}

  <Text style={[infoStyles.section,{color:colors.textSecondary}]}>MEMBERS</Text>{g.members.map(p=><View key={p} style={[infoStyles.member,{borderBottomColor:colors.divider}]}><Avatar name={p===owner?'You':state.contacts.find(c=>c.account===p)?.alias||shortIdentity(p)} size={44}/><View style={infoStyles.memberInfo}><Text style={[infoStyles.memberName,{color:colors.text}]}>{p===owner?'You':state.contacts.find(c=>c.account===p)?.alias||shortIdentity(p)}</Text><Text style={[infoStyles.memberSub,{color:colors.textSecondary}]}>{shortIdentity(p)}</Text></View>{p===g.admin&&<Text style={[infoStyles.admin,{color:colors.primary,borderColor:colors.primary}]}>ADMIN</Text>}{g.admin===owner&&p!==owner&&<TouchableOpacity accessibilityLabel="Remove member" disabled={busy} style={infoStyles.remove} onPress={()=>Alert.alert('Remove member?','This changes the group membership for everyone.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void update(g.members.filter(m=>m!==p))}])}><Ionicons name="person-remove-outline" size={20} color={colors.error}/></TouchableOpacity>}</View>)}

  <View style={infoStyles.footer}><TouchableOpacity style={[infoStyles.leave,{borderColor:colors.error}]} onPress={()=>void conversations().configureGroup(g.id,{blocked:!g.blocked}).catch(report)}><Ionicons name="ban-outline" size={19} color={colors.error}/><Text style={[infoStyles.leaveText,{color:colors.error}]}>{g.blocked?'Unblock group':'Block group'}</Text></TouchableOpacity><TouchableOpacity disabled={busy} style={[infoStyles.leave,{borderColor:colors.error,marginTop:16}]} onPress={()=>Alert.alert(g.admin===owner?'Close group?':'Leave group?',g.admin===owner?'All other members will be removed.':'A leave request will be delivered to the creator.',[{text:'Cancel',style:'cancel'},{text:'Confirm',style:'destructive',onPress:()=>void messaging.leaveGroup(g.id).then(()=>navigation.goBack()).catch(report)}])}><Ionicons name="exit-outline" size={19} color={colors.error}/><Text style={[infoStyles.leaveText,{color:colors.error}]}>{g.admin===owner?'Close group':'Leave group'}</Text></TouchableOpacity></View>

 <Modal visible={choosingPhoto&&g.admin===owner} animationType="slide" onRequestClose={()=>setChoosingPhoto(false)}><View style={[infoStyles.picker,{backgroundColor:colors.background,paddingTop:insets.top,paddingBottom:insets.bottom}]}><View style={[infoStyles.pickerHeader,{borderBottomColor:colors.divider}]}><Text style={[infoStyles.modalTitle,{color:colors.text}]}>Group photo</Text><TouchableOpacity accessibilityLabel="Close group photo picker" onPress={()=>setChoosingPhoto(false)}><Ionicons name="close" size={26} color={colors.text}/></TouchableOpacity></View><FlatList data={photos} keyExtractor={m=>m.group!.messageId} ListHeaderComponent={<Text style={{color:colors.textSecondary,padding:16}}>Choose a photo you shared in this group. To use a new photo, send it in the chat first.</Text>} ListEmptyComponent={<Text style={[infoStyles.empty,{color:colors.textSecondary}]}>No shared photos available.</Text>} renderItem={({item:m})=><TouchableOpacity disabled={busy} style={[infoStyles.contact,{borderBottomColor:colors.divider}]} onPress={()=>void setPhoto(m.group!.messageId)}><Avatar name="Photo" uri={groupPhotoUri({...state,groups:[{...g,photo:m.group!.messageId}]},g.id,owner)} size={54}/><View style={infoStyles.memberInfo}><Text numberOfLines={1} style={[infoStyles.memberName,{color:colors.text}]}>{m.attachment!.caption||m.attachment!.name}</Text><Text style={[infoStyles.memberSub,{color:colors.textSecondary}]}>{new Date(m.at).toLocaleDateString()}</Text></View>{g.photo===m.group!.messageId&&<Ionicons name="checkmark-circle" size={24} color={colors.primary}/>}</TouchableOpacity>}/>{!!g.photo&&<TouchableOpacity disabled={busy} style={[infoStyles.leave,{margin:16,borderColor:colors.error}]} onPress={()=>void setPhoto(null)}><Text style={[infoStyles.leaveText,{color:colors.error}]}>Remove group photo</Text></TouchableOpacity>}</View></Modal>

 </KeyboardFormScrollView>;

}

export function RootGroupRoom({route,navigation}:Screen<'GroupRoom'>){const {colors}=useTheme(),state=useGroups(),g=state.groups?.find(g=>g.id===route.params.id),owner=localAccount.status().account,header=useHeaderHeight(),insets=useSafeAreaInsets(),[text,setText]=useChatDraft(owner,'group:'+route.params.id),[reply,setReply]=useState<RootChatReply>(),[editing,setEditing]=useState<RootChatMessage>(),[menu,setMenu]=useState<RootChatMessage>(),[busy,setBusy]=useState(false),[attach,setAttach]=useState(false),[stickers,setStickers]=useState(false),[voice,setVoice]=useState(false),[transfers,setTransfers]=useState<Awaited<ReturnType<typeof rootAttachmentProgress>>>({jobs:[],selections:[]});

 const [stickerSource,setStickerSource]=useState<string>();
 const [stickerPreview,setStickerPreview]=useState<Sticker>();
 const [menuY,setMenuY]=useState<number>();
 const [forwardMessage,setForwardMessage]=useState<RootChatMessage>();

 const attachmentPreview=useAttachmentPreview(),activity=useChatActivity(route.params.id);

 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active'),unread=state.messages.filter(m=>m.group?.id===route.params.id&&m.direction==='incoming'&&!m.read).length;

 useEffect(()=>{const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>listener.remove();},[]);

 useEffect(()=>{if(focused&&foreground&&g?.accepted&&!g.blocked&&unread)void conversations().markGroupRead(route.params.id).catch(report);},[focused,foreground,g?.accepted,g?.blocked,unread,route.params.id]);

 useEffect(()=>{if(!focused||!foreground)return;let active=true,running=false,last='';const refresh=async()=>{if(running)return;running=true;try{const v=await rootAttachmentProgress(),raw=JSON.stringify(v);if(active&&raw!==last){last=raw;setTransfers(v);}}catch{}finally{running=false;}};void refresh();const t=setInterval(()=>void refresh(),700);return()=>{active=false;clearInterval(t);};},[focused,foreground]);

 useLayoutEffect(()=>navigation.setOptions({headerTitleAlign:'left',headerBackVisible:false,headerTitle:'',headerLeft:()=> <ChatHeaderIdentity onBack={()=>navigation.goBack()} title={g?.name??'Group'} syncing={false} avatarUri={groupPhotoUri(state,route.params.id,owner)} isGroup isOnline={false} color={colors.headerText} onPress={()=>navigation.navigate('GroupInfo',{id:route.params.id})}/>}),[navigation,g?.name,route.params.id,colors.headerText,state,owner]);

 const composer=React.useRef<NativeTextInput>(null);
 useEffect(()=>{const blur=()=>composer.current?.blur();const remove=navigation.addListener('beforeRemove',blur),unfocus=navigation.addListener('blur',blur);return()=>{remove();unfocus();};},[navigation]);
 const cannotCompose=!g||g.blocked||!g.accepted||!g.members.includes(owner!);
 const disabled=busy||cannotCompose;
 useEffect(()=>{if(focused&&foreground&&owner)void dismissRootConversationNotifications(owner,{group:route.params.id}).catch(()=>{});},[focused,foreground,owner,route.params.id]);

 async function work(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);try{await fn();}catch(e){report(e);}finally{setBusy(false);}}

 const clearReply=React.useCallback(()=>setReply(current=>current===reply?undefined:current),[reply]);
 const target=(m:RootChatMessage):RootChatReply=>({id:m.group!.messageId,author:m.direction==='outgoing'?owner!:m.peer});

 const act=(m:RootChatMessage,kind:'edit'|'delete'|'reaction',value='')=>work(async()=>{await messaging.actGroup(route.params.id,target(m),kind,value,owner);});

 const send=(value:string)=>{composer.current?.focus();return work(async()=>{if(editing)await messaging.actGroup(route.params.id,target(editing),'edit',value,owner);else await messaging.sendGroupText(route.params.id,value,reply,owner);setText(current=>current===value?'':current);for(const peer of g?.members??[])if(peer!==owner)activity.notify(peer,false);setReply(undefined);setEditing(undefined);});};

 const messages=rootGroupMessages(state,route.params.id).reverse();
 const memberName=(account:string)=>account===owner?'You':state.contacts.find(c=>c.account===account)?.alias||shortIdentity(account);
 const findReply=(reference:RootChatReply)=>messages.find(q=>q.group?.messageId===reference.id&&(q.direction==='outgoing'?owner:q.peer)===reference.author);


 return <KeyboardAvoidingScreen style={{flex:1,backgroundColor:colors.chatBg}} keyboardVerticalOffset={header}>

  {g&&!g.accepted&&!g.blocked&&<View style={[styles.requestBanner,{backgroundColor:colors.surface}]}><Text style={{color:colors.text,flex:1}}>{g.recoveryPending?'Confirm recovered group':'Group invitation'}</Text><Pressable accessibilityLabel={g.recoveryPending?'Review recovered group':'Accept group'} onPress={()=>g.recoveryPending?Alert.alert('Confirm recovered group',g.name+'\n\nThese older group details came from another member and have no creator signature. Confirm only if the name and members are correct.\n\n'+g.members.join('\n'),[{text:'Cancel',style:'cancel'},{text:'Confirm',onPress:()=>void conversations().configureGroup(g.id,{accepted:true}).catch(report)}]):void conversations().configureGroup(g.id,{accepted:true}).catch(report)}><Text style={{color:colors.primary}}>{g.recoveryPending?'Review':'Accept'}</Text></Pressable></View>}

  {g?.blocked&&<Text style={{color:colors.error,padding:12}}>This group is blocked.</Text>}{g&&!g.members.includes(owner!)&&<Text style={{color:colors.textSecondary,padding:12}}>You are no longer a member.</Text>}

  <FlatList inverted data={messages} keyExtractor={m=>(m.direction==='outgoing'?'own':m.peer)+':'+m.group!.messageId} style={styles.messageList} contentContainerStyle={styles.messagesList} keyboardShouldPersistTaps="handled" renderItem={({item:m})=>{const mine=m.direction==='outgoing',sticker=parseSticker(m.text);return <ReplySwipe disabled={disabled||m.deleted} onReply={()=>{setEditing(undefined);setReply(target(m));}}><View style={[bubbles.bubbleRow,mine?bubbles.bubbleRowRight:bubbles.bubbleRowLeft]}><RootMessageReactions message={m} owner={owner} disabled={disabled} onReact={value=>void act(m,'reaction',value)}><Pressable onLongPress={event=>{if(!disabled&&!m.deleted){setMenuY(event.nativeEvent.pageY);setMenu(m);}}} style={[bubbles.bubble,mine?bubbles.bubbleSent:bubbles.bubbleReceived,{backgroundColor:mine?colors.bubbleSent:colors.bubbleReceived,borderColor:colors.neonBorder,minWidth:m.attachment?260:96},!m.deleted&&m.attachment&&bubbles.mediaBubble,!m.deleted&&m.attachment?.mime.startsWith('audio/')&&bubbles.voiceBubble,!m.deleted&&m.attachment&&/^(image|video)\//.test(m.attachment.mime)&&m.attachment.name!==IMPORTED_STICKER_CONTENT&&bubbles.photoBubble,!m.deleted&&(sticker||m.attachment?.name===IMPORTED_STICKER_CONTENT)&&bubbles.stickerBubble]}>{!mine&&<Text numberOfLines={1} style={[bubbles.senderName,{color:colors.primary}]}>{state.contacts.find(c=>c.account===m.peer)?.alias||shortIdentity(m.peer)}</Text>}{!m.deleted&&m.reply&&<View style={[bubbles.quoteBlock,{borderLeftColor:colors.primary,backgroundColor:colors.surfaceVariant}]}><Text numberOfLines={1} style={[bubbles.quoteName,{color:colors.primary}]}>{memberName(m.reply.author)}</Text><Text numberOfLines={2} style={[bubbles.quoteText,{color:colors.textSecondary}]}>{messagePreview(findReply(m.reply))}</Text></View>}{m.attachment&&!m.deleted?<RootAttachmentBubble onLongPress={event=>{if(!disabled){setMenuY(event.nativeEvent.pageY);setMenu(m);}}} message={m} progress={transfers.jobs.find(j=>j.digest===attachmentDigest(m.attachment!.manifest))} onError={report}/>:sticker&&!m.deleted?<Pressable accessibilityLabel={sticker.label+' sticker'} onPress={()=>setStickerPreview(sticker)}><StickerArt sticker={sticker} size={150}/></Pressable>:m.deleted?<Text style={[bubbles.deletedText,{color:colors.textSecondary}]}>Message deleted</Text>:<SmartMessageText style={[bubbles.messageText,{color:colors.text}]} linkColor={colors.primary}>{m.text}</SmartMessageText>}<View style={bubbles.metaRow}><RootMediaSize message={m}/>{m.edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>Edited </Text>}<Text style={[bubbles.timeText,{color:colors.textTertiary}]}>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text>{mine&&<Ionicons accessibilityLabel={deliveryStatusLabel(rootMessageStatus(m))} name={deliveryStatusIcon(rootMessageStatus(m))} size={13} color={rootMessageStatus(m)==='read'?colors.checkBlue:colors.textTertiary}/>}</View></Pressable></RootMessageReactions></View></ReplySwipe>;}}/>

  {!!activity.typing.length&&<Text style={{color:colors.primary,padding:8}}>{activity.typing.filter(p=>g?.members.includes(p)).map(p=>state.contacts.find(c=>c.account===p)?.alias||shortIdentity(p)).join(', ')} typing…</Text>}

  {transfers.selections.filter(s=>s.group?.id===route.params.id).map(s=><View key={s.id} style={{padding:8}}><Text style={{color:colors.textSecondary}}>{s.name} · {s.failed?'Could not prepare attachment':'Preparing attachment…'}</Text>{s.failed&&<View style={{flexDirection:'row',gap:20}}><Pressable onPress={()=>void retryRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Retry</Text></Pressable><Pressable onPress={()=>void removeRootAttachmentSelection(s.id).catch(report)}><Text style={{color:colors.primary}}>Remove</Text></Pressable></View>}</View>)}

  {stickerPreview&&<StickerPreview sticker={stickerPreview} userId={owner??undefined} onClose={()=>setStickerPreview(undefined)}/>}

  {menu&&<RootMessageMenu info={()=>navigation.navigate('GroupMessageInfo',{group:route.params.id,messageId:menu.group!.messageId,author:menu.direction==='outgoing'?owner!:menu.peer})} pageY={menuY} message={menu} onMediaChanged={()=>setTransfers(current=>({...current}))} createSticker={uri=>{setStickerSource(uri);setStickers(true);}} forward={()=>setForwardMessage(menu)} close={()=>setMenu(undefined)} copy={()=>void Clipboard.setStringAsync(menu.text).catch(report)} reply={()=>{setEditing(undefined);setReply(target(menu));}} edit={()=>{setReply(undefined);setEditing(menu);setText(menu.text);}} remove={()=>Alert.alert('Delete message?','Group members will see a deleted-message placeholder.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void act(menu,'delete')}])} react={value=>void act(menu,'reaction',value)}/>}

  {(reply||editing)&&<View style={[styles.replyPreview,{backgroundColor:colors.surface,borderColor:colors.neonBorder,borderLeftColor:colors.primary}]}><View style={{flex:1}}><Text numberOfLines={1} style={[styles.replyPreviewName,{color:colors.primary}]}>{editing?'Editing message':reply!.author===owner?'Replying to yourself':'Replying to '+memberName(reply!.author)}</Text><Text numberOfLines={2} style={[styles.replyPreviewText,{color:colors.textSecondary}]}>{messagePreview(editing??findReply(reply!))}</Text></View><Pressable accessibilityLabel="Cancel group reply or edit" style={styles.replyPreviewClose} onPress={()=>{setReply(undefined);if(editing)setText('');setEditing(undefined);}}><Ionicons name="close" size={22} color={colors.text}/></Pressable></View>}

  {forwardMessage&&<RootForwardPicker message={forwardMessage} contacts={state.contacts} groups={state.groups} onClose={()=>setForwardMessage(undefined)}/>}

  {attachmentPreview.modal}

  <AttachmentMenu visible={attach} onClose={()=>setAttach(false)} onCamera={()=>{setAttach(false);void work(async()=>{const queued=await pickRootGroupMedia(route.params.id,'camera',attachmentPreview.confirm,reply);if(queued)clearReply();});}} onMultimedia={()=>{setAttach(false);void work(async()=>{const queued=await pickRootGroupMedia(route.params.id,'library',attachmentPreview.confirm,reply);if(queued)clearReply();});}} onFiles={()=>{setAttach(false);void work(async()=>{const queued=await pickRootGroupAttachment(route.params.id,attachmentPreview.confirm,reply);if(queued)clearReply();});}}/>

  {stickers&&owner&&<StickerPicker ownerId={owner} initialUri={stickerSource} draftStorage={rootStickerDraft(owner)} onClose={()=>{setStickers(false);setStickerSource(undefined);}} onSend={s=>work(async()=>{await messaging.sendGroupText(route.params.id,stickerMessage(s),reply,owner);clearReply();})} onSendImported={s=>work(async()=>{const uri=importedStickerUri(owner,s);await queueRootGroupAttachmentSource(await rootGroupAttachmentAudience(route.params.id,reply),uri,IMPORTED_STICKER_CONTENT,await stickerFileMime(uri));clearReply();})}/>}

  <View style={[styles.inputBar,{backgroundColor:colors.chatBg,borderTopColor:colors.neonBorder,paddingBottom:Math.max(insets.bottom,8)}]}><View style={styles.inputRowWrap}>{!voice&&<><TouchableOpacity accessibilityLabel="Attach" disabled={disabled||!!editing} onPress={()=>setAttach(true)} style={[styles.attachBtn,{borderColor:colors.neonBorder,backgroundColor:colors.surface,shadowColor:colors.primary}]}><Ionicons name="add" size={25} color={colors.primary}/></TouchableOpacity><View style={[styles.inputRow,{backgroundColor:colors.surface,borderColor:colors.neonBorder,paddingLeft:12}]}><Pressable accessibilityLabel="Open stickers" disabled={disabled||!!editing} onPress={()=>setStickers(true)} style={styles.stickerBtn} hitSlop={4}><Ionicons name="happy-outline" size={24} color={colors.primary}/></Pressable><TextInput ref={composer} accessibilityLabel="New group message" placeholder="Compose message…" placeholderTextColor={colors.textTertiary} value={text} onChangeText={value=>{setText(value);for(const peer of g?.members??[])if(peer!==owner)activity.notify(peer,!!value.trim());}} multiline editable={!cannotCompose} maxLength={1600} style={[styles.textInput,{color:colors.text}]}/></View></>}{text.trim()||editing?<TouchableOpacity accessibilityLabel="Send group message" disabled={disabled||!text.trim()} onPress={()=>void send(text)} style={[styles.sendBtn,{backgroundColor:colors.primary,borderColor:colors.neonBorder,shadowColor:colors.primary,opacity:disabled||!text.trim()?0.45:1}]}><Text style={{color:colors.textInverse}}>▶</Text></TouchableOpacity>:<RootVoiceComposer peer={route.params.id} groupId={route.params.id} disabled={disabled||!!editing} reply={reply} onSent={clearReply} onActive={setVoice} onError={report}/>}</View></View>

 </KeyboardAvoidingScreen>;

}
