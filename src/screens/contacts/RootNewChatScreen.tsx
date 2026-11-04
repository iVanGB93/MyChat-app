import {t,languageSnapshot} from '../../localization/language';
import {KeyboardAvoidingScreen} from '../../components/ui/KeyboardForm';
import {Spacing} from '../../theme';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import {contactListStyles as contactStyles} from './contact-list-styles';
import RootIdentityScanner from '../../components/RootIdentityScanner';
import Avatar from '../../components/ui/Avatar';
import {useChatContacts} from '../../modules/ui/useChatSnapshot';
import {displayIdentity,parseIdentityInput} from '../../modules/identity';
import {useEffect,useMemo,useState} from 'react';
import {FlatList,Text,TouchableOpacity,View} from 'react-native';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {conversations} from '../../modules/messaging';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report} from '../rootScreenSupport';
export default function NewChat({navigation,route}:Screen<'NewChat'>){

 const {colors}=useTheme(),[peer,setPeer]=useState(route.params?.identity??''),[busy,setBusy]=useState(false);
 const {contacts,hiddenChats,error}=useChatContacts();
 const saved=useMemo(()=>{const query=peer.trim().toLowerCase();return contacts.filter(c=>hiddenChats?.includes(c.account)&&c.account!==localAccount.status().account&&(!query||c.alias.toLowerCase().includes(query)||c.account.toLowerCase().includes(query)||displayIdentity(c.account).toLowerCase().includes(query))).slice().sort((a,b)=>(a.alias||displayIdentity(a.account)).localeCompare(b.alias||displayIdentity(b.account)));},[contacts,hiddenChats,peer,languageSnapshot()]);

 useEffect(()=>{if(route.params?.identity)setPeer(route.params.identity);},[route.params?.identity]);

 async function open(value=peer){if(busy)return;setBusy(true);try{const account=parseIdentityInput(value);if(!account||account===localAccount.status().account)throw Error(t("Paste another person’s complete identity code or identity link"));await conversations().configure(account,{accepted:true});navigation.replace('ChatRoom',{peer:account});}catch(e){report(e);}finally{setBusy(false);}}

 function deleteContact(contact:typeof contacts[number]){if(busy)return;const owner=localAccount.status().account;Alert.alert(t("Delete contact?"),t("Remove {0} and their saved nickname from this device?{1} Group memberships stay unchanged.",{0:contact.alias||displayIdentity(contact.account),1:contact.blocked?' This also removes their block.':''}),[{text:t("Cancel"),style:'cancel'},{text:t("Delete contact"),style:'destructive',onPress:()=>{if(localAccount.status().account!==owner)return;setBusy(true);void conversations().removeSavedContact(contact.account).catch(report).finally(()=>setBusy(false));}}]);}

 const identity=parseIdentityInput(peer),ownIdentity=identity===localAccount.status().account;
 const canStart=!!identity&&!ownIdentity;

 return <KeyboardAvoidingScreen style={[contactStyles.container,{backgroundColor:colors.background}]}>

  <View style={contactStyles.searchBar}><View style={{flex:1}}><Input accessibilityLabel={t("Search contacts or enter an identity")} placeholder={t("Search contacts or paste an ID…")} autoCapitalize="none" autoCorrect={false} value={peer} onChangeText={setPeer} containerStyle={contactStyles.searchInput}/></View><RootIdentityScanner compact onIdentity={account=>void open(displayIdentity(account))}/></View>

  {!peer.length&&<TouchableOpacity style={[contactStyles.item,{borderBottomWidth:1,borderBottomColor:colors.divider}]} onPress={()=>navigation.navigate('GroupCreate')}><Ionicons name="people-outline" size={26} color={colors.primary}/><Text style={[contactStyles.name,{color:colors.primary,marginLeft:Spacing.md}]}>{t("New group")}</Text></TouchableOpacity>}

  {canStart&&<View style={{padding:Spacing.md}}><Button title={t("START CHAT")} loading={busy} onPress={()=>void open()}/></View>}
  {error&&<Text accessibilityRole="alert" style={{color:colors.error,padding:Spacing.md}}>{t("Unable to load saved contacts.")}</Text>}
  <FlatList style={{flex:1}} data={saved} keyExtractor={c=>c.account} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[contactStyles.list,!saved.length&&contactStyles.emptyContainer]} renderItem={({item:c})=><TouchableOpacity accessibilityRole="button" accessibilityLabel={c.blocked?t("View blocked contact ")+(c.alias||displayIdentity(c.account)):t("Chat with ")+(c.alias||displayIdentity(c.account))} disabled={busy} onLongPress={()=>deleteContact(c)} accessibilityHint={t("Long press to delete this saved contact")} onPress={()=>c.blocked?navigation.navigate('Contact',{peer:c.account}):void open(displayIdentity(c.account))} style={contactStyles.item}><Avatar name={c.alias||displayIdentity(c.account)} uri={null} size={44}/><View style={contactStyles.info}><Text numberOfLines={1} style={[contactStyles.name,{color:colors.text}]}>{c.alias||displayIdentity(c.account)}</Text><Text numberOfLines={1} style={[contactStyles.sub,{color:colors.textSecondary}]}>{c.blocked?'Blocked':displayIdentity(c.account)}</Text></View><Ionicons name={c.blocked?'ban-outline':'chatbubble-outline'} size={20} color={c.blocked?colors.textTertiary:colors.primary}/></TouchableOpacity>} ListEmptyComponent={canStart?null:<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:Spacing.lg,gap:12}}>
   <Ionicons name="chatbubble-ellipses-outline" size={42} color={colors.textTertiary}/>
   <Text style={{color:colors.text,fontSize:18,fontWeight:'600',textAlign:'center'}}>{peer.trim()?t("No matching contacts"):t("Start a new conversation")}</Text>
   <Text style={{color:colors.textSecondary,fontSize:14,lineHeight:22,textAlign:'center',maxWidth:320}}>{t("Ask the person to share their Axonic ID or identity link. Paste it above, or tap the QR button to scan their identity.")}</Text>
   {ownIdentity&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>{t("This is your identity. Paste someone else’s ID.")}</Text>}
  </View>}/>

 </KeyboardAvoidingScreen>;

}
