import AppUpdateBanner from '../components/ui/AppUpdateBanner';
import {report} from '../screens/rootScreenSupport';
import RootGroupMessageInfo from '../screens/chat/RootGroupMessageInfo';
import RootSharePicker from '../components/chat/RootSharePicker';
import RootMessageToast from '../components/chat/RootMessageToast';
import RootChatStorageScreen from '../screens/profile/RootChatStorageScreen';
import {ThemedAlert as Alert} from '../components/ui/ThemedAlert';
import {Font} from '../theme';
import notifee,{EventType} from '@notifee/react-native';
import {handleRootNotificationAction} from '../modules/messaging/notifications';
import {subscribeRootNotificationOpen,setRootVisibleConversation,queueRootNotificationOpen,pendingRootNotificationOpen,finishRootNotificationOpen} from '../modules/messaging/notifications';
import {displayIdentity,takeIdentityLink,subscribeIdentityLinks} from '../modules/identity';
import React,{useEffect,useRef} from 'react';
import {AppState,Keyboard,ScrollView} from 'react-native';
import {NavigationContainer,DarkTheme,DefaultTheme,createNavigationContainerRef} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useTheme} from '../contexts/ThemeContext';
import {useMainTabOptions} from './main-tab-options';
import {localAccount} from '../modules/identity';
import {conversations} from '../modules/messaging';
import {RootGroupCreate,RootGroupRoom,RootGroupInfo} from '../screens/chat/RootGroupScreens';
import type {RootAccountRoutes} from './rootAccountRoutes';
import ChatList from '../screens/chat/RootChatListScreen';
import ChatRoom from '../screens/chat/RootPrivateChatScreen';
import Contact from '../screens/contacts/RootContactScreen';
import NewChat from '../screens/contacts/RootNewChatScreen';
import Calls from '../screens/calls/RootCallHistoryScreen';
import BlockedUsers from '../screens/contacts/RootBlockedUsersScreen';
import MessageInfo from '../screens/chat/RootMessageInfoScreen';
import OutgoingCall from '../screens/calls/RootOutgoingCallScreen';

type Routes=RootAccountRoutes;

const Stack=createNativeStackNavigator<Routes>(),Tabs=createBottomTabNavigator();

