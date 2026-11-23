import {diagnosticJournal} from '../services/diagnosticJournal';
import {t} from '../localization/language';
import NetworkPage from '../screens/profile/NetworkPage';
import {FloatingStackHeader} from './FloatingHeader';
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
import React,{useEffect,useRef,useState} from 'react';
import {AppState,Keyboard,View,ActivityIndicator} from 'react-native';
import {NavigationContainer,DarkTheme,DefaultTheme,createNavigationContainerRef,type InitialState} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useTheme} from '../contexts/ThemeContext';
import {useMainTabOptions} from './main-tab-options';
import {localAccount} from '../modules/identity';
import {RootGroupCreate,RootGroupRoom,RootGroupInfo} from '../screens/chat/RootGroupScreens';
import type {RootAccountRoutes} from './rootAccountRoutes';
import ChatList from '../screens/chat/RootChatListScreen';
import ChatRoom from '../screens/chat/RootPrivateChatScreen';
import Contact from '../screens/contacts/RootContactScreen';
import NewChat from '../screens/contacts/RootNewChatScreen';
import Game from '../screens/game/RootGameScreen';
import BlockedUsers from '../screens/contacts/RootBlockedUsersScreen';
import MessageInfo from '../screens/chat/RootMessageInfoScreen';
import OutgoingCall from '../screens/calls/RootOutgoingCallScreen';

type Routes=RootAccountRoutes;

const Stack=createNativeStackNavigator<Routes>(),Tabs=createBottomTabNavigator();

