export const MIN_IMAGE_ZOOM = 1;
export const DOUBLE_TAP_IMAGE_ZOOM = 2.5;
export const MAX_IMAGE_ZOOM = 4;

export interface TouchPoint {
  pageX: number;
  pageY: number;
}

export function clampImageZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_IMAGE_ZOOM;
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, value));
}

export function touchDistance(touches: readonly TouchPoint[]): number {
  if (touches.length < 2) return 0;
  return Math.hypot(
    touches[1].pageX - touches[0].pageX,
    touches[1].pageY - touches[0].pageY,
  );
}

/** Keep a zoomed image close enough to the viewport that it cannot get lost. */
export function clampImageTranslation(value: number, zoom: number, viewportSize: number): number {
  const limit = Math.max(0, (clampImageZoom(zoom) - 1) * Math.max(0, viewportSize) / 2);
  return Math.min(limit, Math.max(-limit, value));
}
