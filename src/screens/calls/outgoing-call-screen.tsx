import OutgoingCallAppearance from './OutgoingCallAppearance';
import { neuronCallsEnabled } from '../../services/identity/neuronCallFeature';
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
import { waitForNeuronCallPeer } from '../../services/identity/mobileNeuronCalls';

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
    const owner=useAppStore.getState().user?.id;
    lock.current = true; setBusy(true); setError('');
    try {
      if (!await ensure(route.params.callType === 'video' ? 'camera+microphone' : 'microphone')) return;
      if (!mounted.current || useAppStore.getState().user?.id !== owner) return;
      if (neuronCallsEnabled()) {
        const calls=await waitForNeuronCallPeer(route.params.peerUserId,()=>mounted.current&&!!owner&&useAppStore.getState().user?.id===owner);
        if(!mounted.current||useAppStore.getState().user?.id!==owner)return;
        if(!calls)throw Error('Neuron calls are not ready. Keep the app open and try again.');
        const callId=await calls.start(route.params.peerUserId,route.params.callType);
        if(!mounted.current){await calls.end(callId);return;}
        proceed.current=true;
        navigation.replace('NeuronCall',{callId,otherName:name});return;
      }
      const result = await initiateCall(route.params.peerUserId, route.params.callType);
      if (!mounted.current) { await endCall(result.call_id); return; }
      proceed.current = true;
      navigation.replace('ActiveCall', { ...route.params, callId: result.call_id, roomName: result.room_name, isOutgoing: true });
    } catch (failure: any) {
      if (mounted.current) setError(failure?.response?.data?.error || failure?.message || 'The call could not be confirmed. Check your connection before trying again.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <OutgoingCallAppearance name={name} kind={route.params.callType} busy={busy} error={error} start={()=>void start()} cancel={cancel}/>;
}
