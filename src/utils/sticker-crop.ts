export type StickerCrop = { originX: number; originY: number; width: number; height: number };

/** Convert a normalized square selection to an in-bounds integer pixel crop. */
export function stickerCrop(width: number, height: number, x: number, y: number, fraction: number): StickerCrop {
  const side = Math.max(1, Math.floor(Math.min(width, height) * Math.max(.15, Math.min(1, fraction))));
  return {
    originX: Math.max(0, Math.min(width - side, Math.round(x * width - side / 2))),
    originY: Math.max(0, Math.min(height - side, Math.round(y * height - side / 2))),
    width: side,
    height: side,
  };
}
