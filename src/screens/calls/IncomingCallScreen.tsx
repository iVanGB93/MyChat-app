import IncomingCallAppearance from './IncomingCallAppearance';
import { useContactName } from '../../hooks/useContactName';
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
import { RTCView } from 'react-native-webrtc';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Spacing } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { joinCall, endCall } from '../../services/callService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { playLooping, stopLooping, playSound } from '../../services/soundService';
import { getRingerModeSync } from '../../services/ringerService';
import { cancelIncomingCallNotification } from '../../services/callNotificationService';
import { markCallEnded } from '../../services/callDedupe';
import { useAppStore } from '../../store/appStore';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import Avatar from '../../components/ui/Avatar';
import {
  discardPrewarmedVideoCallMedia,
  prewarmVideoCallMedia,
} from '../../hooks/useWebRTC';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'IncomingCall'>;

export default function IncomingCallScreen({ route, navigation }: Props) {
  const contactName = useContactName();
  const { callId, callerName: originalName, callType, roomName } = route.params;
  const callerName = contactName(route.params.callerId, originalName);
  const { colors: Colors } = useTheme();
  const { ensure: ensurePermission } = usePermissionPrompt();
  const { subscribe } = useNotificationContext();
  const dismissed = useRef(false);
  const accepted = useRef(false);
  const accepting = useRef(false);
  const [localPreviewUrl, setLocalPreviewUrl] = React.useState<string | null>(null);

  // When the app is launched directly into this screen from a background/killed
  // call (via the full-screen intent / pending-call nav), there is no previous
  // route, so navigation.goBack() throws "GO_BACK was not handled". Fall back to
  // the home route in that case.
  const dismiss = () => {
    markCallEnded(callId);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main' as never);
  };

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

  /* ---- ringtone + vibration (respects silent / vibrate switch) ---- */
  useEffect(() => {
    // Snapshot the mode once when the call comes in; if the user
    // flips the switch mid-ring we don't try to start/stop on the fly.
    const mode = getRingerModeSync();

    // playLooping() internally skips audio when mode !== 'normal', but
    // we still call it so the no-op flow stays uniform.
    playLooping('ringtone');

    // Silent = totally quiet. Otherwise pulse the vibrator on a 2s cycle
    // (matches typical OS ringer cadence).
    let interval: ReturnType<typeof setInterval> | null = null;
    if (mode !== 'silent') {
      interval = setInterval(() => Vibration.vibrate(1000), 2000);
      Vibration.vibrate(1000);
    }

    return () => {
      if (interval) clearInterval(interval);
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
        discardPrewarmedVideoCallMedia();
        stopLooping();
        Vibration.cancel();
        cancelIncomingCallNotification(callId).catch(() => {});
        playSound('call_end');
        setTimeout(() => dismiss(), 600);
      }
    });
    return unsub;
  }, [callId, subscribe]);

  /* ---- auto-timeout (40s) ---- */
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!dismissed.current) {
        dismissed.current = true;
        discardPrewarmedVideoCallMedia();
        try { await endCall(callId, 'reject'); } catch {}
        stopLooping();
        Vibration.cancel();
        cancelIncomingCallNotification(callId).catch(() => {});
        dismiss();
      }
    }, 40000);
    return () => clearTimeout(timeout);
  }, [callId]);

  const handleAccept = async () => {
    if (dismissed.current || accepting.current) return;
    accepting.current = true;
    // Camera (video) / mic are required for the call to work — ask before we
    // join so we don't accept into a broken call. If denied, keep ringing so
    // the user can grant access and retry (or reject).
    let ok = false;
    try {
      ok = await ensurePermission(callType === 'video' ? 'camera+microphone' : 'microphone');
    } finally {
      accepting.current = false;
    }
    // The caller can cancel while Android's permission dialog is open.
    if (!ok || dismissed.current) return;
    dismissed.current = true;
    accepted.current = true;
    stopLooping();
    Vibration.cancel();
    cancelIncomingCallNotification(callId).catch(() => {});
    // Answering ends the "incoming" phase — block any later transport from
    // re-ringing this call while we move to the active screen.
    markCallEnded(callId);
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
      accepted.current = false;
      discardPrewarmedVideoCallMedia();
      dismiss();
    }
  };

  const handleReject = async () => {
    if (dismissed.current) return;
    dismissed.current = true;
    discardPrewarmedVideoCallMedia();
    stopLooping();
    Vibration.cancel();
    cancelIncomingCallNotification(callId).catch(() => {});
    playSound('call_end');
    try { await endCall(callId, 'reject'); } catch {}
    dismiss();
  };

  const isVideo = callType === 'video';

  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    (async () => {
      const allowed = await ensurePermission('camera+microphone');
      if (!allowed || cancelled) return;
      try {
        const stream = await prewarmVideoCallMedia();
        if (!cancelled) setLocalPreviewUrl((stream as any).toURL());
      } catch (err) {
        console.warn('[IncomingCall] camera preview unavailable:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (!accepted.current) discardPrewarmedVideoCallMedia();
    };
  }, [ensurePermission, isVideo]);

  return <IncomingCallAppearance callerName={callerName} isVideo={isVideo} localPreviewUrl={localPreviewUrl} handleAccept={handleAccept} handleReject={handleReject}/>;
}
