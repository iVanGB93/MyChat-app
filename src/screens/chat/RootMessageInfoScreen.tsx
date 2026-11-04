import {t,languageSnapshot} from '../../localization/language';
import MediaTransferInfo from '../../components/chat/MediaTransferInfo';
import MessageReactionInfo from '../../components/chat/MessageReactionInfo';
import {localAccount} from '../../modules/identity';
import {Chrome} from '../../theme';
import {MessageStatusTimes} from '../../components/chat/MessageStatusTimes';
import {useMessageStateClock} from '../../modules/ui/useMessageStateClock';
import {messageInfoDescription} from '../../modules/messaging';
import {useMessageDetails} from '../../modules/ui/useChatSnapshot';
import {rootMessageStatus,deliveryStatusLabel} from '../../modules/messaging';
import {useMemo} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {nickname} from '../rootScreenSupport';
export default function MessageInfo({route}:Screen<'MessageInfo'>){
 const {colors}=useTheme(),{state,error,loading}=useMessageDetails(route.params.id),message=state.messages.find(m=>m.peer===route.params.peer&&m.id===route.params.id&&m.direction===route.params.direction),insets=useSafeAreaInsets();
 const owner=localAccount.status().account;
 const tracked=useMemo(()=>message?[message]:[],[message,languageSnapshot()]),now=useMessageStateClock(tracked);
 return <ScrollView style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{padding:18,paddingBottom:insets.bottom+24,gap:20}}>{message?<><MessageReactionInfo message={message} name={author=>author===owner?t("You"):nickname(state,author)}/><View style={{padding:16,borderRadius:Chrome.cardRadius,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface,gap:14}}><Text selectable style={{color:colors.text,fontSize:17}}>{message.deleted?t("Message deleted"):message.attachment?.name||message.text}</Text>{[
  ['From',message.direction==='outgoing'?'You':nickname(state,message.peer)],
  ['Created',new Date(message.at).toLocaleString()],
  ['Type',message.attachment?.mime||'Text'],
 ].map(([label,value])=><View key={label} style={{flexDirection:'row',alignItems:'flex-start',gap:12}}><Text style={{color:colors.textSecondary,flex:1}}>{label}</Text><Text selectable style={{color:colors.text,flex:2}}>{value}</Text></View>)}</View><Text style={{color:colors.primary,fontSize:18,fontWeight:'700'}}>{t(deliveryStatusLabel(rootMessageStatus(message,now)))}</Text><Text style={{color:colors.textSecondary}}>{t(messageInfoDescription(message,now))}</Text><MediaTransferInfo message={message} now={now}/><MessageStatusTimes message={message} now={now} owner={owner} name={peer=>nickname(state,peer)}/></>:<Text style={{color:colors.textSecondary}}>{loading?t("Loading message information…"):error||t("This message is no longer stored on this phone.")}</Text>}</ScrollView>;
}

