export function clampAudioPosition(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (!Number.isFinite(positionMs)) return 0;
  return Math.min(durationMs, Math.max(0, positionMs));
}

/** Convert a tap/drag position on the progress track into a playback time. */
export function audioPositionFromTrack(
  locationX: number,
  trackWidth: number,
  durationMs: number,
): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, locationX / trackWidth));
  return clampAudioPosition(fraction * durationMs, durationMs);
}

export const VOICE_PLAYBACK_RATES = [1, 1.5, 2] as const;
export type VoicePlaybackRate = (typeof VOICE_PLAYBACK_RATES)[number];

/** Return the next supported voice-message speed, wrapping back to normal speed. */
export function nextVoicePlaybackRate(currentRate: number): VoicePlaybackRate {
  const currentIndex = VOICE_PLAYBACK_RATES.findIndex((rate) => rate === currentRate);
  if (currentIndex < 0) return 1;
  return VOICE_PLAYBACK_RATES[(currentIndex + 1) % VOICE_PLAYBACK_RATES.length];
}
