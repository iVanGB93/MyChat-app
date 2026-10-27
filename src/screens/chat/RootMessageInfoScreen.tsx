import {MessageStatusTimes} from '../../components/chat/MessageStatusTimes';
import {useMessageStateClock} from '../../modules/ui/useMessageStateClock';
import {messageInfoDescription} from '../../modules/messaging';
import {useChatSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import {rootMessageStatus,deliveryStatusLabel} from '../../modules/messaging';
import {useMemo} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {nickname} from '../rootScreenSupport';
export default function MessageInfo({route}:Screen<'MessageInfo'>){
 const {colors}=useTheme(),{state}=useOwnChat(),message=state.messages.find(m=>m.peer===route.params.peer&&m.id===route.params.id&&m.direction===route.params.direction),insets=useSafeAreaInsets();
 const tracked=useMemo(()=>message?[message]:[],[message]),now=useMessageStateClock(tracked);
 return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:18,paddingBottom:insets.bottom+24,gap:20}}>{message?<><View style={{padding:16,borderRadius:16,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface,gap:14}}><Text selectable style={{color:colors.text,fontSize:17}}>{message.deleted?'This message was deleted.':message.attachment?.name||message.text}</Text><Text style={{color:colors.textSecondary}}>From</Text><Text style={{color:colors.text}}>{message.direction==='outgoing'?'You':nickname(state,message.peer)}</Text><Text style={{color:colors.textSecondary}}>Created</Text><Text style={{color:colors.text}}>{new Date(message.at).toLocaleString()}</Text><Text style={{color:colors.textSecondary}}>Type</Text><Text style={{color:colors.text}}>{message.attachment?.mime||'Text'}</Text></View><Text style={{color:colors.primary,fontSize:18,fontWeight:'700'}}>{deliveryStatusLabel(rootMessageStatus(message,now))}</Text><Text style={{color:colors.textSecondary}}>{messageInfoDescription(message,now)}</Text><MessageStatusTimes message={message} now={now}/></>:<Text style={{color:colors.textSecondary}}>This message is no longer stored on this phone.</Text>}</ScrollView>;
}
