import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {identityScannerStyles as scanStyles} from '../screens/contacts/identity-scanner-styles';
import {Spacing} from '../theme';
import React, {useRef, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {CameraView, useCameraPermissions} from 'expo-camera';
import {useTheme} from '../contexts/ThemeContext';
import {parseIdentityCode} from '../modules/identity';
import {Ionicons} from '@expo/vector-icons';
import {contactListStyles} from '../screens/contacts/contact-list-styles';

export default function RootIdentityScanner({onIdentity,compact=false}: {onIdentity(account: string): void;compact?:boolean}) {
  const {colors} = useTheme(), [permission, requestPermission] = useCameraPermissions();
  const insets=useSafeAreaInsets(),[torch,setTorch]=useState(false);
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const received = useRef(false);
  async function start() {
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) {setError('Allow camera access in your phone settings to scan a QR code.'); return;}
    received.current = false; setError(''); setOpen(true);
  }
  return <>
    <Pressable accessibilityLabel="Scan identity QR" onPress={() => void start().catch(() => setError('Camera unavailable. Paste the identity instead.'))} style={compact?[contactListStyles.scanBtn,{borderColor:colors.primary,backgroundColor:colors.surface}]:{padding: 14, borderWidth: 1, borderColor: colors.neonBorder, borderRadius: 12}}>{compact?<Ionicons name="qr-code-outline" size={22} color={colors.primary}/>:<Text style={{color: colors.primary}}>Scan QR code</Text>}</Pressable>
    {!!error && <Text accessibilityRole="alert" style={{color: colors.error}}>{error}</Text>}
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="slide">
      <View style={[scanStyles.container,{backgroundColor:'#000'}]}>
        {open&&<CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>{if(received.current)return;const account=parseIdentityCode(data);if(!account)return;received.current=true;setOpen(false);setError('');onIdentity(account);}}/>}
        <View style={scanStyles.overlay} pointerEvents="none"><View style={[scanStyles.reticle,{borderColor:colors.primary,shadowColor:colors.primary}]}/></View>
        <View style={[scanStyles.hintBox,{top:insets.top+Spacing.lg}]}><Text style={scanStyles.hintText}>Point your camera at an Axonic identity QR code</Text></View>
        <View style={[scanStyles.controls,{bottom:insets.bottom+Spacing.xl}]}><TouchableOpacity accessibilityLabel="Cancel QR scan" style={[scanStyles.controlBtn,{borderColor:colors.neonBorder}]} onPress={()=>setOpen(false)}><Ionicons name="close" size={26} color="#fff"/></TouchableOpacity><TouchableOpacity accessibilityLabel="Toggle flashlight" style={[scanStyles.controlBtn,{borderColor:torch?colors.accent:colors.neonBorder,backgroundColor:torch?'rgba(255,255,255,0.15)':'transparent'}]} onPress={()=>setTorch(t=>!t)}><Ionicons name={torch?'flashlight':'flashlight-outline'} size={24} color="#fff"/></TouchableOpacity></View>
      </View>
    </Modal>
  </>;
}
