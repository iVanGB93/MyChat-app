/** Three columns, with 16px outer padding and two 12px gaps. */
export function stickerGridCellWidth(containerWidth: number): number {
  return Math.max(1, Math.floor((containerWidth - 32 - 24) / 3));
}
