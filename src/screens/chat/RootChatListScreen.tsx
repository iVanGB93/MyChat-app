import {groupPhotoUri} from '../../components/chat/group-photo';
import {useChatActivity} from '../../modules/ui/useChatActivity';
import {useChatSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import {rootMessageStatus} from '../../modules/messaging';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import ChatAvatarActionModal from '../../components/chat/chat-avatar-action-modal';
import {shortIdentity} from '../../modules/identity';
import {parseSticker} from '../../services/stickers';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import {useCallback,useMemo,useEffect,useState} from 'react';
import {BackHandler,FlatList,Pressable,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import ChatListRow from '../../components/chat/ChatListRow';
import {chatListStyles as listStyles} from '../../components/chat/chat-list-styles';
import EmptyState from '../../components/ui/EmptyState';
import {messaging} from '../../modules/messaging';
import {localAccount} from '../../modules/identity';
import type {RootChatMessage} from '../../modules/messaging';
import {rootGroupMessageIndex} from '../../modules/messaging';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report,formatHistoryTime} from '../rootScreenSupport';
export default function ChatList({navigation}:Screen<'Tabs'>){

 const activity=useChatActivity();

 const {colors}=useTheme(),{state,error}=useOwnChat(),[avatarPeer,setAvatarPeer]=useState<string|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());

 const toggle=useCallback((peer:string)=>setSelected(old=>{const next=new Set(old);next.has(peer)?next.delete(peer):next.add(peer);return next;}),[]);

 useEffect(()=>{if(!selected.size)return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setSelected(new Set());return true;});return()=>listener.remove();},[selected.size]);

 function deleteSelected(){const chats=[...selected],owner=localAccount.status().account;Alert.alert(chats.length===1?'Delete chat?':'Delete chats?','Remove these conversations and their messages from this device only. A new message will make a chat reappear. Saved contact decisions are kept.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void messaging.deleteChats(chats,owner).then(()=>setSelected(new Set())).catch(report)}]);}

 const markRead=useCallback(async(peers:string[])=>{await messaging.markRead(peers);setSelected(new Set());},[]);
 const openChat=useCallback((peer:string)=>peer.startsWith('group:')?navigation.navigate('GroupRoom',{id:peer.slice(6)}):navigation.navigate('ChatRoom',{peer}),[navigation]);
 const markOneRead=useCallback((peer:string)=>void markRead([peer]).catch(report),[markRead]);

 const unreadCounts=useMemo(()=>{const counts=new Map<string,number>();for(const m of state.messages){if(m.direction!=='incoming'||m.read||m.deleted)continue;const key=m.group?'group:'+m.group.id:m.peer;counts.set(key,(counts.get(key)??0)+1);}return counts;},[state.messages]);
 const latest=useMemo(()=>{const result=new Map<string,RootChatMessage>();for(const m of state.messages){if(m.group)continue;const old=result.get(m.peer);if(!old||m.at>=old.at)result.set(m.peer,m);}if(state.groups?.length){const groups=rootGroupMessageIndex(state);for(const g of state.groups){const m=groups.get(g.id)?.at(-1);if(m)result.set('group:'+g.id,m);}}return result;},[state.messages,state.groups]);


 const contacts=useMemo(()=>[...state.contacts,...(state.groups??[]).map(g=>({account:'group:'+g.id,alias:g.name,blocked:g.blocked,accepted:g.accepted}))].filter(c=>!state.hiddenChats?.includes(c.account)).sort((a,b)=>(latest.get(b.account)?.at??0)-(latest.get(a.account)?.at??0)),[state.contacts,state.groups,state.hiddenChats,latest]);

 // Focus changes should not rebuild unchanged rows or remount separators.
 const chatList=useMemo(()=>(<FlatList data={contacts} keyExtractor={c=>c.account} contentContainerStyle={contacts.length?listStyles.list:listStyles.emptyContainer}

   ListEmptyComponent={<EmptyState iconName="chatbubbles-outline" title="No channels open" subtitle="Start a chat with someone's identity code"/>}

   ItemSeparatorComponent={()=><View style={[listStyles.separator,{backgroundColor:colors.divider}]}/>}

   renderItem={({item:c})=>{const m=latest.get(c.account);return <ChatListRow roomId={c.account} displayName={c.alias||shortIdentity(c.account)} avatarUri={c.account.startsWith('group:')?groupPhotoUri(state,c.account.slice(6),localAccount.status().account):state.avatarUris[c.account]} isDirect={!c.account.startsWith('group:')} isOnline={activity.online.includes(c.account)}

    lastMsgContent={c.blocked?'Blocked':!c.accepted?(c.account.startsWith('group:')?'Group invitation':'Message request'):m?.attachment?(m.attachment.name===IMPORTED_STICKER_CONTENT?'Sticker':m.attachment.caption||m.attachment.name):parseSticker(m?.text??'')?'Sticker':m?.text??null} lastMsgTime={m?formatHistoryTime(m.at):null}

    lastMsgFromMe={m?.direction==='outgoing'} lastMsgStatus={m?rootMessageStatus(m):undefined} unread={unreadCounts.get(c.account)??0} typingLabel={activity.typing.includes(c.account)?'Typing…':null} isMuted={c.account.startsWith('group:')?state.groups?.find(g=>g.id===c.account.slice(6))?.muted===true:state.contacts.find(contact=>contact.account===c.account)?.muted===true} selectionMode={selected.size>0} selected={selected.has(c.account)} Colors={colors}

    onOpen={openChat} onAvatarPress={setAvatarPeer} onLongPress={toggle} onToggleSelection={toggle} onMarkRead={markOneRead}/>;}}/>),[contacts,colors,state,latest,unreadCounts,activity.online,activity.typing,selected,openChat,toggle,markOneRead]);

 return <View style={{flex:1,backgroundColor:colors.background}}>

  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:16}}>{error}</Text>}

  {selected.size>0?<View style={[listStyles.selectionBar,{borderBottomColor:colors.divider}]}><Pressable accessibilityLabel="Cancel selection" onPress={()=>setSelected(new Set())}><Ionicons name="close" size={24} color={colors.primary}/></Pressable><Text style={[listStyles.selectionBarText,{color:colors.text}]}>{selected.size} selected</Text><TouchableOpacity accessibilityLabel="Select all chats" style={listStyles.selectionBarAction} onPress={()=>setSelected(new Set(selected.size===contacts.length?[]:contacts.map(c=>c.account)))}><Ionicons name="checkbox-outline" size={22} color={colors.primary}/></TouchableOpacity><TouchableOpacity style={listStyles.selectionBarAction} onPress={()=>void markRead([...selected]).catch(report)}><Ionicons name="checkmark-done" size={22} color={colors.primary}/><Text style={[listStyles.selectionBarText,{color:colors.primary}]}>Mark read</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Delete selected chats" style={listStyles.selectionBarAction} onPress={deleteSelected}><Ionicons name="trash-outline" size={22} color={colors.error}/><Text style={[listStyles.selectionBarText,{color:colors.error}]}>Delete</Text></TouchableOpacity></View>:state.messages.some(m=>m.direction==='incoming'&&!m.read&&!m.deleted)&&<TouchableOpacity style={[listStyles.markAllBar,{borderBottomColor:colors.divider}]} onPress={()=>void markRead(contacts.map(c=>c.account)).catch(report)}><Ionicons name="checkmark-done" size={20} color={colors.primary}/><Text style={[listStyles.markAllText,{color:colors.primary}]}>Mark all as read</Text></TouchableOpacity>}

  {chatList}
  {avatarPeer&&<ChatAvatarActionModal visible avatarUri={avatarPeer.startsWith('group:')?groupPhotoUri(state,avatarPeer.slice(6),localAccount.status().account):state.avatarUris[avatarPeer]} name={contacts.find(c=>c.account===avatarPeer)?.alias||shortIdentity(avatarPeer)} subtitle={avatarPeer.startsWith('group:')?null:shortIdentity(avatarPeer)} isGroup={avatarPeer.startsWith('group:')} onClose={()=>setAvatarPeer(null)} onMessage={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupRoom',{id:avatarPeer.slice(6)}):navigation.navigate('ChatRoom',{peer:avatarPeer});}} onCall={avatarPeer.startsWith('group:')?undefined:()=>{setAvatarPeer(null);navigation.navigate('OutgoingCall',{peer:avatarPeer,kind:'voice'});}} onDetails={()=>{setAvatarPeer(null);avatarPeer.startsWith('group:')?navigation.navigate('GroupInfo',{id:avatarPeer.slice(6)}):navigation.navigate('Contact',{peer:avatarPeer});}}/>}

  <TouchableOpacity accessibilityLabel="New chat" style={[listStyles.fab,{backgroundColor:colors.surface,borderColor:colors.primary,shadowColor:colors.primary}]} onPress={()=>navigation.navigate('NewChat')}><Ionicons name="add" size={32} color={colors.primary}/></TouchableOpacity>

 </View>;

}