export default function RootAccountNavigator({profile,network}:{profile:React.ReactNode;network:React.ReactNode}){

 const {colors,isDark}=useTheme(),options=useMainTabOptions(),base=isDark?DarkTheme:DefaultTheme;

 const ref=useRef(createNavigationContainerRef<Routes>()).current;

 const [launchState,setLaunchState]=useState<InitialState|null>(null);
 const openPending=useRef<()=>void>(()=>{});
 const visibleRoom=useRef<string|null>(null);
 const visible=()=>{const route=ref.getCurrentRoute(),room=route&&['ChatRoom','GroupRoom'].includes(route.name)?route.key:null;if(visibleRoom.current&&visibleRoom.current!==room)Keyboard.dismiss();visibleRoom.current=room;setRootVisibleConversation(route?.name==='ChatRoom'?{peer:(route.params as Routes['ChatRoom']).peer}:route?.name==='GroupRoom'?{group:(route.params as Routes['GroupRoom']).id}:null);};

 useEffect(()=>{

  let alive=true,opening=false,dirty=false,failures=0,retry:ReturnType<typeof setTimeout>|undefined;

  let initialTarget:Awaited<ReturnType<typeof pendingRootNotificationOpen>>=null;
  const open=async()=>{if(opening){dirty=true;return;}if(AppState.currentState!=='active'||opening||!alive||!ref.isReady()||localAccount.status().state!=='unlocked')return;clearTimeout(retry);opening=true;dirty=false;let failed=false;

   try{
    if(initialTarget){const opened=initialTarget;await finishRootNotificationOpen(opened);initialTarget=null;}
    const link=takeIdentityLink();if(link&&link!==localAccount.status().account){ref.navigate('NewChat',{identity:displayIdentity(link)});return;}const account=localAccount.status().account!,routing=performance.now(),target=await pendingRootNotificationOpen(account);if(!target||!alive||AppState.currentState!=='active'||localAccount.status().account!==account||localAccount.status().state!=='unlocked')return;

    diagnosticJournal.record('notification_route_resolved',{milliseconds:performance.now()-routing});
    if(target.inbox)ref.navigate('Tabs',{screen:'Chats'});else if(target.group)ref.navigate('GroupRoom',{id:target.group});else ref.navigate('ChatRoom',{peer:target.sender});

    await finishRootNotificationOpen(target);
    if(target.inbox&&target.unavailable)Alert.alert(t("Notification update"),target.unavailable==='not_received'
     ?t("Only a delivery hint is available for this alert; there is no matching chat message to open. Axonic will check for pending deliveries when connected.")
     :target.unavailable==='removed'?t("The message for this older notification has been removed. Your remaining chats are unchanged.")
     :t("The group for this notification is not available on this device yet. Axonic is checking the network."));

   }catch{failed=true;failures++;}finally{opening=false;if(!failed)failures=0;if(dirty&&alive)void open();else if(failed&&alive&&AppState.currentState==='active')retry=setTimeout(()=>void open(),Math.min(30000,1000*2**Math.min(failures,5)));}};

  const stop=notifee.onForegroundEvent(({type,detail})=>{if(type===EventType.PRESS)void handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data).then(()=>queueRootNotificationOpen(detail.notification?.data)).then(open).catch(report);else if(type===EventType.ACTION_PRESS)void handleRootNotificationAction(detail.pressAction?.id??'',detail.notification?.data,detail.input).catch(report);});

  // Resolve the cold-launch destination before mounting Tabs. The conversation
  // screen loads its own pages; notification opening does not await that work.
  const launchAccount=localAccount.status().account;
  void (async()=>{
   const began=performance.now(),initial=await notifee.getInitialNotification();
   if(alive)diagnosticJournal.record('notification_intent_read',{milliseconds:performance.now()-began});
   const routing=performance.now();
   if(initial){await handleRootNotificationAction(initial.pressAction?.id??'',initial.notification.data);await queueRootNotificationOpen(initial.notification.data);}
   const target=launchAccount?await pendingRootNotificationOpen(launchAccount):null;
   if(!alive)return;
   diagnosticJournal.record('notification_route_resolved',{milliseconds:performance.now()-routing});
   const valid=localAccount.status().state==='unlocked'&&localAccount.status().account===launchAccount;
   const destination=valid&&target&&!target.inbox?(target.group?{name:'GroupRoom',params:{id:target.group}}:{name:'ChatRoom',params:{peer:target.sender}}):null;
   if(destination)initialTarget=target;
   setLaunchState({index:destination?1:0,routes:[{name:'Tabs'},...(destination?[destination]:[])]});
  })().catch(()=>{if(alive)setLaunchState({index:0,routes:[{name:'Tabs'}]});});

  openPending.current=()=>{void open();};const offQueue=subscribeRootNotificationOpen(()=>void open()),offLinks=subscribeIdentityLinks(()=>void open()),offAccount=localAccount.subscribe(()=>void open());const appState=AppState.addEventListener('change',()=>void open());void open();return()=>{alive=false;clearTimeout(retry);openPending.current=()=>{};offQueue();offLinks();offAccount();appState.remove();stop();setRootVisibleConversation(null);};

 },[ref]);

 if(!launchState)return <View style={{flex:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center'}}><ActivityIndicator color={colors.primary} accessibilityLabel={t("Opening Axonic")}/></View>;
 return <><AppUpdateBanner/><NavigationContainer initialState={launchState} ref={ref} onReady={()=>{visible();openPending.current();}} onStateChange={visible} theme={{...base,colors:{...base.colors,background:colors.background,card:colors.headerBg,text:colors.text,primary:colors.primary,border:colors.neonBorder}}}>

  <Stack.Navigator screenOptions={{header:props=><FloatingStackHeader {...props}/>,headerStyle:{backgroundColor:colors.headerBg},headerTintColor:colors.headerText,headerTitleStyle:{...Font.semiBold,color:colors.headerText},contentStyle:{backgroundColor:colors.background}}}>

   <Stack.Screen name="Tabs" options={{headerShown:false}}>{props=><Tabs.Navigator safeAreaInsets={{bottom:0}} detachInactiveScreens screenOptions={options}><Tabs.Screen name="Chats" options={{headerTitle:t("AXONIC"),tabBarLabel:t("Social")}}>{()=> <ChatList {...props}/>}</Tabs.Screen><Tabs.Screen name="Game" options={{headerTitle:t("GAMES"),tabBarLabel:t("Games")}} component={Game}/><Tabs.Screen name="Profile" options={{headerTitle:t("PROFILE"),tabBarLabel:t("Profile")}}>{()=> <>{profile}</>}</Tabs.Screen></Tabs.Navigator>}</Stack.Screen>

   <Stack.Screen name="ChatRoom" component={ChatRoom} options={{headerTransparent:true}}/><Stack.Screen name="NewChat" component={NewChat} options={{title:t("New chat"),headerTransparent:true}}/><Stack.Screen name="Contact" component={Contact} options={{title:t("User details")}}/>

   <Stack.Screen name="GroupCreate" component={RootGroupCreate} options={{title:t("New group")}}/><Stack.Screen name="GroupRoom" component={RootGroupRoom} options={{headerTransparent:true}}/><Stack.Screen name="GroupMessageInfo" component={RootGroupMessageInfo} options={{title:t("Message info")}}/><Stack.Screen name="GroupInfo" component={RootGroupInfo} options={{title:t("Group information")}}/>

   <Stack.Screen name="ChatStorage" component={RootChatStorageScreen} options={{title:t("Chat storage")}}/>

   <Stack.Screen name="BlockedUsers" component={BlockedUsers} options={{title:t("Blocked users")}}/>

   <Stack.Screen name="MessageInfo" component={MessageInfo} options={{title:t("Message info")}}/>

   <Stack.Screen name="OutgoingCall" component={OutgoingCall} options={{headerShown:false,presentation:'transparentModal',animation:'slide_from_bottom',contentStyle:{backgroundColor:'transparent'},gestureEnabled:false}}/>

   <Stack.Screen name="Network" options={{title:t("Network"),headerTransparent:true}}>{()=> <NetworkPage>{network}</NetworkPage>}</Stack.Screen>

  </Stack.Navigator>

 </NavigationContainer><RootSharePicker onSent={target=>{if(ref.isReady())target.startsWith('group:')?ref.navigate('GroupRoom',{id:target.slice(6)}):ref.navigate('ChatRoom',{peer:target});}}/><RootMessageToast/></>;

}
