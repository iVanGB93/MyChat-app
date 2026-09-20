import type { VideoQualityMode } from './video-quality';

export function readNewCallQuality(value: any, callId: string, revision: number): { mode: VideoQualityMode; revision: number } | null {
  if (value?.call_id !== callId || !Number.isSafeInteger(value.quality_revision)
    || value.quality_revision < 0 || value.quality_revision <= revision
    || !['automatic', 'low', 'medium', 'high'].includes(value.video_quality)) return null;
  return { mode: value.video_quality, revision: value.quality_revision };
}