export default function RootAccountNavigator({profile,network}:{profile:React.ReactNode;network:React.ReactNode}){

 const {colors,isDark}=useTheme(),options=useMainTabOptions(),base=isDark?DarkTheme:DefaultTheme;

 const ref=useRef(createNavigationContainerRef<Routes>()).current;

 const openPending=useRef<()=>void>(()=>{});
 const visibleRoom=useRef<string|null>(null);
 const visible=()=>{const route=ref.getCurrentRoute(),room=route&&['ChatRoom','GroupRoom'].includes(route.name)?route.key:null;if(visibleRoom.current&&visibleRoom.current!==room)Keyboard.dismiss();visibleRoom.current=room;setRootVisibleConversation(route?.name==='ChatRoom'?{peer:(route.params as Routes['ChatRoom']).peer}:route?.name==='GroupRoom'?{group:(route.params as Routes['GroupRoom']).id}:null);};

 useEffect(()=>{

  let alive=true,opening=false,dirty=false,failures=0,retry:ReturnType<typeof setTimeout>|undefined;

  const open=async()=>{if(opening){dirty=true;return;}if(AppState.currentState!=='active'||opening||!alive||!ref.isReady()||localAccount.status().state!=='unlocked')return;clearTimeout(retry);opening=true;dirty=false;let failed=false;

   try{const link=takeIdentityLink();if(link&&link!==localAccount.status().account){ref.navigate('NewChat',{identity:displayIdentity(link)});return;}const account=localAccount.status().account!,target=await pendingRootNotificationOpen(account);if(!target||!alive||AppState.currentState!=='active'||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;

    const state=await conversations().snapshot();if(!alive||AppState.currentState!=='active'||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;

    if(target.inbox)ref.navigate('Tabs',{screen:'Chats'});else if(target.group&&state.groups?.some(g=>g.id===target.group))ref.navigate('GroupRoom',{id:target.group});else ref.navigate('ChatRoom',{peer:target.sender});

    await finishRootNotificationOpen(target);
    if(target.inbox&&target.unavailable)Alert.alert('Notification update',target.unavailable==='not_received'
     ?'Only a delivery hint is available for this alert; there is no matching chat message to open. Axonic will check for pending deliveries when connected.'
     :target.unavailable==='removed'?'The message for this older notification has been removed. Your remaining chats are unchanged.'
     :'The group for this notification is not available on this device yet. Axonic is checking the network.');

   }catch{failed=true;failures++;}finally{opening=false;if(!failed)failures=0;if(dirty&&alive)void open();else if(failed&&alive&&AppState.currentState==='active')retry=setTimeout(()=>void open(),Math.min(30000,1000*2**Math.min(failures,5)));}};

  const stop=notifee.onForegroundEvent(({type,detail})=>{if(type===EventType.PRESS)void queueRootNotificationOpen(detail.notification?.data).then(open).catch(()=>{});else if(type===EventType.ACTION_PRESS)void handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data,detail.input).catch(report);});

  void notifee.getInitialNotification().then(async initial=>{if(!initial)return;await handleRootNotificationAction(initial.pressAction?.id??'',initial.notification.data);await queueRootNotificationOpen(initial.notification.data);}).then(open).catch(()=>{});

  openPending.current=()=>{void open();};const offQueue=subscribeRootNotificationOpen(()=>void open()),offLinks=subscribeIdentityLinks(()=>void open()),offAccount=localAccount.subscribe(()=>void open());const appState=AppState.addEventListener('change',()=>void open());void open();return()=>{alive=false;clearTimeout(retry);openPending.current=()=>{};offQueue();offLinks();offAccount();appState.remove();stop();setRootVisibleConversation(null);};

 },[ref]);

 return <><AppUpdateBanner/><NavigationContainer ref={ref} onReady={()=>{visible();openPending.current();}} onStateChange={visible} theme={{...base,colors:{...base.colors,background:colors.background,card:colors.headerBg,text:colors.text,primary:colors.primary,border:colors.neonBorder}}}>

  <Stack.Navigator screenOptions={{headerStyle:{backgroundColor:colors.headerBg},headerTintColor:colors.headerText,headerTitleStyle:{...Font.semiBold,color:colors.headerText},contentStyle:{backgroundColor:colors.background}}}>

   <Stack.Screen name="Tabs" options={{headerShown:false}}>{props=><Tabs.Navigator detachInactiveScreens screenOptions={options}><Tabs.Screen name="Chats" options={{headerTitle:'AXONIC'}}>{()=> <ChatList {...props}/>}</Tabs.Screen><Tabs.Screen name="Calls" options={{headerTitle:'CALLS'}}>{()=> <Calls {...props}/>}</Tabs.Screen><Tabs.Screen name="Profile" options={{headerTitle:'PROFILE'}}>{()=> <>{profile}</>}</Tabs.Screen></Tabs.Navigator>}</Stack.Screen>

   <Stack.Screen name="ChatRoom" component={ChatRoom}/><Stack.Screen name="NewChat" component={NewChat} options={{title:'New chat'}}/><Stack.Screen name="Contact" component={Contact} options={{title:'User details'}}/>

   <Stack.Screen name="GroupCreate" component={RootGroupCreate} options={{title:'New group'}}/><Stack.Screen name="GroupRoom" component={RootGroupRoom}/><Stack.Screen name="GroupMessageInfo" component={RootGroupMessageInfo} options={{title:'Message info'}}/><Stack.Screen name="GroupInfo" component={RootGroupInfo} options={{title:'Group information'}}/>

   <Stack.Screen name="ChatStorage" component={RootChatStorageScreen} options={{title:'Chat storage'}}/>

   <Stack.Screen name="BlockedUsers" component={BlockedUsers} options={{title:'Blocked users'}}/>

   <Stack.Screen name="MessageInfo" component={MessageInfo} options={{title:'Message info'}}/>

   <Stack.Screen name="OutgoingCall" component={OutgoingCall} options={{headerShown:false,presentation:'transparentModal',animation:'slide_from_bottom',contentStyle:{backgroundColor:'transparent'},gestureEnabled:false}}/>

   <Stack.Screen name="Network" options={{title:'Network'}}>{()=> <ScrollView contentContainerStyle={{padding:24,gap:16}}>{network}</ScrollView>}</Stack.Screen>

  </Stack.Navigator>

 </NavigationContainer><RootSharePicker onSent={target=>{if(ref.isReady())target.startsWith('group:')?ref.navigate('GroupRoom',{id:target.slice(6)}):ref.navigate('ChatRoom',{peer:target});}}/><RootMessageToast/></>;

}
