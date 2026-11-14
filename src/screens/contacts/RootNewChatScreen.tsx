import {useHeaderHeight} from '@react-navigation/elements';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {chatListStyles as listStyles,selectionBarHeight} from '../../components/chat/chat-list-styles';
import {t,languageSnapshot} from '../../localization/language';
import {KeyboardAvoidingScreen} from '../../components/ui/KeyboardForm';
import {Chrome,Spacing} from '../../theme';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import {contactListStyles as contactStyles} from './contact-list-styles';
import RootIdentityScanner from '../../components/RootIdentityScanner';
import Avatar from '../../components/ui/Avatar';
import {useChatContacts} from '../../modules/ui/useChatSnapshot';
import {displayIdentity,parseIdentityInput} from '../../modules/identity';
import {useEffect,useMemo,useState} from 'react';
import {BackHandler,FlatList,Text,TouchableOpacity,View} from 'react-native';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {conversations} from '../../modules/messaging';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report} from '../rootScreenSupport';
export default function NewChat({navigation,route}:Screen<'NewChat'>){

 const {colors}=useTheme(),[peer,setPeer]=useState(route.params?.identity??''),[busy,setBusy]=useState(false);
 const headerHeight=useHeaderHeight(),insets=useSafeAreaInsets();
 const [controlsHeight,setControlsHeight]=useState(0);
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const {contacts,hiddenChats,error}=useChatContacts();
 const saved=useMemo(()=>{const query=peer.trim().toLowerCase();return contacts.filter(c=>hiddenChats?.includes(c.account)&&c.account!==localAccount.status().account&&(!query||c.alias.toLowerCase().includes(query)||c.account.toLowerCase().includes(query)||displayIdentity(c.account).toLowerCase().includes(query))).slice().sort((a,b)=>(a.alias||displayIdentity(a.account)).localeCompare(b.alias||displayIdentity(b.account)));},[contacts,hiddenChats,peer,languageSnapshot()]);

 useEffect(()=>{if(route.params?.identity)setPeer(route.params.identity);},[route.params?.identity]);

 async function open(value=peer){if(busy)return;setBusy(true);try{const account=parseIdentityInput(value);if(!account||account===localAccount.status().account)throw Error(t("Paste another person’s complete identity code or identity link"));await conversations().configure(account,{accepted:true});navigation.replace('ChatRoom',{peer:account});}catch(e){report(e);}finally{setBusy(false);}}

 const selectedContacts=saved.filter(contact=>selected.has(contact.account));
 const selectionMode=selectedContacts.length>0;
 useEffect(()=>{
  if(!selectionMode)return;
  const listener=BackHandler.addEventListener('hardwareBackPress',()=>{
   if(!busy)setSelected(new Set());
   return true;
  });
  return ()=>listener.remove();
 },[selectionMode,busy]);

 function toggle(peerId:string){
  setSelected(current=>{
   const next=new Set(current);
   if(next.has(peerId))next.delete(peerId);else next.add(peerId);
   return next;
  });
 }

 function deleteSelected(){
  if(busy)return;
  const targets=selectedContacts;
  if(!targets.length)return;
  const owner=localAccount.status().account;
  const warning=targets.some(contact=>contact.blocked)?t(" This also removes their block."):'';
  Alert.alert(t("Delete selected contacts?"),t("Remove {0} selected contacts and their saved nicknames from this device? Group memberships stay unchanged.",{0:targets.length})+warning,[
   {text:t("Cancel"),style:'cancel'},
   {text:t("Delete"),style:'destructive',onPress:()=>void removeSelected()},
  ]);
  async function removeSelected(){
   if(localAccount.status().account!==owner)return;
   setBusy(true);
   const removed=new Set<string>();
   try{
    const ledger=conversations();
    for(const {account} of targets){
     if(localAccount.status().account!==owner)break;
     try{await ledger.removeSavedContact(account);removed.add(account);}catch(error){report(error);}
    }
   }finally{
    setSelected(current=>new Set([...current].filter(account=>!removed.has(account))));
    setBusy(false);
   }
  }
 }

 const identity=parseIdentityInput(peer),ownIdentity=identity===localAccount.status().account;
 const canStart=!!identity&&!ownIdentity;

 return <KeyboardAvoidingScreen style={[contactStyles.container,{backgroundColor:colors.background}]}>

  <FlatList style={{flex:1}} data={saved} keyExtractor={c=>c.account} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
   contentContainerStyle={[contactStyles.list,!saved.length&&contactStyles.emptyContainer,{paddingTop:headerHeight+(selectionMode?selectionBarHeight+8:controlsHeight)}]}
   ListHeaderComponent={<>
    {error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:Spacing.md}}>{t("Unable to load saved contacts.")}</Text>}
   </>}
   ItemSeparatorComponent={()=> <View style={[contactStyles.separator,{backgroundColor:colors.divider}]}/>}
   renderItem={({item:c})=>{
    const checked=selected.has(c.account),name=c.alias||displayIdentity(c.account);
    return <TouchableOpacity accessibilityRole={selectionMode?'checkbox':'button'} accessibilityLabel={selectionMode?name:c.blocked?t("View blocked contact ")+name:t("Chat with ")+name}
     accessibilityState={selectionMode?{checked,disabled:busy}:{disabled:busy}} disabled={busy} onLongPress={()=>toggle(c.account)}
     accessibilityHint={selectionMode?undefined:t("Long press to select this contact")}
     onPress={()=>selectionMode?toggle(c.account):c.blocked?navigation.navigate('Contact',{peer:c.account}):void open(displayIdentity(c.account))}
     style={[contactStyles.item,checked&&{backgroundColor:colors.highlight}]}>
     <Avatar name={name} uri={null} size={44}/>
     <View style={contactStyles.info}><Text numberOfLines={1} style={[contactStyles.name,{color:colors.text}]}>{name}</Text><Text numberOfLines={1} style={[contactStyles.sub,{color:colors.textSecondary}]}>{c.blocked?t("Blocked"):displayIdentity(c.account)}</Text></View>
     <Ionicons name={selectionMode?(checked?'checkbox-outline':'square-outline'):c.blocked?'ban-outline':'chatbubble-outline'} size={20} color={!selectionMode&&c.blocked?colors.textTertiary:colors.primary}/>
    </TouchableOpacity>;
   }}
   ListEmptyComponent={canStart?null:<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:Spacing.lg,gap:12}}>
   <Ionicons name="chatbubble-ellipses-outline" size={42} color={colors.textTertiary}/>
   <Text style={{color:colors.text,fontSize:18,fontWeight:'600',textAlign:'center'}}>{peer.trim()?t("No matching contacts"):t("Start a new conversation")}</Text>
   <Text style={{color:colors.textSecondary,fontSize:14,lineHeight:22,textAlign:'center',maxWidth:320}}>{t("Ask the person to share their Axonic ID or identity link. Paste it above, or tap the QR button to scan their identity.")}</Text>
   {ownIdentity&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{t("This is your identity. Paste someone else’s ID.")}</Text>}
  </View>}/>

    {!selectionMode&&<View pointerEvents="box-none" onLayout={event=>setControlsHeight(event.nativeEvent.layout.height)} style={[contactStyles.fixedControls,{top:headerHeight,left:insets.left+Chrome.gutter,right:insets.right+Chrome.gutter}]}>
     <View style={contactStyles.searchBar}><View style={{flex:1}}><Input accessibilityLabel={t("Search contacts or enter an identity")} placeholder={t("Search contacts or paste an ID…")} autoCapitalize="none" autoCorrect={false} value={peer} onChangeText={value=>{setSelected(new Set());setPeer(value);}} containerStyle={contactStyles.searchInput} surfaceStyle={{backgroundColor:colors.headerBg,borderRadius:Chrome.panelRadius}}/></View><RootIdentityScanner compact onIdentity={account=>void open(displayIdentity(account))}/></View>
     {!peer.length&&<TouchableOpacity accessibilityRole="button" style={[contactStyles.item,{borderRadius:Chrome.panelRadius,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.headerBg}]} onPress={()=>navigation.navigate('GroupCreate')}><Ionicons name="people-outline" size={26} color={colors.primary}/><Text style={[contactStyles.name,{color:colors.primary,marginLeft:Spacing.md}]}>{t("New group")}</Text></TouchableOpacity>}
     {canStart&&<View style={{padding:Spacing.md}}><Button title={t("START CHAT")} loading={busy} onPress={()=>void open()}/></View>}
    </View>}

  {selectionMode&&<View style={[listStyles.selectionBar,{top:headerHeight,left:insets.left+Chrome.gutter,right:insets.right+Chrome.gutter,borderColor:colors.neonBorder,backgroundColor:colors.headerBg,shadowColor:colors.primary}]}>
   <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Cancel selection")} disabled={busy} style={listStyles.selectionBarAction} onPress={()=>setSelected(new Set())}><Ionicons name="close" size={24} color={colors.primary}/></TouchableOpacity>
   <Text style={[listStyles.selectionBarText,{color:colors.text}]}>{selectedContacts.length} {t("selected")}</Text>
   <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Select all contacts")} disabled={busy} style={listStyles.selectionBarAction} onPress={()=>setSelected(new Set(saved.every(contact=>selected.has(contact.account))?[]:saved.map(contact=>contact.account)))}><Ionicons name="checkbox-outline" size={22} color={colors.primary}/></TouchableOpacity>
   <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Delete selected contacts?")} disabled={busy} style={listStyles.selectionBarAction} onPress={deleteSelected}><Ionicons name="trash-outline" size={22} color={colors.error}/><Text style={[listStyles.selectionBarText,{color:colors.error}]}>{t("Delete")}</Text></TouchableOpacity>
  </View>}
 </KeyboardAvoidingScreen>;

}
