import {t,languageSnapshot} from '../../localization/language';
import {useHeaderHeight} from '@react-navigation/elements';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {attachmentLabel} from '../../utils/attachment-label';
import {groupPhotoUri} from '../../components/chat/group-photo';
import {useChatActivity} from '../../modules/ui/useChatActivity';
import {useChatListSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import {rootMessageStatus} from '../../modules/messaging';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import ChatAvatarActionModal from '../../components/chat/chat-avatar-action-modal';
import {shortIdentity} from '../../modules/identity';
import {parseSticker} from '../../services/stickers';
import {useCallback,useMemo,useEffect,useState} from 'react';
import {ActivityIndicator,BackHandler,FlatList,Pressable,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import ChatListRow from '../../components/chat/ChatListRow';
import {chatListStyles as listStyles} from '../../components/chat/chat-list-styles';
import EmptyState from '../../components/ui/EmptyState';
import {messaging} from '../../modules/messaging';
import {localAccount} from '../../modules/identity';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report,formatHistoryTime} from '../rootScreenSupport';
export default function ChatList({navigation}:Screen<'Tabs'>){

 const activity=useChatActivity(),headerHeight=useHeaderHeight(),insets=useSafeAreaInsets();
 const bottomClearance=66+Math.max(insets.bottom,8)+8;

 const {colors}=useTheme(),{state,error,summaries,loading}=useOwnChat(),[avatarPeer,setAvatarPeer]=useState<string|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());

 const toggle=useCallback((peer:string)=>setSelected(old=>{const next=new Set(old);next.has(peer)?next.delete(peer):next.add(peer);return next;}),[languageSnapshot()]);

 useEffect(()=>{if(!selected.size)return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setSelected(new Set());return true;});return()=>listener.remove();},[selected.size]);

 const deleteSelected=useCallback(()=>{const chats=[...selected],owner=localAccount.status().account;Alert.alert(chats.length===1?t("Delete chat?"):t("Delete chats?"),t("Remove these conversations and their messages from this device only. A new message will make a chat reappear. Saved contact decisions are kept."),[{text:t("Cancel"),style:'cancel'},{text:t("Delete"),style:'destructive',onPress:()=>void messaging.deleteChats(chats,owner).then(()=>setSelected(new Set())).catch(report)}]);},[selected,languageSnapshot()]);

 const markRead=useCallback(async(peers:string[])=>{await messaging.markRead(peers);setSelected(new Set());},[languageSnapshot()]);
 const openChat=useCallback((peer:string)=>peer.startsWith('group:')?navigation.navigate('GroupRoom',{id:peer.slice(6)}):navigation.navigate('ChatRoom',{peer}),[navigation,languageSnapshot()]);
 const openCall=useCallback((peer:string,kind:'voice'|'video')=>navigation.navigate('OutgoingCall',{peer,kind}),[navigation,languageSnapshot()]);
 const markOneRead=useCallback((peer:string)=>void markRead([peer]).catch(report),[markRead,languageSnapshot()]);

 const unreadCounts=useMemo(()=>new Map(Object.values(summaries).map(s=>[s.key,s.unread])),[summaries,languageSnapshot()]);
 const latest=useMemo(()=>new Map(Object.values(summaries).map(s=>[s.key,s.last])),[summaries,languageSnapshot()]);


 const contacts=useMemo(()=>[...state.contacts,...(state.groups??[]).map(g=>({account:'group:'+g.id,alias:g.name,blocked:g.blocked,accepted:g.accepted}))].filter(c=>!state.hiddenChats?.includes(c.account)).sort((a,b)=>(latest.get(b.account)?.at??0)-(latest.get(a.account)?.at??0)),[state.contacts,state.groups,state.hiddenChats,latest,languageSnapshot()]);


 // Focus changes should not rebuild unchanged rows or remount separators.
 const chatList=useMemo(()=>(<FlatList data={contacts} keyExtractor={c=>c.account} contentContainerStyle={[contacts.length?listStyles.list:listStyles.emptyContainer,{paddingTop:headerHeight,paddingBottom:bottomClearance+80}]} scrollIndicatorInsets={{top:headerHeight,bottom:bottomClearance}}

   ListHeaderComponent={<>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:16}}>{error}</Text>}

  {selected.size>0?<View style={[listStyles.selectionBar,{borderBottomColor:colors.divider}]}><Pressable accessibilityLabel={t("Cancel selection")} onPress={()=>setSelected(new Set())}><Ionicons name="close" size={24} color={colors.primary}/></Pressable><Text style={[listStyles.selectionBarText,{color:colors.text}]}>{selected.size} {t("selected")}</Text><TouchableOpacity accessibilityLabel={t("Select all chats")} style={listStyles.selectionBarAction} onPress={()=>setSelected(new Set(selected.size===contacts.length?[]:contacts.map(c=>c.account)))}><Ionicons name="checkbox-outline" size={22} color={colors.primary}/></TouchableOpacity><TouchableOpacity style={listStyles.selectionBarAction} onPress={()=>void markRead([...selected]).catch(report)}><Ionicons name="checkmark-done" size={22} color={colors.primary}/><Text style={[listStyles.selectionBarText,{color:colors.primary}]}>{t("Mark read")}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={t("Delete selected chats")} style={listStyles.selectionBarAction} onPress={deleteSelected}><Ionicons name="trash-outline" size={22} color={colors.error}/><Text style={[listStyles.selectionBarText,{color:colors.error}]}>{t("Delete")}</Text></TouchableOpacity></View>:null}
   </>}

   ListEmptyComponent={loading?<View accessibilityRole="progressbar" accessibilityLabel={t("Loading chats")} accessibilityState={{busy:true}} style={{alignItems:'center',gap:12,padding:32}}><ActivityIndicator color={colors.primary} size="small"/><Text style={{color:colors.textSecondary}}>{t("Loading chats…")}</Text></View>:error?null:<EmptyState iconName="chatbubbles-outline" title={t("No channels open")} subtitle={t("Start a chat with someone's identity code")}/>}

   ItemSeparatorComponent={()=><View style={[listStyles.separator,{backgroundColor:colors.divider}]}/>}

   renderItem={({item:c})=>{const m=latest.get(c.account);return <ChatListRow roomId={c.account} displayName={c.alias||shortIdentity(c.account)} avatarUri={c.account.startsWith('group:')?groupPhotoUri(state,c.account.slice(6),localAccount.status().account):state.avatarUris[c.account]} isDirect={!c.account.startsWith('group:')} isOnline={activity.online.includes(c.account)}

    lastMsgContent={c.blocked?t('Blocked'):!c.accepted?(c.account.startsWith('group:')?t("Group invitation"):t("Message request")):m?.deleted?t("Message deleted"):m?.attachment?(m.attachment.caption||attachmentLabel(m.attachment)):parseSticker(m?.text??'')?t("Sticker"):m?.text??null} lastMsgTime={m?formatHistoryTime(m.at):null}

    lastMsgFromMe={m?.direction==='outgoing'} lastMsgStatus={m?rootMessageStatus(m):undefined} unread={unreadCounts.get(c.account)??0} typingLabel={activity.typing.includes(c.account)?t("Typing…"):null} isMuted={c.account.startsWith('group:')?state.groups?.find(g=>g.id===c.account.slice(6))?.muted===true:state.contacts.find(contact=>contact.account===c.account)?.muted===true} selectionMode={selected.size>0} selected={selected.has(c.account)} Colors={colors}

    onOpen={openChat} onAvatarPress={setAvatarPeer} onLongPress={toggle} onToggleSelection={toggle} onMarkRead={markOneRead} onCall={openCall}/>;}}/>),[contacts,colors,state,latest,unreadCounts,activity.online,activity.typing,selected,openChat,toggle,markOneRead,openCall,headerHeight,bottomClearance,error,loading,markRead,deleteSelected,languageSnapshot()]);

 return <View style={{flex:1,backgroundColor:colors.background}}>



  {chatList}
  {selected.size===0&&Object.values(summaries).some(s=>s.unread>0)&&<View pointerEvents="box-none" style={[listStyles.markAllFloating,{bottom:bottomClearance+12}]}><TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Mark all as read")} activeOpacity={0.7} style={[listStyles.markAllBar,{backgroundColor:colors.tabBarBg,borderColor:colors.neonBorder,shadowColor:colors.primary}]} onPress={()=>void markRead(contacts.map(c=>c.account)).catch(report)}><Ionicons name="checkmark-done" size={20} color={colors.primary}/><Text numberOfLines={1} style={[listStyles.markAllText,{color:colors.primary}]}>{t("Mark all as read")}</Text></TouchableOpacity></View>}

  {avatarPeer&&<ChatAvatarActionModal visible avatarUri={avatarPeer.startsWith('group:')?groupPhotoUri(state,avatarPeer.slice(6),localAccount.status().account):state.avatarUris[avatarPeer]} name={contacts.find(c=>c.account===avatarPeer)?.alias||shortIdentity(avatarPeer)} subtitle={avatarPeer.startsWith('group:')?null:shortIdentity(avatarPeer)} isGroup={avatarPeer.startsWith('group:')} onClose={()=>setAvatarPeer(null)} onMessage={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupRoom',{id:avatarPeer.slice(6)}):navigation.navigate('ChatRoom',{peer:avatarPeer});}} onCall={avatarPeer.startsWith('group:')?undefined:()=>{setAvatarPeer(null);navigation.navigate('OutgoingCall',{peer:avatarPeer,kind:'voice'});}} onDetails={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupInfo',{id:avatarPeer.slice(6)}):navigation.navigate('Contact',{peer:avatarPeer});}}/>}

  <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("New chat")} activeOpacity={0.7} style={[listStyles.fab,{bottom:bottomClearance+12,backgroundColor:colors.tabBarBg,borderColor:colors.neonBorder,shadowColor:colors.primary}]} onPress={()=>navigation.navigate('NewChat')}><Ionicons name="add" size={28} color={colors.primary}/></TouchableOpacity>

 </View>;

}
