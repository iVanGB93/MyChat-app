import {t} from '../../localization/language';
import AppUpdateProgress from '../../components/ui/AppUpdateProgress';
import ScreenHeader from '../../components/ui/ScreenHeader';
import {updateSharedProfileAvatar,removeSharedProfileAvatar} from '../../modules/messaging';
import RecoveryWordsReveal from './RecoveryWordsReveal';
import ProfilePermissions from './ProfilePermissions';
import {KeyboardFormScrollView} from '../../components/ui/KeyboardForm';
import {appUpdates,openAppDestination} from '../../modules/maintenance';
import Constants from 'expo-constants';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import React, {useEffect, useState} from 'react';
import { Modal, Share, FlatList, Switch, Text, TouchableOpacity, View, useWindowDimensions} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Ionicons} from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import {readProfileAvatar,getAutoSaveReceivedMedia,setAutoSaveReceivedMedia,finishRootMediaCleanup} from '../../modules/storage';

import Avatar from '../../components/ui/Avatar';
import {useTheme} from '../../contexts/ThemeContext';
import {displayIdentity,identityLink,shortIdentity} from '../../modules/identity';
import type {RootAccountRoutes} from '../../navigation/rootAccountRoutes';
import {profileStyles as styles} from './profile-styles';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useHeaderHeight} from '@react-navigation/elements';
import {defaultRootNotificationPreferences,readRootNotificationPreferences,saveRootNotificationPreferences,type RootNotificationPreferences} from '../../modules/messaging/notifications';
import notifee from '@notifee/react-native';
import {useNetworkState,useNotificationPreferenceState} from '../../modules/ui/liveState';

function ProfileConnectionBadge(){
 const {colors}=useTheme(),connected=useNetworkState(state=>state.liveConnections.length>0);
 return <View style={[styles.statusBadge,styles.identityStatus,{borderColor:connected?colors.online:colors.border}]}>
  <View style={[styles.statusDot,{backgroundColor:connected?colors.online:colors.textSecondary}]}/>
  <Text style={[styles.statusText,{color:connected?colors.online:colors.textSecondary}]}>{connected?t("CONNECTED"):t("FINDING NEURONS")}</Text>
 </View>;
}

