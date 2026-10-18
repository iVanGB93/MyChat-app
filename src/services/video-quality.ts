export type VideoQualityMode = 'automatic' | 'low' | 'medium' | 'high';

export function videoQualityParameters(mode: VideoQualityMode, level: string, screen?:{width?:number;height?:number}) {
  if(screen){
    // Screen pixels are much larger than the camera's 720p source. Bound the
    // encoded long edge, not a fixed scale factor tied to one phone model.
    const profile=mode==='automatic'?(level==='poor'?'low':level==='good'?'high':'medium'):mode;
    const edge=profile==='low'?960:profile==='medium'?1280:1600;
    const dimensions=[screen.width,screen.height].filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0);
    return {maxBitrate:profile==='low'?350_000:profile==='medium'?800_000:1_500_000,
      maxFramerate:profile==='low'?8:15,
      scaleResolutionDownBy:dimensions.length?Math.max(1,Math.max(...dimensions)/edge):2,
      degradationPreference:'balanced'};
  }
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
