import {KeyboardAvoidingScreen} from '../../components/ui/KeyboardForm';
import {Spacing} from '../../theme';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import {contactListStyles as contactStyles} from './contact-list-styles';
import RootIdentityScanner from '../../components/RootIdentityScanner';
import {displayIdentity,parseIdentityInput} from '../../modules/identity';
import {useEffect,useState} from 'react';
import {Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {conversations} from '../../modules/messaging';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report} from '../rootScreenSupport';
export default function NewChat({navigation,route}:Screen<'NewChat'>){

 const {colors}=useTheme(),[peer,setPeer]=useState(route.params?.identity??''),[busy,setBusy]=useState(false);

 useEffect(()=>{if(route.params?.identity)setPeer(route.params.identity);},[route.params?.identity]);

 async function open(value=peer){if(busy)return;setBusy(true);try{const account=parseIdentityInput(value);if(!account||account===localAccount.status().account)throw Error('Paste another person’s complete identity code or identity link');await conversations().configure(account,{accepted:true});navigation.replace('ChatRoom',{peer:account});}catch(e){report(e);}finally{setBusy(false);}}

 const identity=parseIdentityInput(peer),ownIdentity=identity===localAccount.status().account;
 const canStart=!!identity&&!ownIdentity;

 return <KeyboardAvoidingScreen style={[contactStyles.container,{backgroundColor:colors.background}]}>

  <View style={contactStyles.searchBar}><View style={{flex:1}}><Input accessibilityLabel="Identity code or link" placeholder="Paste an ID or identity link…" autoCapitalize="none" autoCorrect={false} value={peer} onChangeText={setPeer} containerStyle={contactStyles.searchInput}/></View><RootIdentityScanner compact onIdentity={account=>void open(displayIdentity(account))}/></View>

  {!peer.length&&<TouchableOpacity style={[contactStyles.item,{borderBottomWidth:1,borderBottomColor:colors.divider}]} onPress={()=>navigation.navigate('GroupCreate')}><Ionicons name="people-outline" size={26} color={colors.primary}/><Text style={[contactStyles.name,{color:colors.primary,marginLeft:Spacing.md}]}>New group</Text></TouchableOpacity>}

  {canStart?<View style={{padding:Spacing.md}}><Button title="START CHAT" loading={busy} onPress={()=>void open()}/></View>:<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:Spacing.lg,gap:12}}>
   <Ionicons name="chatbubble-ellipses-outline" size={42} color={colors.textTertiary}/>
   <Text style={{color:colors.text,fontSize:18,fontWeight:'600',textAlign:'center'}}>Start a new conversation</Text>
   <Text style={{color:colors.textSecondary,fontSize:14,lineHeight:22,textAlign:'center',maxWidth:320}}>Ask the person to share their Axonic ID or identity link. Paste it above, or tap the QR button to scan their identity.</Text>
   {ownIdentity&&<Text accessibilityRole="alert" style={{color:colors.error,textAlign:'center'}}>This is your identity. Paste someone else’s ID.</Text>}
  </View>}

 </KeyboardAvoidingScreen>;

}
