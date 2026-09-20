export type VideoQualityMode = 'automatic' | 'low' | 'medium' | 'high';

export function videoQualityParameters(mode: VideoQualityMode, level: string) {
  const maxBitrate = mode === 'low' ? 300_000 : mode === 'medium' ? 800_000
    : mode === 'high' ? 2_500_000
    : level === 'poor' ? 500_000 : level === 'fair' ? 1_200_000 : 2_500_000;
  return {
    maxBitrate,
    maxFramerate: mode === 'low' ? 15 : mode === 'medium' ? 24 : 30,
    scaleResolutionDownBy: mode === 'low' ? 3 : mode === 'medium' ? 2 : 1,
    degradationPreference: maxBitrate === 2_500_000 ? 'maintain-resolution' : 'balanced',
  };
}