export default function RootProfileScreen({account, loginName, children}: {
  account: string; loginName: string | null;
  children: React.ReactNode;
}) {
  const {colors: Colors, preference, setPreference, languagePreference, setLanguagePreference} = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootAccountRoutes>>();
  const insets=useSafeAreaInsets(),headerHeight=useHeaderHeight();
  const savedPreferences=useNotificationPreferenceState(account),preferences=savedPreferences??defaultRootNotificationPreferences,[preferencesReady,setPreferencesReady]=useState(false);
  const [update,setUpdate]=useState(appUpdates.snapshot);
  useEffect(()=>{const refresh=()=>setUpdate(appUpdates.snapshot());const unsubscribe=appUpdates.subscribe(refresh);refresh();return unsubscribe;},[]);
  const updateLabel=__DEV__?t("Updates are managed in your development build"):({idle:t("Check for updates"),checking:t("Checking for updates…"),unavailable:t("Google Play update check unavailable"),current:t("Axonic is up to date"),available:t("Update available on Google Play"),downloading:update.progress===undefined?t("Downloading update…"):t("Downloading update · {0}%",{0:update.progress}),installing:t("Installing update…"),ready:t("Update ready to install"),error:t("Could not check for updates. Tap to retry.")} as const)[update.status];
  const [autoSave,setAutoSave]=useState(true);
  useEffect(()=>{void getAutoSaveReceivedMedia().then(setAutoSave).catch(()=>{});},[]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [qrSize, setQrSize] = useState(100);
  const [qrOpen, setQrOpen] = useState(false);
  const {width, height} = useWindowDimensions();
  const expandedQrSize = Math.max(1, Math.min(width - insets.left - insets.right - 64, height - insets.top - insets.bottom - 160, 480));
  const [busy, setBusy] = useState(false), [accountOpen, setAccountOpen] = useState(false);
  const code = displayIdentity(account);
  useEffect(() => {
    let active = true; setAvatar(null);
    void readProfileAvatar(account).then(image => {if (active) setAvatar(image);})
      .catch(() => Alert.alert(t("Profile"), t("Could not read this device’s profile.")));
    return () => {active = false;};
  }, [account]);
  useEffect(()=>{let active=true;setPreferencesReady(false);void readRootNotificationPreferences(account).then(()=>{if(active)setPreferencesReady(true);}).catch(()=>Alert.alert(t("Notifications"),t("Could not read notification preferences.")));return()=>{active=false;};},[account]);
  async function preferenceChanged(key:keyof RootNotificationPreferences,value:boolean){await run(async()=>{const next={...preferences,[key]:value};await saveRootNotificationPreferences(account,next);});}
  async function run(work: () => Promise<void>) {
    if (busy) return; setBusy(true);
    try {await work();} catch (e) {Alert.alert(t("Profile"), e instanceof Error ? e.message : t("Please try again."));}
    finally {setBusy(false);}
  }
  const chooseAvatar = async (camera: boolean) => {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw Error(t("Allow camera or photo access in your phone settings."));
    const options = {mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.8};
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return;
    const destination = await updateSharedProfileAvatar(account,result.assets[0].uri,avatar); setAvatar(destination);
  };
  const card = {backgroundColor: Colors.surface, borderColor: Colors.neonBorder};
  // Keep only nearby settings cards mounted; modal state stays outside the list.
  const sections=[{key:'identity',content:(<View style={[styles.card, styles.identityCard, card]}>
      <View style={styles.identityRow}>
      <View style={styles.identityAvatarColumn}>
      <TouchableOpacity accessibilityLabel={t("Change profile photo")} disabled={busy} onPress={() => Alert.alert(t("Profile photo"), t("Choose a photo to share with people you chat with."), [
        {text: t("Camera"), onPress: () => void run(() => chooseAvatar(true))},
        {text: t("Photo library"), onPress: () => void run(() => chooseAvatar(false))}, ...(avatar?[{text:t("Remove photo"),style:'destructive' as const,onPress:()=>void run(async()=>{await removeSharedProfileAvatar(account);setAvatar(null);})}]:[]), {text: t("Cancel"), style: 'cancel'},
      ])}>
        <Avatar name={loginName || 'Axon'} uri={avatar} size={100}/>
        <View style={[styles.avatarEditBadge, {backgroundColor: Colors.surface, borderColor: Colors.primary}]}><Ionicons name="camera" size={14} color={Colors.primary}/></View>
      </TouchableOpacity>
      <Text style={[styles.username, styles.identityUsername, {color: Colors.primary}]}>{(loginName || 'Axon').toUpperCase()}</Text>
      <Text style={[styles.email, styles.identityCaption, {color: Colors.textSecondary}]}>{t("Your local account")}</Text>
      </View>
      <View style={styles.identityQrColumn} onLayout={({nativeEvent}) => setQrSize(Math.max(1, Math.min(100, Math.floor(nativeEvent.layout.width - 18))))}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Enlarge public identity QR code")} onPress={() => setQrOpen(true)} style={[styles.identityQrBox, {backgroundColor: '#fff', borderColor: Colors.neonBorder}]}><QRCode value={code} size={qrSize} backgroundColor="#fff" color="#000"/></TouchableOpacity>
        <Text style={[styles.qrHint, {color: Colors.textTertiary}]}>{t("Tap to enlarge")}</Text>
      </View>
      </View>
      <View style={styles.identityActionsRow}>
      <View style={styles.identityActionColumn}>
      <ProfileConnectionBadge/>
      </View>
      <View style={styles.identityActionColumn}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Copy ID")} disabled={busy} onPress={()=>void run(async()=>{await Clipboard.setStringAsync(code);Alert.alert(t("Identity copied"),t("Your full identity code is ready to paste."));})} style={[styles.copyIdButton,{borderColor:Colors.primary,backgroundColor:Colors.highlight}]}>
          <Ionicons name="copy-outline" size={16} color={Colors.primary}/><Text style={[styles.copyIdText,{color:Colors.primary}]}>{t("Copy ID")}</Text>
        </TouchableOpacity>
      </View>
      </View>
      <TouchableOpacity accessibilityLabel={t("Share identity link")} disabled={busy} onPress={() => void run(async () => {await Share.share({message: identityLink(account)});})} style={[styles.tagBox, {borderColor: Colors.accent, backgroundColor: Colors.highlight}]}>
        <View style={{flex: 1}}><Text style={[styles.label, {color: Colors.textSecondary}]}>{t("YOUR AXON")}</Text><Text style={{color: Colors.accent, fontSize: 14, fontWeight: '700'}}>{shortIdentity(account)}</Text><Text style={[styles.tagHint, {color: Colors.textTertiary}]}>{t("Tap to share a link to your identity.")}</Text></View>
        <Ionicons name="share-outline" size={20} color={Colors.accent}/>
      </TouchableOpacity>
    </View>)},
{key:'network',content:(<TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Network")} onPress={() => navigation.navigate('Network')} style={[styles.card, card,{flexDirection:'row',alignItems:'center',gap:12}]}><View style={{flex:1,minWidth:0}}><Text style={[styles.cardTitle, {color: Colors.primary}]}>{t("◎ NETWORK")}</Text><Text style={{color: Colors.textSecondary}}>{t("Connections, participation, and network information")}</Text></View><Ionicons name="chevron-forward" size={22} color={Colors.textTertiary}/></TouchableOpacity>)},
{key:'account',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ ACCOUNT")}</Text><View style={[styles.infoRow,{borderBottomColor:Colors.divider}]}><Text style={[styles.infoLabel,{color:Colors.textSecondary}]}>{t("USERNAME")}</Text><Text style={[styles.infoValue,{color:Colors.text}]}>{loginName||'Axon'}</Text></View><TouchableOpacity accessibilityLabel={t("Account and security")} style={styles.actionRow} onPress={()=>setAccountOpen(true)}><View style={styles.actionLeft}><Ionicons name="lock-closed-outline" size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>{t("LOCAL LOGIN & SECURITY")}</Text></View><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>)},
{key:'storage',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ DEVICE CHAT STORAGE")}</Text><TouchableOpacity style={styles.actionRow} onPress={()=>navigation.navigate('ChatStorage')}><View style={styles.actionLeft}><Ionicons name="folder-outline" size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>{t("MANAGE CHAT STORAGE")}</Text></View><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>)},
{key:'media',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ RECEIVED MEDIA")}</Text><View style={[styles.toggleRow,{borderBottomColor:Colors.divider}]}><View style={{flex:1}}><Text style={[styles.toggleLabel,{color:Colors.text}]}>{t("SAVE RECEIVED MEDIA")}</Text><Text style={[styles.toggleDesc,{color:Colors.textSecondary}]}>{t("Photos and videos appear in Gallery. Other files go to Downloads/Axonic.")}</Text></View><Switch accessibilityLabel={t("Save received media automatically")} disabled={busy} value={autoSave} onValueChange={value=>void run(async()=>{await setAutoSaveReceivedMedia(value);setAutoSave(value);})} trackColor={{false:Colors.border,true:Colors.primary}}/></View><TouchableOpacity accessibilityLabel={t("Finish media cleanup")} disabled={busy} style={styles.actionRow} onPress={()=>void run(async()=>{const pending=await finishRootMediaCleanup();Alert.alert(t("Media cleanup"),pending?t("Some files still need your approval. Run cleanup again when ready."):t("No pending media cleanup remains."));})}><Text style={[styles.actionLabel,{color:Colors.text}]}>{t("FINISH MEDIA CLEANUP")}</Text><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>)},
{key:'language',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ LANGUAGE")}</Text><View style={styles.themeRow}>{(['system','en','es'] as const).map(value=><TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{selected:languagePreference===value}} onPress={()=>void run(()=>setLanguagePreference(value))} style={[styles.themeOption,{borderColor:languagePreference===value?Colors.primary:Colors.border,backgroundColor:languagePreference===value?Colors.highlight:Colors.background}]}><Text style={{color:languagePreference===value?Colors.primary:Colors.text,textAlign:'center'}}>{value==='system'?t("Device default"):value==='en'?t("English"):'Español'}</Text></TouchableOpacity>)}</View></View>)},{key:'display',content:(<View style={[styles.card, card]}><Text style={[styles.cardTitle, {color: Colors.primary}]}>{t("◈ DISPLAY")}</Text><View style={styles.themeRow}>{(['system', 'light', 'dark'] as const).map(mode => <TouchableOpacity key={mode} accessibilityLabel={t("Theme {0}",{0:t(mode)})} onPress={() => setPreference(mode)} style={[styles.themeOption, {borderColor: preference === mode ? Colors.primary : Colors.border,backgroundColor:preference===mode?Colors.highlight:Colors.background}]}><Ionicons name={mode==='system'?'phone-portrait-outline':mode==='light'?'sunny-outline':'moon-outline'} size={22} color={preference===mode?Colors.primary:Colors.textSecondary}/><Text style={[styles.themeLabel, {color: preference === mode ? Colors.primary : Colors.textSecondary}]}>{t(mode.toUpperCase())}</Text></TouchableOpacity>)}</View></View>)},
{key:'notifications',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ NOTIFICATIONS")}</Text>{([['messages','MESSAGE PUSH','Receive a notification when someone messages you'],['calls','CALL PUSH','Receive a notification for incoming calls'],['sound','IN-APP SOUND','Play a sound for incoming calls']] as const).map(([key,label,description])=><View key={key} style={[styles.toggleRow,{borderBottomColor:Colors.divider}]}><View style={{flex:1}}><Text style={[styles.toggleLabel,{color:Colors.text}]}>{t(label)}</Text><Text style={[styles.toggleDesc,{color:Colors.textSecondary}]}>{t(description)}</Text></View><Switch accessibilityLabel={t(label)} disabled={busy||!preferencesReady} value={preferences[key]} onValueChange={value=>void preferenceChanged(key,value)} trackColor={{false:Colors.border,true:Colors.primary}}/></View>)}<TouchableOpacity style={styles.actionRow} onPress={()=>void run(()=>notifee.openNotificationSettings())}><Text style={[styles.actionLabel,{color:Colors.text}]}>{t("SYSTEM NOTIFICATION SETTINGS")}</Text><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>)},
{key:'permissions',content:<ProfilePermissions/>},
{key:'privacy',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ PRIVACY")}</Text><TouchableOpacity style={styles.actionRow} onPress={()=>navigation.navigate('BlockedUsers')}><View style={styles.actionLeft}><Ionicons name="ban-outline" size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>{t("BLOCKED USERS")}</Text></View><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>)},
{key:'axonic',content:(<View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>{t("◈ AXONIC")}</Text>{([['privacy','PRIVACY POLICY','shield-checkmark-outline'],['website','WEBSITE','globe-outline'],['store','GOOGLE PLAY','logo-google-playstore']] as const).map(([destination,label,icon])=><TouchableOpacity key={destination} accessibilityLabel={t(label)} disabled={busy} style={styles.actionRow} onPress={()=>void run(()=>openAppDestination(destination))}><View style={styles.actionLeft}><Ionicons name={icon} size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>{t(label)}</Text></View><Ionicons name="open-outline" size={20} color={Colors.textTertiary}/></TouchableOpacity>)}<TouchableOpacity accessibilityLabel={update.status==='ready'?t("Install Axonic update"):t("Check Axonic updates")} disabled={busy||__DEV__||update.status==='downloading'||update.status==='installing'||update.status==='checking'} style={styles.actionRow} onPress={()=>void run(async()=>{if(update.status==='ready'){Alert.alert(t("Install update?"),t("Axonic will restart to finish installing the update."),[{text:t("Cancel"),style:'cancel'},{text:t("Install"),onPress:()=>void run(async()=>{const outcome=await appUpdates.install();if(outcome==='failed')Alert.alert(t("Couldn’t install the update"),t("Try again or open Axonic in Google Play."));else if(outcome==='restart-blocked')Alert.alert(t("Update postponed"),t("Finish your call or voice recording, then try again."));})}]);}else if(await appUpdates.check(true,true)==='restart-blocked')Alert.alert(t("Update postponed"),t("Finish your call or voice recording, then try again."));})}><View style={styles.actionLeft}><Ionicons name="download-outline" size={20} color={Colors.primary}/><View style={{flex:1}}><Text style={[styles.actionLabel,{color:Colors.text}]}>{t("APP UPDATES")}</Text><Text style={[styles.toggleDesc,{color:Colors.textSecondary}]}>{updateLabel}</Text>{update.status==='downloading'&&<View style={{marginTop:10}}><AppUpdateProgress progress={update.progress}/></View>}</View></View><Ionicons name={update.status==='ready'?'download-outline':update.status==='current'?'checkmark-circle-outline':update.status==='downloading'||update.status==='checking'||update.status==='installing'?'time-outline':'chevron-forward'} size={20} color={update.status==='ready'?Colors.primary:Colors.textTertiary}/></TouchableOpacity></View>)},
{key:'version',content:(<Text style={[styles.versionText,{color:Colors.textTertiary}]}>{t("Axonic · Version")}{' '}{Constants.expoConfig?.version ?? 'unavailable'}</Text>)}];
  return <><FlatList data={sections} keyExtractor={item=>item.key} renderItem={({item})=>item.content} initialNumToRender={4} maxToRenderPerBatch={3} windowSize={3} style={styles.container} contentContainerStyle={[styles.content,{paddingTop:headerHeight,paddingBottom:66+Math.max(insets.bottom,8)+8+24}]} keyboardShouldPersistTaps="handled"/>
<Modal visible={accountOpen} animationType="slide" onRequestClose={()=>setAccountOpen(false)}><View style={{flex:1,backgroundColor:Colors.background}}><ScreenHeader title={t("Account and security")} backLabel="Back to profile" onBack={()=>setAccountOpen(false)}/><KeyboardFormScrollView contentContainerStyle={{padding:16,paddingBottom:insets.bottom+24,gap:16}}><RecoveryWordsReveal account={account} visible={accountOpen}/>{children}</KeyboardFormScrollView></View></Modal>
<Modal visible={qrOpen} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setQrOpen(false)}>
      <TouchableOpacity activeOpacity={1} accessibilityRole="button" accessibilityLabel={t("Close enlarged QR code")} onPress={() => setQrOpen(false)} style={[styles.expandedQrScreen, {backgroundColor: Colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 16, paddingRight: insets.right + 16}]}>
        <Text style={[styles.cardTitle, {color: Colors.primary}]}>{t("YOUR AXON")}</Text>
        <View style={styles.expandedQrBox}><QRCode value={code} size={expandedQrSize} backgroundColor="#fff" color="#000"/></View>
        <Text style={[styles.qrHint, {color: Colors.textSecondary}]}>{t("Scan to start a chat")}</Text>
        <Text style={[styles.qrHint, {color: Colors.textSecondary}]}>{t("Tap anywhere to return")}</Text>
      </TouchableOpacity>
    </Modal>
</>;
}
