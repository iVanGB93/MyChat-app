import { ActionButton, makeStyles } from './CallAppearance';
import { useContactName } from '../../hooks/useContactName';
/* ------------------------------------------------------------------ */
/*  Active Call Screen — voice / video call with WebRTC                */
/*  Caller: ringing → call_accepted → create offer → connected        */
/*  Callee: media acquired → receives offer → answer → connected      */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AppState, View, Text, StyleSheet, TouchableOpacity, Pressable, Platform, Modal, ScrollView, Alert } from 'react-native';
import { setCallSpeaker, restoreCallAudio } from '../../services/call-audio-route';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VideoQualityMode } from '../../services/video-quality';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useKeepAwake } from 'expo-keep-awake';
import { RTCView } from 'react-native-webrtc';
import { Font, Radius, Spacing } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { endCall, getCallState, setCallVideoQuality } from '../../services/callService';
import { readNewCallQuality } from '../../services/call-quality-state';
import { markCallEnded } from '../../services/callDedupe';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { playSound, stopLooping } from '../../services/soundService';
import {
  setCallPictureInPictureEnabled,
  startForegroundService,
  stopForegroundService,
} from '../../services/foregroundService';
import { useAppStore } from '../../store/appStore';
import { debugLog } from '../../services/diagnostics';
import useWebRTC from '../../hooks/useWebRTC';
import { useCallNavigationGuard } from '../../hooks/use-call-navigation-guard';
import Avatar from '../../components/ui/Avatar';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveCall'>;

