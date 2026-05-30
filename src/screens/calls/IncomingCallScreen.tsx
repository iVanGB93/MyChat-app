/* ------------------------------------------------------------------ */
/*  Incoming Call Screen — full screen alert for incoming calls        */
/*  Plays ringtone, vibrates, uses shared NotificationContext          */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Colors, Font, Spacing } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { joinCall, endCall } from '../../services/callService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { playLooping, stopLooping, playSound } from '../../services/soundService';
import { useAppStore } from '../../store/appStore';
import Avatar from '../../components/ui/Avatar';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'IncomingCall'>;

export default function IncomingCallScreen({ route, navigation }: Props) {
  const { callId, callerName, callType, roomName } = route.params;
  const { subscribe } = useNotificationContext();
  const dismissed = useRef(false);

  // Mirror the incoming call into the global store while this screen is mounted.
  useEffect(() => {
    useAppStore.getState().setActiveCall({
      callId,
      peerId: route.params.callerId,
      peerName: callerName,
      state: 'ringing',
      callType,
    });
    return () => {
      // Clear only if this is still the active call (caller may have transitioned to ActiveCallScreen).
      const cur = useAppStore.getState().activeCall;
      if (cur && cur.callId === callId && cur.state === 'ringing') {
        useAppStore.getState().setActiveCall(null);
      }
    };
  }, [callId, callerName, callType, route.params.callerId]);

  /* ---- ringtone + vibration ---- */
  useEffect(() => {
    playLooping('ringtone');
    const interval = setInterval(() => Vibration.vibrate(1000), 2000);
    Vibration.vibrate(1000);
    return () => {
      clearInterval(interval);
      Vibration.cancel();
      stopLooping();
    };
  }, []);

  /* ---- auto-dismiss if caller cancels ---- */
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (dismissed.current) return;
      const { event, call_id } = payload;
      if (call_id && call_id !== callId) return;
      if (event === 'call_ended' || event === 'call_rejected') {
        console.log('[IncomingCall] caller cancelled');
        dismissed.current = true;
        stopLooping();
        Vibration.cancel();
        playSound('call_end');
        setTimeout(() => navigation.goBack(), 600);
      }
    });
    return unsub;
  }, [callId, subscribe]);

  /* ---- auto-timeout (40s) ---- */
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!dismissed.current) {
        dismissed.current = true;
        try { await endCall(callId, 'reject'); } catch {}
        stopLooping();
        Vibration.cancel();
        navigation.goBack();
      }
    }, 40000);
    return () => clearTimeout(timeout);
  }, [callId]);

  const handleAccept = async () => {
    if (dismissed.current) return;
    dismissed.current = true;
    stopLooping();
    Vibration.cancel();
    try {
      await joinCall(callId);
      navigation.replace('ActiveCall', {
        callId,
        otherName: callerName,
        callType,
        roomName,
        isOutgoing: false,
        peerUserId: route.params.callerId,
      });
    } catch {
      navigation.goBack();
    }
  };

  const handleReject = async () => {
    if (dismissed.current) return;
    dismissed.current = true;
    stopLooping();
    Vibration.cancel();
    playSound('call_end');
    try { await endCall(callId, 'reject'); } catch {}
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.label}>
          {callType === 'video' ? 'Incoming Video Call' : 'Incoming Voice Call'}
        </Text>
        <Avatar name={callerName} size={100} />
        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.status}>is calling you…</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} activeOpacity={0.7}>
          <Ionicons name="close" size={28} color={Colors.textInverse} />
          <Text style={styles.actionLabel}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.7}>
          <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={28} color={Colors.textInverse} />
          <Text style={styles.actionLabel}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1132',
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  content: { alignItems: 'center', marginTop: 60 },
  label: {
    fontSize: Font.size.sm,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: Spacing.xl,
    ...Font.medium,
  },
  callerName: {
    fontSize: Font.size.xxl,
    color: Colors.textInverse,
    marginTop: Spacing.lg,
    ...Font.bold,
  },
  status: {
    fontSize: Font.size.md,
    color: 'rgba(255,255,255,0.5)',
    marginTop: Spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: Spacing.xl,
  },
  rejectBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: { fontSize: 24, color: Colors.textInverse },
  actionLabel: {
    color: Colors.textInverse,
    fontSize: Font.size.xs,
    marginTop: 8,
    ...Font.medium,
  },
});
