import {Chrome} from '../../theme';
import {t,languageSnapshot} from '../../localization/language';
import {useHeaderHeight} from '@react-navigation/elements';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {isGroupAvatarFile} from '../../services/group-avatar-file';
import {attachmentLabel} from '../../utils/attachment-label';
import {groupPhotoUri} from '../../components/chat/group-photo';
import {useChatActivity} from '../../modules/ui/useChatActivity';
import {useChatListSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import {messagePresentationStatus} from '../../modules/messaging';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import ChatAvatarActionModal from '../../components/chat/chat-avatar-action-modal';
import {shortIdentity} from '../../modules/identity';
import {parseSticker} from '../../services/stickers';
import {useCallback,useMemo,useEffect,useState} from 'react';
import {ActivityIndicator,BackHandler,FlatList,Pressable,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import ChatListRow from '../../components/chat/ChatListRow';
import {chatListStyles as listStyles,selectionBarHeight} from '../../components/chat/chat-list-styles';
import EmptyState from '../../components/ui/EmptyState';
import {messaging} from '../../modules/messaging';
import {localAccount} from '../../modules/identity';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report,formatHistoryTime} from '../rootScreenSupport';
export default function ChatList({navigation}:Screen<'Tabs'>){

 const activity=useChatActivity(),headerHeight=useHeaderHeight(),insets=useSafeAreaInsets();
 const bottomClearance=66+Math.max(insets.bottom,8)+8;

 const {colors}=useTheme(),{state,error,summaries,loading}=useOwnChat(true),[avatarPeer,setAvatarPeer]=useState<string|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());

 const toggle=useCallback((peer:string)=>setSelected(old=>{const next=new Set(old);next.has(peer)?next.delete(peer):next.add(peer);return next;}),[languageSnapshot()]);

 useEffect(()=>{if(!selected.size)return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setSelected(new Set());return true;});return()=>listener.remove();},[selected.size]);

 const deleteSelected=useCallback(()=>{const chats=[...selected],owner=localAccount.status().account;Alert.alert(chats.length===1?t("Delete chat?"):t("Delete chats?"),t("Remove these conversations and their messages from this device only. A new message will make a chat reappear. Saved contact decisions are kept."),[{text:t("Cancel"),style:'cancel'},{text:t("Delete"),style:'destructive',onPress:()=>void messaging.deleteChats(chats,owner).then(()=>setSelected(new Set())).catch(report)}]);},[selected,languageSnapshot()]);

 const markRead=useCallback(async(peers:string[])=>{await messaging.markRead(peers);setSelected(new Set());},[languageSnapshot()]);
 const openChat=useCallback((peer:string)=>peer.startsWith('group:')?navigation.navigate('GroupRoom',{id:peer.slice(6)}):navigation.navigate('ChatRoom',{peer}),[navigation,languageSnapshot()]);
 const openCall=useCallback((peer:string,kind:'voice'|'video')=>navigation.navigate('OutgoingCall',{peer,kind}),[navigation,languageSnapshot()]);
 const markOneRead=useCallback((peer:string)=>void markRead([peer]).catch(report),[markRead,languageSnapshot()]);

 const hasUnread=useMemo(()=>Object.values(summaries).some(s=>s.unread>0),[summaries]);


 const directory=useMemo(()=>{
  const hidden=new Set(state.hiddenChats);
  return [...state.contacts,...(state.groups??[]).map(g=>({account:'group:'+g.id,alias:g.name,blocked:g.blocked,accepted:g.accepted,muted:g.muted}))]
   .filter(c=>!hidden.has(c.account));
 },[state.contacts,state.groups,state.hiddenChats]);
 const contacts=useMemo(()=>[...directory].sort((a,b)=>(summaries[b.account]?.last?.at??0)-(summaries[a.account]?.last?.at??0)),[directory,summaries]);
 const separator=useCallback(()=><View style={[listStyles.separator,{backgroundColor:colors.divider}]}/>,[colors.divider]);


 const selectionMode=selected.size>0;
 const listTop=headerHeight+(selectionMode?selectionBarHeight+8:0);

 // Focus changes should not rebuild unchanged rows or remount separators.
 const chatList=useMemo(()=>(<FlatList data={contacts} keyExtractor={c=>c.account} contentContainerStyle={[contacts.length?listStyles.list:listStyles.emptyContainer,{paddingTop:listTop,paddingBottom:bottomClearance+80}]} scrollIndicatorInsets={{top:listTop,bottom:bottomClearance}}

   ListHeaderComponent={<>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:16}}>{error}</Text>}

   </>}

   ListEmptyComponent={loading?<View accessibilityRole="progressbar" accessibilityLabel={t("Loading chats")} accessibilityState={{busy:true}} style={{alignItems:'center',gap:12,padding:32}}><ActivityIndicator color={colors.primary} size="small"/><Text style={{color:colors.textSecondary}}>{t("Loading chats…")}</Text></View>:error?null:<EmptyState iconName="chatbubbles-outline" title={t("No channels open")} subtitle={t("Start a chat with someone's identity code")}/>}

   ItemSeparatorComponent={separator}

   renderItem={({item:c})=>{const summary=summaries[c.account],m=summary?.last;return <ChatListRow roomId={c.account} displayName={c.alias||shortIdentity(c.account)} avatarUri={c.account.startsWith('group:')?groupPhotoUri(state,c.account.slice(6),localAccount.status().account):state.avatarUris[c.account]} isDirect={!c.account.startsWith('group:')} isOnline={activity.online.includes(c.account)}

    lastMsgContent={c.blocked?t('Blocked'):!c.accepted?(c.account.startsWith('group:')?t("Group invitation"):t("Message request")):m?.deleted?t("Message deleted"):m?.attachment?(c.account.startsWith('group:')&&isGroupAvatarFile(m.attachment)?t('Group avatar'):m.attachment.caption||attachmentLabel(m.attachment)):parseSticker(m?.text??'')?t("Sticker"):m?.text??null} lastMsgTime={m?formatHistoryTime(m.at):null}

    lastMsgFromMe={m?.direction==='outgoing'} lastMsgStatus={m?messagePresentationStatus(m):undefined} unread={summary?.unread??0} typingLabel={activity.typing.includes(c.account)?t("Typing…"):null} isMuted={c.muted===true} selectionMode={selected.size>0} selected={selected.has(c.account)} Colors={colors}

    onOpen={openChat} onAvatarPress={setAvatarPeer} onLongPress={toggle} onToggleSelection={toggle} onMarkRead={markOneRead} onCall={openCall}/>;}}/>),[contacts,colors,state,summaries,separator,activity.online,activity.typing,selected,openChat,toggle,markOneRead,openCall,listTop,bottomClearance,error,loading,languageSnapshot()]);

 return <View style={{flex:1,backgroundColor:colors.background}}>



  {chatList}
  {selectionMode&&<View style={[listStyles.selectionBar,{top:headerHeight,left:insets.left+Chrome.gutter,right:insets.right+Chrome.gutter,borderColor:colors.neonBorder,backgroundColor:colors.headerBg,shadowColor:colors.primary}]}><Pressable accessibilityLabel={t("Cancel selection")} onPress={()=>setSelected(new Set())}><Ionicons name="close" size={24} color={colors.primary}/></Pressable><Text style={[listStyles.selectionBarText,{color:colors.text}]}>{selected.size} {t("selected")}</Text><TouchableOpacity accessibilityLabel={t("Select all chats")} style={listStyles.selectionBarAction} onPress={()=>setSelected(new Set(selected.size===contacts.length?[]:contacts.map(c=>c.account)))}><Ionicons name="checkbox-outline" size={22} color={colors.primary}/></TouchableOpacity><TouchableOpacity style={listStyles.selectionBarAction} onPress={()=>void markRead([...selected]).catch(report)}><Ionicons name="checkmark-done" size={22} color={colors.primary}/><Text style={[listStyles.selectionBarText,{color:colors.primary}]}>{t("Mark read")}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={t("Delete selected chats")} style={listStyles.selectionBarAction} onPress={deleteSelected}><Ionicons name="trash-outline" size={22} color={colors.error}/><Text style={[listStyles.selectionBarText,{color:colors.error}]}>{t("Delete")}</Text></TouchableOpacity></View>}
  {selected.size===0&&hasUnread&&<View pointerEvents="box-none" style={[listStyles.markAllFloating,{bottom:bottomClearance+12}]}><TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Mark all as read")} activeOpacity={0.7} style={[listStyles.markAllBar,{backgroundColor:colors.tabBarBg,borderColor:colors.neonBorder,shadowColor:colors.primary}]} onPress={()=>void markRead(contacts.map(c=>c.account)).catch(report)}><Ionicons name="checkmark-done" size={20} color={colors.primary}/><Text numberOfLines={1} style={[listStyles.markAllText,{color:colors.primary}]}>{t("Mark all as read")}</Text></TouchableOpacity></View>}

  {avatarPeer&&<ChatAvatarActionModal visible avatarUri={avatarPeer.startsWith('group:')?groupPhotoUri(state,avatarPeer.slice(6),localAccount.status().account):state.avatarUris[avatarPeer]} name={contacts.find(c=>c.account===avatarPeer)?.alias||shortIdentity(avatarPeer)} subtitle={avatarPeer.startsWith('group:')?null:shortIdentity(avatarPeer)} isGroup={avatarPeer.startsWith('group:')} onClose={()=>setAvatarPeer(null)} onMessage={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupRoom',{id:avatarPeer.slice(6)}):navigation.navigate('ChatRoom',{peer:avatarPeer});}} onCall={avatarPeer.startsWith('group:')?undefined:()=>{setAvatarPeer(null);navigation.navigate('OutgoingCall',{peer:avatarPeer,kind:'voice'});}} onDetails={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupInfo',{id:avatarPeer.slice(6)}):navigation.navigate('Contact',{peer:avatarPeer});}}/>}

  <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("New chat")} activeOpacity={0.7} style={[listStyles.fab,{bottom:bottomClearance+12,backgroundColor:colors.tabBarBg,borderColor:colors.neonBorder,shadowColor:colors.primary}]} onPress={()=>navigation.navigate('NewChat')}><Ionicons name="add" size={28} color={colors.primary}/></TouchableOpacity>

 </View>;

}
