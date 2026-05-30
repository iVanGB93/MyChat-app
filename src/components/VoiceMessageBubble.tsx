/* ------------------------------------------------------------------ */
/*  VoiceMessageBubble                                                   */
/*                                                                       */
/*  Renders a play/pause button + duration label + thin progress bar     */
/*  for a single voice message. Uses expo-audio's useAudioPlayer hook    */
/*  so the player is bound to this component's lifecycle and disposed    */
/*  on unmount.                                                          */
/* ------------------------------------------------------------------ */

import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

import { useTheme } from '../contexts/ThemeContext';
import { Spacing, Radius, Font } from '../theme';

interface Props {
  /** Local file URI (file://...) of the voice clip. */
  fileUri: string | null | undefined;
  /** Duration in milliseconds. Used as a fallback when the player hasn't loaded yet. */
  durationMs: number | null | undefined;
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
  tint,
  subtleColor,
  trackBg,
}: Props) {
  const { Colors } = useTheme();
  const player = useAudioPlayer(fileUri || null);
  const status = useAudioPlayerStatus(player);

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
  const progress = totalMs > 0 ? Math.min(1, curMs / totalMs) : 0;
  const remaining = isPlaying ? Math.max(0, totalMs - curMs) : totalMs;

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

  const disabled = !fileUri;

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
        <View style={[styles.track, { backgroundColor: trackBg }]}>
          <View
            style={[
              styles.trackFill,
              { width: `${progress * 100}%`, backgroundColor: tint },
            ]}
          />
        </View>
        <Text style={[styles.duration, { color: subtleColor }]}>
          {disabled ? '— : —' : fmtTime(remaining)}
        </Text>
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
  track: {
    height: 4,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: Radius.sm,
  },
  duration: {
    marginTop: 4,
    fontSize: Font.size.xs,
    letterSpacing: 0.3,
  },
});
