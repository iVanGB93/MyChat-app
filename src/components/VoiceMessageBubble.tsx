/* ------------------------------------------------------------------ */
/*  VoiceMessageBubble                                                   */
/*                                                                       */
/*  Renders a play/pause button + duration label + thin progress bar     */
/*  for a single voice message. Uses expo-audio's useAudioPlayer hook    */
/*  so the player is bound to this component's lifecycle and disposed    */
/*  on unmount.                                                          */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { Spacing, Radius, Font } from '../theme';
import {
  audioPositionFromTrack,
  clampAudioPosition,
  nextVoicePlaybackRate,
  type VoicePlaybackRate,
} from '../utils/audio-seek';

interface Props {
  /** Local file URI (file://...) of the voice clip. */
  fileUri: string | null | undefined;
  /** Duration in milliseconds. Used as a fallback when the player hasn't loaded yet. */
  durationMs: number | null | undefined;
  /** True while the audio bytes are still being downloaded (chunked transfer). */
  loading?: boolean;
  /** Render the play icon and progress in this color (e.g. inverse for sent bubbles). */
  tint: string;
  /** Render the duration text in this color. */
  subtleColor: string;
  /** Track background color. */
  trackBg: string;
}

function fmtTime(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VoiceMessageBubble({
  fileUri,
  durationMs,
  loading,
  tint,
  subtleColor,
  trackBg,
}: Props) {
  const player = useAudioPlayer(fileUri || null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const trackWidth = useRef(0);
  const seekPreviewRef = useRef<number | null>(null);
  const [seekPreviewMs, setSeekPreviewMs] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState<VoicePlaybackRate>(1);

  // Ensure audio routes to the speaker (not call earpiece) when playing
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    }).catch(() => {});
  }, []);

  const isPlaying = !!status?.playing;
  // expo-audio status reports seconds; convert to ms for display.
  const curMs = (status?.currentTime ?? 0) * 1000;
  const totalMs = (status?.duration && status.duration > 0
    ? status.duration * 1000
    : durationMs) || 0;
  const displayedMs = seekPreviewMs ?? curMs;
  const progress = totalMs > 0 ? Math.min(1, displayedMs / totalMs) : 0;

  const onToggle = () => {
    if (!fileUri) return;
    if (isPlaying) {
      player.pause();
    } else {
      // Restart from the beginning if it had finished playing
      if (status?.didJustFinish || (totalMs > 0 && curMs >= totalMs - 50)) {
        player.seekTo(0).then(() => player.play()).catch(() => player.play());
      } else {
        player.play();
      }
    }
  };

  // Stop playback if the file disappears (e.g. message deleted)
  useEffect(() => {
    if (!fileUri && isPlaying) {
      try { player.pause(); } catch {}
    }
  }, [fileUri, isPlaying, player]);

  useEffect(() => {
    seekPreviewRef.current = null;
    setSeekPreviewMs(null);
    setPlaybackRate(1);
    try { player.setPlaybackRate(1, 'high'); } catch {}
  }, [fileUri]);

  const disabled = !fileUri;

  const previewSeek = useCallback((locationX: number) => {
    if (disabled || totalMs <= 0) return;
    const nextMs = audioPositionFromTrack(locationX, trackWidth.current, totalMs);
    seekPreviewRef.current = nextMs;
    setSeekPreviewMs(nextMs);
  }, [disabled, totalMs]);

  const commitSeek = useCallback((positionMs: number) => {
    if (disabled || totalMs <= 0) return;
    const nextMs = clampAudioPosition(positionMs, totalMs);
    seekPreviewRef.current = null;
    setSeekPreviewMs(null);
    player.seekTo(nextMs / 1000).catch(() => {});
  }, [disabled, player, totalMs]);

  const seekFromTap = useCallback((locationX: number) => {
    const nextMs = audioPositionFromTrack(locationX, trackWidth.current, totalMs);
    commitSeek(nextMs);
  }, [commitSeek, totalMs]);

  const seekPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => (
      !disabled && totalMs > 0 && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2)
    ),
    onPanResponderGrant: (event) => previewSeek(event.nativeEvent.locationX),
    onPanResponderMove: (event) => previewSeek(event.nativeEvent.locationX),
    onPanResponderRelease: () => {
      const nextMs = seekPreviewRef.current;
      if (nextMs != null) commitSeek(nextMs);
    },
    onPanResponderTerminate: () => {
      const nextMs = seekPreviewRef.current;
      if (nextMs != null) commitSeek(nextMs);
    },
    onPanResponderTerminationRequest: () => false,
  }), [commitSeek, disabled, previewSeek, totalMs]);

  const accessibilitySeek = useCallback((direction: 'forward' | 'backward') => {
    const deltaMs = direction === 'forward' ? 5_000 : -5_000;
    commitSeek(displayedMs + deltaMs);
  }, [commitSeek, displayedMs]);

  const cyclePlaybackRate = useCallback(() => {
    if (disabled) return;
    const nextRate = nextVoicePlaybackRate(playbackRate);
    try {
      player.setPlaybackRate(nextRate, 'high');
      setPlaybackRate(nextRate);
    } catch {}
  }, [disabled, playbackRate, player]);

  // Audio hasn't arrived yet (still downloading over chunked transfer).
  if (loading && !fileUri) {
    return (
      <View style={styles.container}>
        <View
          style={[
            styles.playBtn,
            { borderColor: tint, backgroundColor: tint + '22', opacity: 0.6 },
          ]}
        >
          <ActivityIndicator size="small" color={tint} />
        </View>
        <View style={styles.right}>
          <View style={[styles.track, { backgroundColor: trackBg }]} />
          <Text style={[styles.duration, { color: subtleColor }]}>Receiving…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        disabled={disabled}
        style={[
          styles.playBtn,
          { borderColor: tint, backgroundColor: tint + '22' },
          disabled && { opacity: 0.4 },
        ]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={18}
          color={tint}
        />
      </TouchableOpacity>
      <View style={styles.right}>
        <View
          style={styles.seekTouchArea}
          onLayout={(event) => { trackWidth.current = event.nativeEvent.layout.width; }}
          {...seekPanResponder.panHandlers}
        >
          <Pressable
            style={styles.seekPressable}
            onPress={(event) => seekFromTap(event.nativeEvent.locationX)}
            disabled={disabled || totalMs <= 0}
            accessibilityRole="adjustable"
            accessibilityLabel="Voice message playback position"
            accessibilityHint="Tap or drag to seek. Swipe up or down to move five seconds."
            accessibilityValue={{
              min: 0,
              max: Math.max(0, Math.round(totalMs / 1000)),
              now: Math.max(0, Math.round(displayedMs / 1000)),
              text: `${fmtTime(displayedMs)} of ${fmtTime(totalMs)}`,
            }}
            accessibilityActions={[
              { name: 'increment', label: 'Forward five seconds' },
              { name: 'decrement', label: 'Back five seconds' },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') accessibilitySeek('forward');
              if (event.nativeEvent.actionName === 'decrement') accessibilitySeek('backward');
            }}
          >
            <View style={[styles.track, { backgroundColor: trackBg }]}>
              <View
                style={[
                  styles.trackFill,
                  { width: `${progress * 100}%`, backgroundColor: tint },
                ]}
              />
              <View
                style={[
                  styles.seekThumb,
                  {
                    left: `${progress * 100}%`,
                    backgroundColor: tint,
                    transform: [{ scale: seekPreviewMs != null ? 1.25 : 1 }],
                  },
                ]}
              />
            </View>
          </Pressable>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.duration, { color: subtleColor }]}>
            {disabled ? '— : —' : `${fmtTime(displayedMs)} / ${fmtTime(totalMs)}`}
          </Text>
          <TouchableOpacity
            onPress={cyclePlaybackRate}
            activeOpacity={0.7}
            disabled={disabled}
            style={[
              styles.speedButton,
              { borderColor: tint + '66', backgroundColor: tint + '18' },
              disabled && { opacity: 0.4 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Playback speed ${playbackRate} times`}
            accessibilityHint="Cycles between normal, one and a half, and double speed"
          >
            <Text style={[styles.speedText, { color: tint }]}>{playbackRate}×</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 180,
    paddingVertical: 2,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  right: {
    flex: 1,
  },
  seekTouchArea: {
    height: 28,
    justifyContent: 'center',
  },
  seekPressable: {
    height: '100%',
    justifyContent: 'center',
  },
  track: {
    height: 6,
    borderRadius: Radius.sm,
  },
  trackFill: {
    height: '100%',
    borderRadius: Radius.sm,
  },
  seekThumb: {
    position: 'absolute',
    top: -3,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
  },
  duration: {
    fontSize: Font.size.xs,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  speedButton: {
    minWidth: 38,
    height: 24,
    paddingHorizontal: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
