/* ------------------------------------------------------------------ */
/*  IncomingCallBanner                                                  */
/*                                                                      */
/*  Shown when a second incoming call arrives while another call is     */
/*  already in progress. Renders a top banner with Accept / Decline.    */
/*                                                                      */
/*  - Accept asks the user (via ConfirmContext) to confirm hanging up   */
/*    the current call before switching to the new one.                 */
/*  - Decline rejects the new call and dismisses the banner.            */
/*  - Auto-dismisses if the caller cancels (call_ended / call_rejected) */
/*    or after a 40s timeout.                                           */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from './appStore';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useTheme } from '../contexts/ThemeContext';
import { endCall, joinCall } from '../services/callService';
import { playSound } from '../services/soundService';
import { cancelIncomingCallNotification } from '../services/callNotificationService';
import { navigationRef } from '../navigation/AppNavigator';

const AUTO_TIMEOUT_MS = 40_000;

export function IncomingCallBanner() {
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const incoming = useAppStore((s) => s.incomingCall);
  const setIncomingCall = useAppStore((s) => s.setIncomingCall);
  const { subscribe } = useNotificationContext();
  const { confirm } = useConfirm();

  const slide = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);

  // Slide in / out animation
  useEffect(() => {
    Animated.timing(slide, {
      toValue: incoming ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [incoming, slide]);

  // Short vibration ping + soft sound when a new prompt appears.
  // (No looping ringtone — that would compete with the active-call audio.)
  useEffect(() => {
    if (!incoming) return;
    busy.current = false;
    try { Vibration.vibrate([0, 250, 200, 250]); } catch { /* ignore */ }
    playSound('message_received');
    return () => { try { Vibration.cancel(); } catch { /* ignore */ } };
  }, [incoming?.callId]);

  // Auto-dismiss if the caller cancels.
  useEffect(() => {
    if (!incoming) return;
    const unsub = subscribe((payload) => {
      if (!payload?.call_id || payload.call_id !== incoming.callId) return;
      if (payload.event === 'call_ended' || payload.event === 'call_rejected') {
        setIncomingCall(null);
      }
    });
    return unsub;
  }, [incoming?.callId, subscribe, setIncomingCall]);

  // 40-second auto-reject if the user doesn't act.
  useEffect(() => {
    if (!incoming) return;
    const id = setTimeout(() => {
      if (!incoming) return;
      void endCall(incoming.callId, 'reject').catch(() => {});
      setIncomingCall(null);
    }, AUTO_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [incoming?.callId, setIncomingCall]);

  if (!incoming) return null;

  const handleDecline = async () => {
    if (busy.current) return;
    busy.current = true;
    const { callId } = incoming;
    setIncomingCall(null);
    cancelIncomingCallNotification(callId).catch(() => {});
    try { await endCall(callId, 'reject'); } catch { /* ignore */ }
  };

  const handleAccept = () => {
    if (busy.current) return;
    confirm({
      title: 'End current call?',
      message: `Answering ${incoming.callerName} will hang up your active call.`,
      icon: 'call-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End & Answer',
          style: 'destructive',
          onPress: async () => {
            if (busy.current) return;
            busy.current = true;
            const prompt = incoming;
            const current = useAppStore.getState().activeCall;

            // 1) End the active call (best-effort).
            if (current) {
              try { await endCall(current.callId, 'end'); } catch { /* ignore */ }
              useAppStore.getState().setActiveCall(null);
            }

            // 2) Join the new one and navigate.
            try {
              await joinCall(prompt.callId);
            } catch { /* ignore — still try to navigate */ }

            setIncomingCall(null);
            cancelIncomingCallNotification(prompt.callId).catch(() => {});

            if (navigationRef.isReady()) {
              navigationRef.navigate('ActiveCall', {
                callId: prompt.callId,
                otherName: prompt.callerName,
                callType: prompt.callType,
                roomName: prompt.roomName,
                isOutgoing: false,
                peerUserId: prompt.callerId,
              });
            }
          },
        },
      ],
    });
  };

  const isVideo = incoming.callType === 'video';

  return (
    <Animated.View
      pointerEvents={incoming ? 'auto' : 'none'}
      style={[
        styles.wrapper,
        {
          top: insets.top + 60, // sit just below the ActiveCallBanner
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) },
          ],
        },
      ]}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.primary },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: Colors.surfaceVariant, borderColor: Colors.primary }]}>
          <Ionicons name={isVideo ? 'videocam' : 'call'} size={22} color={Colors.primary} />
        </View>

        <View style={styles.textWrap}>
          <Text style={[styles.title, { color: Colors.text }]} numberOfLines={1}>
            {incoming.callerName}
          </Text>
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Incoming {isVideo ? 'video' : 'voice'} call
          </Text>
        </View>

        <TouchableOpacity
          accessibilityLabel="Decline call"
          onPress={handleDecline}
          style={[styles.btn, { backgroundColor: Colors.error }]}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityLabel="Accept call"
          onPress={handleAccept}
          style={[styles.btn, { backgroundColor: Colors.success ?? '#10B981' }]}
          activeOpacity={0.85}
        >
          <Ionicons name={isVideo ? 'videocam' : 'call'} size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9998,
    elevation: 9998,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  textWrap: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontWeight: '700',
    fontSize: 14,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});
