import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import React, {useEffect, useState} from 'react';
import { Modal, Share, ScrollView, Switch, Text, TouchableOpacity, View, useWindowDimensions} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Ionicons} from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as ImagePicker from 'expo-image-picker';
import {readProfileAvatar,storeProfileAvatar} from '../../modules/storage';

import Avatar from '../../components/ui/Avatar';
import {useTheme} from '../../contexts/ThemeContext';
import {displayIdentity,shortIdentity} from '../../modules/identity';
import type {RootAccountRoutes} from '../../navigation/rootAccountRoutes';
import {profileStyles as styles} from './profile-styles';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultRootNotificationPreferences,readRootNotificationPreferences,saveRootNotificationPreferences,type RootNotificationPreferences} from '../../modules/messaging/notifications';
import notifee from '@notifee/react-native';

export default function RootProfileScreen({account, loginName, connected, children}: {
  account: string; loginName: string | null; connected: number;
  children: React.ReactNode;
}) {
  const {colors: Colors, preference, setPreference} = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootAccountRoutes>>();
  const insets=useSafeAreaInsets();
  const [preferences,setPreferences]=useState(defaultRootNotificationPreferences),[preferencesReady,setPreferencesReady]=useState(false);
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
      .catch(() => Alert.alert('Profile', 'Could not read this device’s profile.'));
    return () => {active = false;};
  }, [account]);
  useEffect(()=>{let active=true;setPreferencesReady(false);void readRootNotificationPreferences(account).then(value=>{if(active){setPreferences(value);setPreferencesReady(true);}}).catch(()=>Alert.alert('Notifications','Could not read notification preferences.'));return()=>{active=false;};},[account]);
  async function preferenceChanged(key:keyof RootNotificationPreferences,value:boolean){await run(async()=>{const next={...preferences,[key]:value};await saveRootNotificationPreferences(account,next);setPreferences(next);});}
  async function run(work: () => Promise<void>) {
    if (busy) return; setBusy(true);
    try {await work();} catch (e) {Alert.alert('Profile', e instanceof Error ? e.message : 'Please try again.');}
    finally {setBusy(false);}
  }
  const chooseAvatar = async (camera: boolean) => {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw Error('Allow camera or photo access in your phone settings.');
    const options = {mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.8};
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return;
    const destination = await storeProfileAvatar(account,result.assets[0].uri,avatar); setAvatar(destination);
  };
  const card = {backgroundColor: Colors.surface, borderColor: Colors.neonBorder};
  return <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={[styles.card, styles.identityCard, card]}>
      <View style={styles.identityRow}>
      <View style={styles.identityAvatarColumn}>
      <TouchableOpacity accessibilityLabel="Change profile photo" disabled={busy} onPress={() => Alert.alert('Profile photo', 'Choose a photo for this device.', [
        {text: 'Camera', onPress: () => void run(() => chooseAvatar(true))},
        {text: 'Photo library', onPress: () => void run(() => chooseAvatar(false))}, {text: 'Cancel', style: 'cancel'},
      ])}>
        <Avatar name={loginName || 'Axon'} uri={avatar} size={100}/>
        <View style={[styles.avatarEditBadge, {backgroundColor: Colors.surface, borderColor: Colors.primary}]}><Ionicons name="camera" size={14} color={Colors.primary}/></View>
      </TouchableOpacity>
      <Text style={[styles.username, styles.identityUsername, {color: Colors.primary}]}>{(loginName || 'Axon').toUpperCase()}</Text>
      <Text style={[styles.email, styles.identityCaption, {color: Colors.textSecondary}]}>Your local account</Text>
      </View>
      <View style={styles.identityQrColumn} onLayout={({nativeEvent}) => setQrSize(Math.max(1, Math.min(100, Math.floor(nativeEvent.layout.width - 18))))}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Enlarge public identity QR code" onPress={() => setQrOpen(true)} style={[styles.identityQrBox, {backgroundColor: '#fff', borderColor: Colors.neonBorder}]}><QRCode value={code} size={qrSize} backgroundColor="#fff" color="#000"/></TouchableOpacity>
        <Text style={[styles.qrHint, {color: Colors.textTertiary}]}>Tap to enlarge</Text>
      </View>
      </View>
      <View style={[styles.statusBadge, styles.identityStatus, {borderColor: connected ? Colors.online : Colors.border}]}>
        <View style={[styles.statusDot, {backgroundColor: connected ? Colors.online : Colors.textSecondary}]}/>
        <Text style={[styles.statusText, {color: connected ? Colors.online : Colors.textSecondary}]}>{connected ? 'CONNECTED' : 'FINDING NEURONS'}</Text>
      </View>
      <TouchableOpacity accessibilityLabel="Share public identity code" disabled={busy} onPress={() => void run(async () => {await Share.share({message: code});})} style={[styles.tagBox, {borderColor: Colors.accent, backgroundColor: Colors.highlight}]}>
        <View style={{flex: 1}}><Text style={[styles.label, {color: Colors.textSecondary}]}>YOUR AXON</Text><Text selectable style={{color: Colors.accent, fontSize: 14, fontWeight: '700'}}>{shortIdentity(account)}</Text><Text style={[styles.tagHint, {color: Colors.textTertiary}]}>Tap to share your identity.</Text></View>
        <Ionicons name="share-outline" size={20} color={Colors.accent}/>
      </TouchableOpacity>
    </View>
    <TouchableOpacity accessibilityLabel="Network" onPress={() => navigation.navigate('Network')} style={[styles.card, card]}><Text style={[styles.cardTitle, {color: Colors.primary}]}>◎ NETWORK</Text><Text style={{color: Colors.textSecondary}}>Connections, participation, and network information →</Text></TouchableOpacity>
    <View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>◈ ACCOUNT</Text><View style={[styles.infoRow,{borderBottomColor:Colors.divider}]}><Text style={[styles.infoLabel,{color:Colors.textSecondary}]}>USERNAME</Text><Text style={[styles.infoValue,{color:Colors.text}]}>{loginName||'Axon'}</Text></View><TouchableOpacity accessibilityLabel="Account and security" style={styles.actionRow} onPress={()=>setAccountOpen(true)}><View style={styles.actionLeft}><Ionicons name="lock-closed-outline" size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>LOCAL LOGIN & SECURITY</Text></View><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>
    <View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>◈ DEVICE CHAT STORAGE</Text><TouchableOpacity style={styles.actionRow} onPress={()=>navigation.navigate('ChatStorage')}><View style={styles.actionLeft}><Ionicons name="folder-outline" size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>MANAGE CHAT STORAGE</Text></View><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>
    <View style={[styles.card, card]}><Text style={[styles.cardTitle, {color: Colors.primary}]}>◈ DISPLAY</Text><View style={styles.themeRow}>{(['system', 'light', 'dark'] as const).map(mode => <TouchableOpacity key={mode} accessibilityLabel={`Theme ${mode}`} onPress={() => setPreference(mode)} style={[styles.themeOption, {borderColor: preference === mode ? Colors.primary : Colors.border,backgroundColor:preference===mode?Colors.highlight:Colors.background}]}><Ionicons name={mode==='system'?'phone-portrait-outline':mode==='light'?'sunny-outline':'moon-outline'} size={22} color={preference===mode?Colors.primary:Colors.textSecondary}/><Text style={[styles.themeLabel, {color: preference === mode ? Colors.primary : Colors.textSecondary}]}>{mode.toUpperCase()}</Text></TouchableOpacity>)}</View></View>
    <View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>◈ NOTIFICATIONS</Text>{([['messages','MESSAGE PUSH','Receive a notification when someone messages you'],['calls','CALL PUSH','Receive a notification for incoming calls'],['sound','IN-APP SOUND','Play a sound for incoming calls']] as const).map(([key,label,description])=><View key={key} style={[styles.toggleRow,{borderBottomColor:Colors.divider}]}><View style={{flex:1}}><Text style={[styles.toggleLabel,{color:Colors.text}]}>{label}</Text><Text style={[styles.toggleDesc,{color:Colors.textSecondary}]}>{description}</Text></View><Switch accessibilityLabel={label} disabled={busy||!preferencesReady} value={preferences[key]} onValueChange={value=>void preferenceChanged(key,value)} trackColor={{false:Colors.border,true:Colors.primary}}/></View>)}<TouchableOpacity style={styles.actionRow} onPress={()=>void run(()=>notifee.openNotificationSettings())}><Text style={[styles.actionLabel,{color:Colors.text}]}>SYSTEM NOTIFICATION SETTINGS</Text><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>
    <View style={[styles.card,card]}><Text style={[styles.cardTitle,{color:Colors.primary}]}>◈ PRIVACY</Text><TouchableOpacity style={styles.actionRow} onPress={()=>navigation.navigate('BlockedUsers')}><View style={styles.actionLeft}><Ionicons name="ban-outline" size={20} color={Colors.primary}/><Text style={[styles.actionLabel,{color:Colors.text}]}>BLOCKED USERS</Text></View><Ionicons name="chevron-forward" size={20} color={Colors.textTertiary}/></TouchableOpacity></View>
    <Modal visible={accountOpen} animationType="slide" onRequestClose={()=>setAccountOpen(false)}><View style={{flex:1,backgroundColor:Colors.background,paddingTop:insets.top}}><View style={{flexDirection:'row',alignItems:'center',padding:16,gap:16,backgroundColor:Colors.headerBg}}><TouchableOpacity accessibilityLabel="Back to profile" onPress={()=>setAccountOpen(false)}><Ionicons name="arrow-back" size={26} color={Colors.headerText}/></TouchableOpacity><Text style={{color:Colors.headerText,fontSize:18,fontWeight:'600'}}>Account and security</Text></View><ScrollView contentContainerStyle={{padding:16,paddingBottom:insets.bottom+24,gap:16}}>{children}</ScrollView></View></Modal>
    <Modal visible={qrOpen} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setQrOpen(false)}>
      <TouchableOpacity activeOpacity={1} accessibilityRole="button" accessibilityLabel="Close enlarged QR code" onPress={() => setQrOpen(false)} style={[styles.expandedQrScreen, {backgroundColor: Colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 16, paddingRight: insets.right + 16}]}>
        <Text style={[styles.cardTitle, {color: Colors.primary}]}>YOUR AXON</Text>
        <View style={styles.expandedQrBox}><QRCode value={code} size={expandedQrSize} backgroundColor="#fff" color="#000"/></View>
        <Text style={[styles.qrHint, {color: Colors.textSecondary}]}>Scan to start a chat</Text>
        <Text style={[styles.qrHint, {color: Colors.textSecondary}]}>Tap anywhere to return</Text>
      </TouchableOpacity>
    </Modal>
  </ScrollView>;
}
