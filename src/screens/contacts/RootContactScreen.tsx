import {KeyboardFormScrollView} from '../../components/ui/KeyboardForm';
import {KeyboardAwareTextInput as TextInput} from '../../components/ui/KeyboardForm';
import {useChatSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import {userInfoStyles as infoStyles} from '../chat/user-info-styles';
import QRCode from 'react-native-qrcode-svg';
import {displayIdentity,shortIdentity,identityLink} from '../../modules/identity';
import * as Clipboard from 'expo-clipboard';
import React,{useEffect,useState} from 'react';
import {Keyboard,Modal,useWindowDimensions,Share,Text,TouchableOpacity,View} from 'react-native';
import {useHeaderHeight} from '@react-navigation/elements';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';
import {conversations} from '../../modules/messaging';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {report} from '../rootScreenSupport';
export default function Contact({route,navigation}:Screen<'Contact'>){

 const {colors}=useTheme(),{state,error}=useOwnChat(),peer=route.params.peer,contact=state.contacts.find(c=>c.account===peer);

 const identity=displayIdentity(peer),name=contact?.alias||shortIdentity(peer);

 const header=useHeaderHeight(),insets=useSafeAreaInsets();

 const [alias,setAlias]=useState<string|null>(null),[saving,setSaving]=useState(false),[qrOpen,setQrOpen]=useState(false);
 const {width,height}=useWindowDimensions();
 const qrSize=Math.max(1,Math.min(width-insets.left-insets.right-64,height-insets.top-insets.bottom-160,480));

 useEffect(()=>{setAlias(null);setQrOpen(false);},[peer]);

 async function save(){if(alias===null||saving)return;setSaving(true);try{await conversations().configure(peer,{alias});setAlias(null);Alert.alert('Nickname saved','Only you see this name on this phone.');}catch(e){report(e);}finally{setSaving(false);}}

 const Action=({icon,label,onPress}:{icon:React.ComponentProps<typeof Ionicons>['name'];label:string;onPress:()=>void})=><TouchableOpacity style={infoStyles.action} activeOpacity={0.72} accessibilityLabel={label} onPress={onPress}><View style={[infoStyles.actionIcon,{borderColor:colors.neonBorder,backgroundColor:colors.highlight}]}><Ionicons name={icon} size={23} color={colors.primary}/></View><Text style={[infoStyles.actionLabel,{color:colors.text}]}>{label}</Text></TouchableOpacity>;

 const section={backgroundColor:colors.surface,borderColor:colors.neonBorder};

 return <KeyboardFormScrollView keyboardVerticalOffset={header} style={{backgroundColor:colors.background}} contentContainerStyle={[infoStyles.content,{paddingBottom:insets.bottom+24}]}>

  {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}

  <View style={[infoStyles.hero,section]}>

   <View style={infoStyles.identityHeading}><Avatar name={name} uri={state.avatarUris[peer]} size={64}/><View style={infoStyles.identityHeadingText}><Text selectable style={[infoStyles.name,{color:colors.text}]}>{name}</Text>

   {!!contact?.alias&&<Text selectable style={[infoStyles.username,{color:colors.textSecondary}]}>{shortIdentity(peer)}</Text>}</View></View>

   <View style={[infoStyles.divider,{backgroundColor:colors.divider}]}/><View style={infoStyles.actions}>

    <Action icon="chatbubble-ellipses-outline" label="Message" onPress={()=>navigation.navigate('ChatRoom',{peer})}/>

    <Action icon="call-outline" label="Voice" onPress={()=>{if(contact?.blocked){report('Unblock this identity before calling');return;}navigation.navigate('OutgoingCall',{peer,kind:'voice'});}}/>

    <Action icon="videocam-outline" label="Video" onPress={()=>{if(contact?.blocked){report('Unblock this identity before calling');return;}navigation.navigate('OutgoingCall',{peer,kind:'video'});}}/>

   </View>

  </View>

  <View style={[infoStyles.section,section]}>

   <Text style={[infoStyles.sectionLabel,{color:colors.textSecondary}]}>PRIVATE NICKNAME</Text><Text style={{color:colors.textSecondary}}>Only you see this name on this phone. Clear it to use their Axonic ID again.</Text>

   <TextInput accessibilityLabel="Private nickname" value={alias??contact?.alias??''} onChangeText={setAlias} editable={!saving} maxLength={80} placeholder="Enter a private nickname" placeholderTextColor={colors.textTertiary} style={{color:colors.text,padding:12,borderWidth:1,borderColor:colors.neonBorder,borderRadius:10}}/>

   <TouchableOpacity disabled={saving||alias===null} onPress={()=>void save()}><Text style={{color:colors.primary,fontWeight:'700',opacity:saving||alias===null?0.5:1}}>{saving?'Saving…':'Save nickname'}</Text></TouchableOpacity>

  </View>

  <View style={[infoStyles.section,section]}>

   <Text style={[infoStyles.sectionLabel,{color:colors.textSecondary}]}>AXONIC PROFILE</Text>

   <View style={infoStyles.detailRow}><Ionicons name="finger-print-outline" size={20} color={colors.primary}/><View style={infoStyles.detailText}><Text style={[infoStyles.detailLabel,{color:colors.textSecondary}]}>Axonic ID</Text><Text selectable style={[infoStyles.detailValue,{color:colors.text}]}>{identity}</Text></View></View>

   <View style={[infoStyles.actions,{alignItems:'center'}]}><Action icon="copy-outline" label="Copy ID" onPress={()=>void Clipboard.setStringAsync(identity).catch(report)}/><TouchableOpacity accessibilityRole="button" accessibilityLabel="Enlarge public identity QR code" onPress={()=>{Keyboard.dismiss();setQrOpen(true);}} style={infoStyles.qrBox}><QRCode value={identity} size={80} backgroundColor="#fff" color="#000"/></TouchableOpacity><Action icon="share-outline" label="Share ID" onPress={()=>void Share.share({message:identityLink(identity)}).catch(report)}/></View>

  </View>

  <TouchableOpacity style={[infoStyles.setting,section]} activeOpacity={0.72} onPress={()=>void conversations().configure(peer,{muted:!contact?.muted}).catch(report)}>

   <Ionicons name={contact?.muted?'notifications-off-outline':'notifications-outline'} size={21} color={colors.primary}/><Text style={[infoStyles.settingText,{color:colors.text}]}>{contact?.muted?'Unmute notifications':'Mute notifications'}</Text><Ionicons name="chevron-forward" size={19} color={colors.textTertiary}/>

  </TouchableOpacity>

  <TouchableOpacity style={[infoStyles.setting,section]} activeOpacity={0.72} onPress={()=>void conversations().configure(peer,{blocked:!contact?.blocked}).catch(report)}>

   <Ionicons name="ban-outline" size={21} color={colors.error}/><Text style={[infoStyles.settingText,{color:colors.error}]}>{contact?.blocked?'Unblock':'Block'}</Text><Ionicons name="chevron-forward" size={19} color={colors.textTertiary}/>

  </TouchableOpacity>

 <Modal visible={qrOpen} animationType="fade" onRequestClose={()=>setQrOpen(false)}><TouchableOpacity activeOpacity={1} accessibilityRole="button" accessibilityLabel="Close enlarged QR code" onPress={()=>setQrOpen(false)} style={[infoStyles.qrScreen,{backgroundColor:colors.background,paddingTop:insets.top+24,paddingBottom:insets.bottom+24}]}><Text style={{color:colors.text,fontSize:22,fontWeight:'700'}}>{name}</Text><View style={infoStyles.qrBox}><QRCode value={identity} size={qrSize} backgroundColor="#fff" color="#000"/></View><Text style={{color:colors.textSecondary}}>Tap anywhere to return</Text></TouchableOpacity></Modal>
 </KeyboardFormScrollView>;

}
