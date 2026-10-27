import {useForegroundEvents} from '../../hooks/useForegroundEvents';
import {subscribeCallJournalWrites} from '../../modules/storage';
import {useChatSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import dayjs from 'dayjs';
import {callHistoryStyles as callStyles} from './call-history-styles';
import {useMemo,useState} from 'react';
import {FlatList,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import {localAccount} from '../../modules/identity';
import {listOwnCallHistory,type OwnCallSummary} from '../../modules/storage';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {nickname,formatHistoryTime} from '../rootScreenSupport';
export default function Calls({navigation}:Screen<'Tabs'>){

 const {colors}=useTheme(),{state}=useOwnChat(),[rows,setRows]=useState<OwnCallSummary[]>([]),[error,setError]=useState('');

 const focused=useIsFocused();
 useForegroundEvents(async current=>{const owner=localAccount.status().account;if(!owner)return;try{const result=await listOwnCallHistory(owner);if(current()&&localAccount.status().account===owner){setRows(previous=>JSON.stringify(previous)===JSON.stringify(result)?previous:result);setError('');}}catch(error){if(current())setError('Unable to read call history');throw error;}},subscribeCallJournalWrites,focused);

 // Keep focus-only updates from recreating the unchanged native list.
 const calendarDay=dayjs().format('YYYY-MM-DD');
 const callList=useMemo(()=>(<FlatList data={rows} keyExtractor={r=>r.id} contentContainerStyle={rows.length?callStyles.list:callStyles.emptyContainer} ListEmptyComponent={<EmptyState iconName="call-outline" title="No call history" subtitle="Start a call from a chat conversation"/>} ItemSeparatorComponent={()=><View style={[callStyles.separator,{backgroundColor:colors.divider}]}/>} renderItem={({item:r})=><TouchableOpacity accessibilityLabel={`Call ${nickname(state,r.peer)}`} onPress={()=>navigation.navigate('OutgoingCall',{peer:r.peer,kind:r.media})} activeOpacity={0.7} style={[callStyles.callItem,{borderColor:colors.neonBorder}]}><View style={[callStyles.accentBar,{backgroundColor:colors.primary}]}/><Avatar name={nickname(state,r.peer)} uri={state.avatarUris[r.peer]} size={46}/><View style={callStyles.callInfo}><Text numberOfLines={1} style={[callStyles.callName,{color:colors.text}]}>{nickname(state,r.peer).toUpperCase()}</Text><View style={callStyles.callMeta}><Text style={[callStyles.directionTag,{color:colors.primary,borderColor:colors.primary}]}>{r.outgoing?'OUT':'IN'}</Text><Text style={[callStyles.callType,{color:colors.textSecondary}]}>{r.media==='video'?'VIDEO':'AUDIO'}</Text></View></View><View style={callStyles.callRight}><Text style={[callStyles.callTime,{color:colors.primary}]}>{formatHistoryTime(r.at)}</Text><View style={[callStyles.callbackBtn,{borderColor:colors.primary}]}><Ionicons name={r.media==='video'?'videocam-outline':'call-outline'} size={16} color={colors.primary}/></View></View></TouchableOpacity>}/>),[rows,state,colors,navigation,calendarDay]);
 return <View style={[callStyles.container,{backgroundColor:colors.background}]}>{!!error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error}</Text>}{callList}</View>;

}
