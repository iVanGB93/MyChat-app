/* ------------------------------------------------------------------ */
/*  Incoming Call Screen — full screen alert for incoming calls        */
/*  Plays ringtone, vibrates, uses shared NotificationContext          */
/*  Cyberpunk style: pulsing neon ring + animated scan glow            */
/* ------------------------------------------------------------------ */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Radius, Spacing } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { joinCall, endCall } from '../../services/callService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { playLooping, stopLooping, playSound } from '../../services/soundService';
import { cancelIncomingCallNotification } from '../../services/callNotificationService';
import { useAppStore } from '../../store/appStore';
import Avatar from '../../components/ui/Avatar';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'IncomingCall'>;

export default function IncomingCallScreen({ route, navigation }: Props) {
  const { callId, callerName, callType, roomName } = route.params;
  const { colors: Colors } = useTheme();
  const { subscribe } = useNotificationContext();
  const dismissed = useRef(false);

  // Pulsing scale for the avatar ring + the "scan" radial sweep.
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
    Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, [pulse, sweep]);

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
        dismissed.current = true;
        stopLooping();
        Vibration.cancel();
        cancelIncomingCallNotification(callId).catch(() => {});
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
        cancelIncomingCallNotification(callId).catch(() => {});
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
    cancelIncomingCallNotification(callId).catch(() => {});
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
    cancelIncomingCallNotification(callId).catch(() => {});
    playSound('call_end');
    try { await endCall(callId, 'reject'); } catch {}
    navigation.goBack();
  };

  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const isVideo = callType === 'video';

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const ring2Scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] });
  const ring2Opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });
  const sweepRotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.container}>
      {/* Background grid glow */}
      <View pointerEvents="none" style={styles.bgGlowTop} />
      <View pointerEvents="none" style={styles.bgGlowBottom} />

      <View style={styles.content}>
        <View style={[styles.typePill, { borderColor: Colors.neonBorder }]}>
          <Ionicons
            name={isVideo ? 'videocam-outline' : 'call-outline'}
            size={14}
            color={Colors.primary}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.typePillText, { color: Colors.primary }]}>
            INCOMING {isVideo ? 'VIDEO' : 'VOICE'} CALL
          </Text>
        </View>

        {/* Pulsing rings around avatar */}
        <View style={styles.avatarStack}>
          <Animated.View
            style={[
              styles.pulseRing,
              { borderColor: Colors.primary, opacity: ring2Opacity, transform: [{ scale: ring2Scale }] },
            ]}
          />
          <Animated.View
            style={[
              styles.pulseRing,
              { borderColor: Colors.primary, opacity: ringOpacity, transform: [{ scale: ringScale }] },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sweep,
              { borderColor: Colors.primary, transform: [{ rotate: sweepRotate }] },
            ]}
          />
          <View style={styles.avatarWrap}>
            <Avatar name={callerName} size={140} />
          </View>
        </View>

        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={[styles.status, { color: Colors.textSecondary }]}>is calling you…</Text>
      </View>

      <View style={styles.actions}>
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} activeOpacity={0.85}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.btnLabel}>Decline</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.85}>
            <Ionicons name={isVideo ? 'videocam' : 'call'} size={28} color="#021015" />
          </TouchableOpacity>
          <Text style={styles.btnLabel}>Accept</Text>
        </View>
      </View>
    </View>
  );
}

/* -------------------- styles -------------------- */

function makeStyles(Colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#020413',
      justifyContent: 'space-between',
      paddingTop: Platform.OS === 'ios' ? 80 : 60,
      paddingBottom: Platform.OS === 'ios' ? 60 : 40,
    },
    bgGlowTop: {
      position: 'absolute',
      top: -160,
      left: -80,
      width: 360,
      height: 360,
      borderRadius: 180,
      backgroundColor: Colors.primary,
      opacity: 0.08,
    },
    bgGlowBottom: {
      position: 'absolute',
      bottom: -180,
      right: -100,
      width: 380,
      height: 380,
      borderRadius: 190,
      backgroundColor: Colors.accent,
      opacity: 0.07,
    },

    content: { alignItems: 'center' },
    typePill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.35)',
      marginBottom: Spacing.xl,
    },
    typePillText: {
      fontSize: 11,
      letterSpacing: 1.5,
      ...Font.bold,
    },

    avatarStack: {
      width: 200,
      height: 200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarWrap: {
      padding: 4,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: Colors.primary,
      shadowColor: Colors.primary,
      shadowOpacity: 0.8,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
    pulseRing: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
      borderWidth: 2,
    },
    sweep: {
      position: 'absolute',
      width: 196,
      height: 196,
      borderRadius: 98,
      borderWidth: 1,
      borderColor: 'transparent',
      borderTopColor: Colors.primary,
      opacity: 0.6,
    },

    callerName: {
      fontSize: Font.size.xxl,
      color: '#fff',
      marginTop: Spacing.xl,
      letterSpacing: 0.5,
      ...Font.bold,
    },
    status: {
      fontSize: Font.size.md,
      marginTop: Spacing.xs,
      letterSpacing: 0.5,
    },

    actions: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      paddingHorizontal: Spacing.xl,
    },
    rejectBtn: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: Colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.error,
      shadowOpacity: 0.7,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
    acceptBtn: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: Colors.success,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.success,
      shadowOpacity: 0.8,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 9,
    },
    btnLabel: {
      color: '#fff',
      fontSize: Font.size.xs,
      marginTop: 8,
      opacity: 0.85,
      letterSpacing: 1,
      ...Font.medium,
    },
  });
}
