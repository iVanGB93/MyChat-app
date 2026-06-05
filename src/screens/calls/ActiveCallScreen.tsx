/* ------------------------------------------------------------------ */
/*  Active Call Screen — voice / video call with WebRTC                */
/*  Caller: ringing → call_accepted → create offer → connected        */
/*  Callee: media acquired → receives offer → answer → connected      */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useKeepAwake } from 'expo-keep-awake';
import { RTCView } from 'react-native-webrtc';
import { Font, Radius, Spacing } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { endCall, getCallStatus } from '../../services/callService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { playSound, playLooping, stopLooping } from '../../services/soundService';
import { useAppStore } from '../../store/appStore';
import useWebRTC from '../../hooks/useWebRTC';
import Avatar from '../../components/ui/Avatar';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveCall'>;

export default function ActiveCallScreen({ route, navigation }: Props) {
  const { callId, otherName, callType, isOutgoing, peerUserId } = route.params;
  const { colors: Colors } = useTheme();

  // Keep the screen on for the entire duration of the call (voice and
  // video). Without this Android dims and locks the screen after the
  // user's normal timeout, which kills the video preview and forces the
  // user to wake the device just to hang up.
  useKeepAwake('axonic-active-call');

  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'ringing' | 'connected' | 'ended'>(
    isOutgoing ? 'ringing' : 'connected',
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasEnded = useRef(false);

  const { subscribe } = useNotificationContext();

  /* ---- WebRTC hook ---- */
  const {
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    toggleMute,
    toggleCamera,
    switchCamera,
    startAsOfferer,
    cleanup: cleanupWebRTC,
  } = useWebRTC({
    callId,
    callType,
    isOutgoing,
    peerUserId,
    onConnected: () => {
      console.log('[ActiveCall] WebRTC peer connected');
    },
    onDisconnected: () => {
      console.log('[ActiveCall] WebRTC peer disconnected');
    },
  });

  /* ---- mirror call into global store on mount + status changes ---- */
  useEffect(() => {
    useAppStore.getState().setActiveCall({
      callId,
      peerId: peerUserId ?? 0,
      peerName: otherName,
      state: isOutgoing ? 'ringing' : 'connected',
      callType,
    });
    return () => {
      const cur = useAppStore.getState().activeCall;
      if (cur && cur.callId === callId) {
        useAppStore.getState().setActiveCall(null);
      }
    };
  }, [callId, otherName, callType, isOutgoing, peerUserId]);

  useEffect(() => {
    const mapped: 'ringing' | 'connecting' | 'connected' | 'ended' =
      status === 'ringing' ? 'ringing'
      : status === 'connecting' ? 'connecting'
      : status === 'connected' ? 'connected'
      : 'ended';
    useAppStore.getState().updateActiveCallState(mapped);
  }, [status]);

  /* ---- play ringback for outgoing calls ---- */
  useEffect(() => {
    if (isOutgoing && status === 'ringing') {
      playLooping('ringback');
    }
    if (status === 'connected') {
      stopLooping();
      playSound('call_connect');
    }
    if (status === 'ended') {
      stopLooping();
      playSound('call_end');
    }
    return () => { stopLooping(); };
  }, [status]);

  /* ---- listen for signaling events (filtered by call_id) ---- */
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (hasEnded.current) return;
      const { event, call_id } = payload;
      if (call_id && call_id !== callId) return;

      if (event === 'call_accepted') {
        console.log('[ActiveCall] call_accepted → starting WebRTC offer');
        setStatus('connected');
        startAsOfferer();
      } else if (event === 'call_ended' || event === 'call_rejected') {
        console.log('[ActiveCall] call ended/rejected');
        setStatus('ended');
        hasEnded.current = true;
        cleanupWebRTC();
        setTimeout(() => navigation.goBack(), 1200);
      }
    });
    return unsub;
  }, [callId, subscribe, startAsOfferer, cleanupWebRTC]);

  /* ---- poll call status as fallback ---- */
  useEffect(() => {
    if (!isOutgoing || status !== 'ringing') return;
    const poll = setInterval(async () => {
      if (hasEnded.current) return;
      try {
        const s = await getCallStatus(callId);
        if (s === 'ongoing' && status === 'ringing') {
          setStatus('connected');
          startAsOfferer();
        } else if (s === 'ended' || s === 'rejected' || s === 'missed') {
          setStatus('ended');
          hasEnded.current = true;
          cleanupWebRTC();
          setTimeout(() => navigation.goBack(), 1200);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(poll);
  }, [isOutgoing, status, callId, startAsOfferer, cleanupWebRTC]);

  /* ---- auto-timeout for outgoing calls (45s) ---- */
  useEffect(() => {
    if (!isOutgoing || status !== 'ringing') return;
    const timeout = setTimeout(async () => {
      if (status === 'ringing' && !hasEnded.current) {
        try { await endCall(callId); } catch {}
        setStatus('ended');
        hasEnded.current = true;
        cleanupWebRTC();
        setTimeout(() => navigation.goBack(), 1200);
      }
    }, 45000);
    return () => clearTimeout(timeout);
  }, [isOutgoing, status, callId, cleanupWebRTC]);

  /* ---- call timer ---- */
  useEffect(() => {
    if (status === 'connected') {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const handleEndCall = async () => {
    if (hasEnded.current) return;
    hasEnded.current = true;
    try { await endCall(callId); } catch {}
    cleanupWebRTC();
    setStatus('ended');
    setTimeout(() => navigation.goBack(), 800);
  };

  const isVideo = callType === 'video';
  const remoteStreamUrl = remoteStream ? (remoteStream as any).toURL() : null;
  const localStreamUrl = localStream ? (localStream as any).toURL() : null;

  /** While ringing on a video call show the local preview full-screen so the
   *  caller can frame themselves before the other side answers. Once
   *  connected we swap to the remote stream and shrink the local one. */
  const showLocalFullscreen = isVideo && !remoteStreamUrl && !!localStreamUrl;
  const showRemoteFullscreen = isVideo && !!remoteStreamUrl;
  const showOverlayAvatar = !isVideo || (!remoteStreamUrl && !localStreamUrl);

  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  return (
    <View style={styles.container}>
      {/* ---- Video background ---- */}
      {showRemoteFullscreen && (
        <RTCView
          streamURL={remoteStreamUrl!}
          style={styles.fullVideo}
          objectFit="cover"
          zOrder={0}
        />
      )}
      {showLocalFullscreen && (
        <RTCView
          streamURL={localStreamUrl!}
          style={styles.fullVideo}
          objectFit="cover"
          mirror={true}
          zOrder={0}
        />
      )}

      {/* PIP local preview only when remote is fullscreen */}
      {showRemoteFullscreen && localStreamUrl && (
        <View style={styles.pipWrap} pointerEvents="none">
          <RTCView
            streamURL={localStreamUrl}
            style={styles.pip}
            objectFit="cover"
            mirror={true}
            zOrder={1}
          />
        </View>
      )}

      {/* Scrim for legibility over any video */}
      {(showRemoteFullscreen || showLocalFullscreen) && (
        <View pointerEvents="none" style={styles.scrim} />
      )}

      {/* ---- Overlay: top info + actions ---- */}
      <View style={styles.overlay}>
        <View style={styles.top}>
          <View style={[styles.typePill, { borderColor: Colors.neonBorder }]}>
            <Ionicons
              name={isVideo ? 'videocam-outline' : 'call-outline'}
              size={14}
              color={Colors.primary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.typePillText, { color: Colors.primary }]}>
              {isVideo ? 'VIDEO CALL' : 'VOICE CALL'}
            </Text>
          </View>

          {showOverlayAvatar && (
            <View style={styles.avatarWrap}>
              <Avatar name={otherName} size={120} />
            </View>
          )}

          <Text style={styles.name}>{otherName}</Text>
          <Text
            style={[
              styles.status,
              status === 'connected' && { color: Colors.success },
              status === 'ended' && { color: Colors.error },
            ]}
          >
            {status === 'connecting'
              ? 'Connecting…'
              : status === 'ringing'
              ? 'Ringing…'
              : status === 'ended'
              ? 'Call ended'
              : formatTime(seconds)}
          </Text>
        </View>

        {/* ---- Action buttons ---- */}
        <View style={styles.actions}>
          <ActionButton
            icon={isMuted ? 'mic-off' : 'mic'}
            label={isMuted ? 'Unmute' : 'Mute'}
            active={isMuted}
            onPress={toggleMute}
            Colors={Colors}
          />

          {isVideo && (
            <ActionButton
              icon={isCameraOff ? 'videocam-off' : 'videocam'}
              label={isCameraOff ? 'Cam On' : 'Cam Off'}
              active={isCameraOff}
              onPress={toggleCamera}
              Colors={Colors}
            />
          )}

          <TouchableOpacity style={styles.endBtn} onPress={handleEndCall} activeOpacity={0.8}>
            <Ionicons
              name="call"
              size={28}
              color="#fff"
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </TouchableOpacity>

          {isVideo && (
            <ActionButton
              icon="camera-reverse-outline"
              label="Flip"
              onPress={switchCamera}
              Colors={Colors}
            />
          )}

          {!isVideo && (
            <ActionButton
              icon="volume-high-outline"
              label="Speaker"
              onPress={() => {}}
              Colors={Colors}
            />
          )}
        </View>
      </View>
    </View>
  );
}

/* -------------------- helpers -------------------- */

function ActionButton({
  icon,
  label,
  active,
  onPress,
  Colors,
}: {
  icon: any;
  label: string;
  active?: boolean;
  onPress: () => void;
  Colors: any;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: active ? Colors.primary : Colors.neonBorder,
          backgroundColor: active ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.06)',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.primary,
          shadowOpacity: active ? 0.5 : 0.2,
          shadowRadius: active ? 10 : 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: active ? 5 : 2,
        }}
      >
        <Ionicons name={icon} size={22} color={active ? Colors.primary : '#fff'} />
      </View>
      <Text style={{ color: '#fff', fontSize: Font.size.xs, marginTop: 6, opacity: 0.85, ...Font.medium }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* -------------------- styles -------------------- */

function makeStyles(Colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#020413',
    },
    fullVideo: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(2,13,31,0.45)',
    },
    pipWrap: {
      position: 'absolute',
      top: Platform.OS === 'ios' ? 60 : 40,
      right: Spacing.md,
      width: 110,
      height: 150,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: Colors.neonBorder,
      shadowColor: Colors.primary,
      shadowOpacity: 0.45,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      overflow: 'hidden',
      zIndex: 5,
    },
    pip: {
      flex: 1,
      backgroundColor: '#000',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
      paddingTop: Platform.OS === 'ios' ? 70 : 50,
      paddingBottom: Platform.OS === 'ios' ? 50 : 32,
    },
    top: { alignItems: 'center' },
    typePill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    typePillText: {
      fontSize: 11,
      ...Font.bold,
      letterSpacing: 1.5,
    },
    avatarWrap: {
      marginTop: Spacing.xl,
      padding: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: Colors.neonBorder,
      shadowColor: Colors.primary,
      shadowOpacity: 0.5,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    name: {
      color: '#fff',
      fontSize: Font.size.xxl,
      marginTop: Spacing.lg,
      ...Font.bold,
      letterSpacing: 0.5,
    },
    status: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: Font.size.md,
      marginTop: Spacing.xs,
      ...Font.medium,
      letterSpacing: 1,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      paddingHorizontal: Spacing.lg,
    },
    endBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: Colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.error,
      shadowOpacity: 0.7,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
  });
}
