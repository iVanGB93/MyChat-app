import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import { useContactName } from '../../hooks/useContactName';
import { initiateCall, endCall } from '../../services/callService';
import { useAppStore } from '../../store/appStore';
import type { RootStackParamList } from '../../types';
import { Font, Radius, Spacing } from '../../theme';

export default function OutgoingCallScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'OutgoingCall'>) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { ensure } = usePermissionPrompt();
  const name = useContactName()(route.params.peerUserId, route.params.otherName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const proceed = useRef(false);
  const cancel = () => { if (!lock.current) navigation.goBack(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (lock.current && !proceed.current) event.preventDefault();
  }), [navigation]);
  const start = async () => {
    if (lock.current) return;
    if (useAppStore.getState().activeCall || useAppStore.getState().incomingCall) {
      setError('Finish your current call before starting another.'); return;
    }
    lock.current = true; setBusy(true); setError('');
    try {
      if (!await ensure(route.params.callType === 'video' ? 'camera+microphone' : 'microphone')) return;
      if (!mounted.current) return;
      const result = await initiateCall(route.params.peerUserId, route.params.callType);
      if (!mounted.current) { await endCall(result.call_id); return; }
      proceed.current = true;
      navigation.replace('ActiveCall', { ...route.params, callId: result.call_id, roomName: result.room_name, isOutgoing: true });
    } catch (failure: any) {
      if (mounted.current) setError(failure?.response?.data?.error || 'The call could not be confirmed. Check your connection before trying again.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: insets.top }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel call confirmation" disabled={busy} onPress={cancel} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
    <ScrollView style={{ flexGrow: 0, backgroundColor: c.surface, borderColor: c.neonBorder, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg }} contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xl + insets.bottom, gap: Spacing.sm }}>
      <View style={{ alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: c.neonBorder, marginBottom: Spacing.md, opacity: 0.6 }} />
      <View style={{ alignSelf: 'center', width: 52, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: c.primary, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm }}>
        <Ionicons name={route.params.callType === 'video' ? 'videocam-outline' : 'call-outline'} size={24} color={c.primary} />
      </View>
      <Text accessibilityRole="header" style={{ color: c.primary, fontSize: Font.size.md, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center' }}>{busy ? 'STARTING CALL…' : `START ${route.params.callType.toUpperCase()} CALL?`}</Text>
      <Text style={{ color: c.textSecondary, fontSize: Font.size.sm, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.md }}>{busy ? `Connecting to ${name}. You only need to press Start once.` : `Would you like to start a ${route.params.callType} call with ${name}?`}</Text>
      {busy && <ActivityIndicator accessibilityLabel="Starting call" size="large" color={c.primary} style={{ marginVertical: Spacing.md }} />}
      {!!error && <Text selectable accessibilityRole="alert" style={{ color: c.error, textAlign: 'center' }}>{error}</Text>}
      {!busy && <>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Start ${route.params.callType} call`} onPress={() => void start()} style={[styles.button, { borderColor: c.primary, backgroundColor: c.highlight }]}><Text style={[styles.buttonText, { color: c.primary }]}>START {route.params.callType.toUpperCase()} CALL</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={cancel} style={[styles.button, { borderColor: c.neonBorder, borderStyle: 'dashed' }]}><Text style={[styles.buttonText, { color: c.textSecondary }]}>CANCEL</Text></TouchableOpacity>
      </>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  button: { paddingVertical: Spacing.md, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1.5 },
  buttonText: { fontSize: Font.size.sm, fontWeight: '800', letterSpacing: 1.5 },
});
