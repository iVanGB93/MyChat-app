/* ------------------------------------------------------------------ */
/*  Active Call Screen — voice / video call with WebRTC                */
/*  Caller: ringing → call_accepted → create offer → connected        */
/*  Callee: media acquired → receives offer → answer → connected      */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RTCView } from 'react-native-webrtc';
import { Colors, Font, Spacing } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { endCall, getCallStatus } from '../../services/callService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { playSound, playLooping, stopLooping } from '../../services/soundService';
import useWebRTC from '../../hooks/useWebRTC';
import Avatar from '../../components/ui/Avatar';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveCall'>;

export default function ActiveCallScreen({ route, navigation }: Props) {
  const { callId, otherName, callType, isOutgoing, peerUserId } = route.params;

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

      // Only react to events for THIS call
      if (call_id && call_id !== callId) return;

      if (event === 'call_accepted') {
        console.log('[ActiveCall] call_accepted → starting WebRTC offer');
        setStatus('connected');
        // Caller creates the WebRTC offer after call is accepted
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

  /* ---- poll call status as fallback (in case WS event was missed) ---- */
  useEffect(() => {
    if (!isOutgoing || status !== 'ringing') return;
    const poll = setInterval(async () => {
      if (hasEnded.current) return;
      try {
        const s = await getCallStatus(callId);
        console.log('[ActiveCall] poll status:', s);
        if (s === 'ongoing' && status === 'ringing') {
          console.log('[ActiveCall] poll: accepted → starting WebRTC offer');
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

  return (
    <View style={styles.container}>
      {/* ---- Video views ---- */}
      {isVideo && remoteStreamUrl ? (
        <RTCView
          streamURL={remoteStreamUrl}
          style={styles.remoteVideo}
          objectFit="cover"
          zOrder={0}
        />
      ) : null}

      {isVideo && localStreamUrl ? (
        <RTCView
          streamURL={localStreamUrl}
          style={styles.localVideo}
          objectFit="cover"
          mirror={true}
          zOrder={1}
        />
      ) : null}

      {/* ---- Overlay: top info ---- */}
      <View style={[styles.overlay, isVideo && remoteStreamUrl ? styles.overlayTransparent : null]}>
        <View style={styles.top}>
          <Text style={styles.callType}>
            {isVideo ? 'Video Call' : 'Voice Call'}
          </Text>
          {(!isVideo || !remoteStreamUrl) && (
            <Avatar name={otherName} size={100} />
          )}
          <Text style={styles.name}>{otherName}</Text>
          <Text style={styles.status}>
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
          <TouchableOpacity
            style={[styles.actionBtn, isMuted && styles.activeBtn]}
            onPress={toggleMute}
            activeOpacity={0.7}
          >
            <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={22} color={Colors.textInverse} />
            <Text style={styles.actionLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </TouchableOpacity>

          {isVideo && (
            <TouchableOpacity
              style={[styles.actionBtn, isCameraOff && styles.activeBtn]}
              onPress={toggleCamera}
              activeOpacity={0.7}
            >
              <Ionicons name={isCameraOff ? 'videocam-off' : 'videocam'} size={22} color={Colors.textInverse} />
              <Text style={styles.actionLabel}>{isCameraOff ? 'Cam On' : 'Cam Off'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.endBtn} onPress={handleEndCall} activeOpacity={0.7}>
            <Ionicons name="call" size={28} color={Colors.textInverse} style={{ transform: [{ rotate: '135deg' }] }} />
            <Text style={styles.actionLabel}>End</Text>
          </TouchableOpacity>

          {isVideo && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={switchCamera}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-reverse-outline" size={22} color={Colors.textInverse} />
              <Text style={styles.actionLabel}>Flip</Text>
            </TouchableOpacity>
          )}

          {!isVideo && (
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="volume-high-outline" size={22} color={Colors.textInverse} />
              <Text style={styles.actionLabel}>Speaker</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1132',
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  localVideo: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#333',
    zIndex: 2,
    elevation: 5,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  overlayTransparent: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  top: { alignItems: 'center', marginTop: 50 },
  callType: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: Font.size.sm,
    marginBottom: Spacing.xl,
    ...Font.medium,
  },
  name: {
    color: Colors.textInverse,
    fontSize: Font.size.xxl,
    marginTop: Spacing.lg,
    ...Font.bold,
  },
  status: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: Font.size.md,
    marginTop: Spacing.sm,
    ...Font.medium,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: Spacing.lg,
    paddingBottom: 20,
  },
  actionBtn: {
    alignItems: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  activeBtn: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  endBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: { fontSize: 22, color: Colors.textInverse },
  actionLabel: {
    color: Colors.textInverse,
    fontSize: Font.size.xs,
    marginTop: 4,
  },
});