export default function ActiveCallScreen({ route, navigation }: Props) {
  const contactName = useContactName();
  const { callId, otherName: originalName, callType, isOutgoing, peerUserId } = route.params;
  const otherName = contactName(peerUserId, originalName);
  const isVideo = callType === 'video';
  const { colors: Colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showOptions, setShowOptions] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const audioRouteBusy = useRef(false);
  useEffect(() => () => restoreCallAudio(), []);
  const toggleSpeaker = async () => {
    if (audioRouteBusy.current) return;
    audioRouteBusy.current = true;
    try { setSpeakerOn(await setCallSpeaker(!speakerOn)); }
    catch (error) { Alert.alert('Could not switch audio', error instanceof Error ? error.message : 'Please try again.'); }
    finally { audioRouteBusy.current = false; }
  };
  const CALLER_RINGBACK_CYCLE_MS = 10_200;

  // Keep the screen on for the entire duration of the call (voice and
  // video). Without this Android dims and locks the screen after the
  // user's normal timeout, which kills the video preview and forces the
  // user to wake the device just to hang up.
  useKeepAwake('axonic-active-call');

  const [seconds, setSeconds] = useState(0);
  // Video is unobstructed once controls are dismissed. A transparent press
  // target beneath the controls makes any unused part of the screen toggle it.
  const [showVideoControls, setShowVideoControls] = useState(true);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const [status, setStatus] = useState<'connecting' | 'ringing' | 'connected' | 'ended'>(
    'connecting',
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringPulseRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offerStartedRef = useRef(false);
  const hasEnded = useRef(false);
  const keepCallVisible = useCallback(() => setShowVideoControls(true), []);
  useCallNavigationGuard(status !== 'ended', keepCallVisible);

  // When launched directly into a call (background/killed), there is no route
  // to go back to — navigation.goBack() would throw "GO_BACK was not handled".
  // Fall back to the home route in that case.
  const dismiss = () => {
    markCallEnded(callId);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main' as never);
  };

  const { subscribe } = useNotificationContext();
  const onPeerConnected = useCallback(() => {
    if (!hasEnded.current) setStatus('connected');
  }, []);
  const onPeerDisconnected = useCallback(() => {
    if (!hasEnded.current) setStatus('connecting');
  }, []);

  /* ---- WebRTC hook ---- */
  const {
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    toggleMute,
    toggleCamera,
    switchCamera,
    callQuality,
    videoQualityMode,
    videoQualityError,
    selectVideoQuality,
    startAsOfferer,
    cleanup: cleanupWebRTC,
  } = useWebRTC({
    callId,
    callType,
    isOutgoing,
    peerUserId,
    onConnected: onPeerConnected,
    onDisconnected: onPeerDisconnected,
  });

  const qualityRevision = useRef(-1);
  const sharedQuality = useRef<VideoQualityMode>('automatic');
  const qualitySaveLock = useRef(false);
  const [qualitySaving, setQualitySaving] = useState(false);
  const [qualityNotice, setQualityNotice] = useState('');
  const acceptQuality = useCallback((data: unknown) => {
    if (hasEnded.current || !isVideo) return;
    const next = readNewCallQuality(data, callId, qualityRevision.current);
    if (!next) return;
    const changed = sharedQuality.current !== next.mode;
    qualityRevision.current = next.revision;
    sharedQuality.current = next.mode;
    selectVideoQuality(next.mode);
    if (changed) setQualityNotice(`Call video quality: ${next.mode.charAt(0).toUpperCase()}${next.mode.slice(1)}`);
  }, [callId, isVideo, selectVideoQuality]);
  useEffect(() => {
    if (!qualityNotice) return;
    const timer = setTimeout(() => setQualityNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [qualityNotice]);
  useEffect(() => {
    let active = true;
    if (isVideo) void getCallState(callId).then((data) => { if (active) acceptQuality(data); }).catch(() => {});
    return () => { active = false; };
  }, [callId, isVideo, acceptQuality]);
  const changeSharedQuality = async (mode: VideoQualityMode) => {
    if (qualitySaveLock.current || hasEnded.current || mode === sharedQuality.current) return;
    qualitySaveLock.current = true;
    setQualitySaving(true);
    try { acceptQuality(await setCallVideoQuality(callId, mode)); }
    catch { if (!hasEnded.current) Alert.alert('Quality not changed', 'Could not update the call setting. Check your connection and try again.'); }
    finally { qualitySaveLock.current = false; if (!hasEnded.current) setQualitySaving(false); }
  };

  /* ---- Start foreground service for the duration of this call ---- */
  useEffect(() => {
    startForegroundService('call', callType);
    return () => { stopForegroundService('call'); };
  }, [callType]);

  /* ---- Android system Picture-in-Picture for connected video calls ---- */
  useEffect(() => {
    if (Platform.OS !== 'android' || !isVideo) return;
    const enabled = status === 'connected';
    setCallPictureInPictureEnabled(enabled);
    return () => { setCallPictureInPictureEnabled(false); };
  }, [isVideo, status]);

  useEffect(() => {
    if (!isVideo) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      setAppIsActive(active);
      // PiP should contain clean video rather than scaled-down call controls.
      setShowVideoControls(active);
    });
    return () => subscription.remove();
  }, [isVideo]);

  /* ---- mirror call into global store on mount + status changes ---- */
  useEffect(() => {
    useAppStore.getState().setActiveCall({
      callId,
      peerId: peerUserId ?? 0,
      peerName: otherName,
      state: 'connecting',
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
      // Dedicated outbound ringback tone (different from incoming ringtone).
      // We intentionally avoid stacked loop+pulse playback to prevent overlap.
      stopLooping();
      playSound('caller_ringback', { ignoreRinger: true }).catch(() => {});
      if (!ringPulseRef.current) {
        ringPulseRef.current = setInterval(() => {
          playSound('caller_ringback', { ignoreRinger: true }).catch(() => {});
        }, CALLER_RINGBACK_CYCLE_MS);
      }
    }
    if (status === 'connected') {
      stopLooping();
      if (ringPulseRef.current) { clearInterval(ringPulseRef.current); ringPulseRef.current = null; }
      playSound('call_connect');
    }
    if (status === 'ended') {
      stopLooping();
      if (ringPulseRef.current) { clearInterval(ringPulseRef.current); ringPulseRef.current = null; }
      playSound('call_end');
    }
    return () => {
      stopLooping();
      if (ringPulseRef.current) { clearInterval(ringPulseRef.current); ringPulseRef.current = null; }
    };
  }, [status, isOutgoing]);

  /* ---- listen for signaling events (filtered by call_id) ---- */
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (hasEnded.current) return;
      const { event, call_id } = payload;
      if (call_id && call_id !== callId) return;

      if (event === 'call_quality_changed') {
        acceptQuality(payload);
      } else if (event === 'call_accepted') {
        debugLog('[ActiveCall] call_accepted → starting WebRTC offer');
        setStatus((previous) => previous === 'connected' ? previous : 'connecting');
        if (!offerStartedRef.current) {
          offerStartedRef.current = true;
          startAsOfferer();
        }
      } else if (event === 'call_ended' || event === 'call_rejected') {
        debugLog('[ActiveCall] call ended/rejected');
        stopLooping();
        if (ringPulseRef.current) { clearInterval(ringPulseRef.current); ringPulseRef.current = null; }
        setStatus('ended');
        hasEnded.current = true;
        cleanupWebRTC();
        setTimeout(() => dismiss(), 1200);
      }
    });
    return unsub;
  }, [callId, subscribe, startAsOfferer, cleanupWebRTC, acceptQuality]);

  /* ---- poll call status as fallback ---- */
  useEffect(() => {
    if (status === 'ended') return;
    const poll = setInterval(async () => {
      if (hasEnded.current) return;
      try {
        const callState = await getCallState(callId);
        const s = callState.status;
        if (hasEnded.current) return;
        acceptQuality(callState);
        if (s === 'ringing' && isOutgoing) {
          setStatus((prev) => (prev === 'connected' || prev === 'ended' ? prev : 'ringing'));
        } else if (s === 'ongoing') {
          setStatus((previous) => previous === 'connected' ? previous : 'connecting');
          if (isOutgoing && !offerStartedRef.current) {
            offerStartedRef.current = true;
            startAsOfferer();
          }
        } else if (s === 'ended' || s === 'rejected' || s === 'missed') {
          stopLooping();
          if (ringPulseRef.current) { clearInterval(ringPulseRef.current); ringPulseRef.current = null; }
          setStatus('ended');
          hasEnded.current = true;
          cleanupWebRTC();
          setTimeout(() => dismiss(), 1200);
        }
      } catch { /* ignore */ }
    // Both peers reconcile occasionally, including during connected calls, so
    // an end event missed during a socket outage cannot strand the callee.
    }, status === 'connected' || !isOutgoing ? 15000 : 1200);
    return () => clearInterval(poll);
  }, [isOutgoing, status, callId, startAsOfferer, cleanupWebRTC, acceptQuality]);

  /* ---- auto-timeout for outgoing calls (45s) ---- */
  useEffect(() => {
    if (!isOutgoing || status !== 'ringing') return;
    const timeout = setTimeout(async () => {
      if (status === 'ringing' && !hasEnded.current) {
        try { await endCall(callId); } catch {}
        setStatus('ended');
        hasEnded.current = true;
        cleanupWebRTC();
        setTimeout(() => dismiss(), 1200);
      }
    }, 45000);
    return () => clearTimeout(timeout);
  }, [isOutgoing, status, callId, cleanupWebRTC]);

  /* ---- call timer ---- */
  useEffect(() => {
    if (status !== 'connecting') return;
    const timeout = setTimeout(() => {
      if (hasEnded.current) return;
      hasEnded.current = true;
      setStatus('ended');
      cleanupWebRTC();
      void endCall(callId).catch(() => {});
      setTimeout(() => dismiss(), 1200);
    }, 45000);
    return () => clearTimeout(timeout);
  }, [status, callId, cleanupWebRTC]);

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
    stopLooping();
    if (ringPulseRef.current) { clearInterval(ringPulseRef.current); ringPulseRef.current = null; }
    setStatus('ended');
    cleanupWebRTC();
    // Stop camera/microphone immediately, even if the server is unreachable.
    void endCall(callId).catch(() => {});
    setTimeout(() => dismiss(), 800);
  };

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
      {!!qualityNotice && <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, alignSelf: 'center', zIndex: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 12 }}><Text accessibilityLiveRegion="polite" style={{ color: Colors.text }}>{qualityNotice}</Text></View>}
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

      {isVideo && (showRemoteFullscreen || showLocalFullscreen) && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setShowVideoControls((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={showVideoControls ? 'Hide call controls' : 'Show call controls'}
        />
      )}

      {/* PIP local preview only when remote is fullscreen */}
      {showRemoteFullscreen && localStreamUrl && appIsActive && (
        <View style={styles.pipWrap} pointerEvents="none">
          <RTCView
            streamURL={localStreamUrl}
            style={[styles.pip, { borderRadius: Radius.lg, overflow: 'hidden' }]}
            objectFit="cover"
            mirror={true}
            zOrder={1}
          />
        </View>
      )}

      {/* ---- Overlay: top info + actions ---- */}
      {(!isVideo || showVideoControls) && (
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.top}>
          {!isVideo && (
            <View style={[styles.typePill, { borderColor: Colors.neonBorder }] }>
              <Ionicons
                name="call-outline"
                size={14}
                color={Colors.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.typePillText, { color: Colors.primary }] }>
                VOICE CALL
              </Text>
            </View>
          )}

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
          {isVideo && callQuality.level !== 'unknown' && (
            <Text
              style={[
                styles.quality,
                {
                  color: callQuality.level === 'good'
                    ? Colors.success
                    : callQuality.level === 'fair'
                    ? Colors.warning
                    : Colors.error,
                },
              ]}
            >
              {callQuality.level.toUpperCase()}
              {callQuality.roundTripTimeMs != null ? ` • ${callQuality.roundTripTimeMs} ms` : ''}
              {callQuality.packetLossPercent != null ? ` • ${callQuality.packetLossPercent}% loss` : ''}
            </Text>
          )}
        </View>

        {/* ---- Action buttons ---- */}
        <View style={[styles.actions, isVideo && { paddingHorizontal: 8 }]}>
          <ActionButton
            size={isVideo ? 52 : 64}
            icon={isMuted ? 'mic-off' : 'mic'}
            label={isMuted ? 'Unmute' : 'Mute'}
            active={isMuted}
            onPress={toggleMute}
            Colors={Colors}
          />

          {isVideo && (
            <ActionButton
              size={52}
              icon={isCameraOff ? 'videocam-off' : 'videocam'}
              label={isCameraOff ? 'Cam On' : 'Cam Off'}
              active={isCameraOff}
              onPress={toggleCamera}
              Colors={Colors}
            />
          )}

          <TouchableOpacity
            testID="axonic-end-call"
            accessibilityLabel="End call"
            style={[styles.endBtn, isVideo && { width: 64, height: 64, borderRadius: 32 }]}
            onPress={handleEndCall}
            activeOpacity={0.8}
          >
            <Ionicons
              name="call"
              size={28}
              color="#fff"
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </TouchableOpacity>

          {isVideo && (
            <ActionButton
              size={52}
              icon="camera-reverse-outline"
              label="Flip"
              onPress={switchCamera}
              Colors={Colors}
            />
          )}

          {isVideo && (
            <ActionButton
              size={52}
              testID="axonic-call-options"
              icon="options-outline"
              label="Options"
              onPress={() => setShowOptions(true)}
              Colors={Colors}
            />
          )}

          {!isVideo && (
            <ActionButton
              icon="volume-high-outline"
              label="Speaker"
              active={speakerOn}
              onPress={() => void toggleSpeaker()}
              Colors={Colors}
            />
          )}
        </View>
      </View>
      )}
      <Modal visible={showOptions && isVideo && status !== 'ended'} transparent animationType="slide" onRequestClose={() => setShowOptions(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <Pressable accessibilityLabel="Close call options" onPress={() => setShowOptions(false)} style={StyleSheet.absoluteFill} />
          <View style={{ backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Math.max(insets.bottom, 16) + 12, maxHeight: '85%' }}>
            <ScrollView>
              <Text style={{ color: Colors.text, fontSize: 22, ...Font.medium }}>Video quality</Text>
              <Text style={{ color: Colors.text, opacity: 0.7, marginVertical: 12 }}>Shared by everyone in this call. Automatic adapts to each device’s connection.</Text>
              {qualitySaving && <Text style={{ color: Colors.primary }}>Updating call quality…</Text>}
              {([
                ['automatic', 'Automatic', 'Adjusts to your connection · Default'],
                ['low', 'Low', 'Uses less data · Lower detail and frame rate'],
                ['medium', 'Medium', 'Balances detail and data use'],
                ['high', 'High', 'Best detail · Uses more data'],
              ] as [VideoQualityMode, string, string][]).map(([mode, label, detail]) => (
                <TouchableOpacity key={mode} testID={`axonic-video-quality-${mode}`} disabled={qualitySaving} accessibilityRole="radio" accessibilityState={{ checked: videoQualityMode === mode, disabled: qualitySaving }} onPress={() => void changeSharedQuality(mode)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
                  <Ionicons name={videoQualityMode === mode ? 'radio-button-on' : 'radio-button-off'} size={24} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.text, fontSize: 17 }}>{label}</Text>
                    <Text style={{ color: Colors.text, opacity: 0.7, marginTop: 4 }}>{detail}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {videoQualityError && <Text accessibilityRole="alert" style={{ color: Colors.text, marginVertical: 8 }}>{videoQualityError}</Text>}
              <TouchableOpacity accessibilityRole="button" onPress={() => setShowOptions(false)} style={{ alignItems: 'center', padding: 14, backgroundColor: Colors.primary, borderRadius: 16, marginTop: 12 }}>
                <Text style={{ color: '#020413', ...Font.medium }}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
