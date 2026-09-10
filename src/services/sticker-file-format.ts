export const IMPORTED_STICKER_CONTENT = 'Sticker [axonic-sticker:import:v1]';
export const MAX_STICKER_BYTES = 2 * 1024 * 1024;
/** Inspect real container chunks, not filenames. GIF/WebP are kept intact. */
export function validateStickerFile(bytes: Uint8Array): 'png' | 'webp' | 'gif' {
  if (!bytes.length || bytes.length > MAX_STICKER_BYTES) throw new Error('Each sticker must be no larger than 2 MB.');
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...bytes.slice(0, 6));
  if (bytes.length >= 14 && (signature === 'GIF87a' || signature === 'GIF89a')) {
    const width = view.getUint16(6, true), height = view.getUint16(8, true);
    if (!width || !height || width > 2048 || height > 2048) throw new Error('Sticker dimensions must be at most 2048 × 2048.');
    if (bytes[bytes.length - 1] !== 0x3b) throw new Error('Incomplete GIF file.');
    return 'gif';
  }
  if (bytes.length >= 33 && bytes[0] === 137 && tag(1) === 'PNG\r' && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    if (tag(12) !== 'IHDR') throw new Error('Invalid PNG file.');
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > 2048 || height > 2048) throw new Error('Sticker dimensions must be at most 2048 × 2048.');
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (offset + 12 + length > bytes.length) throw new Error('Incomplete PNG file.');
      if (tag(offset + 4) === 'acTL') throw new Error('Animated stickers are not supported yet. Choose a static image.');
      if (tag(offset + 4) === 'IEND') return 'png';
      offset += 12 + length;
    }
    throw new Error('Incomplete PNG file.');
  }
  if (bytes.length >= 20 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end !== bytes.length) throw new Error('Incomplete WebP file.');
    let image = false;
    for (let offset = 12; offset + 8 <= end;) {
      const length = view.getUint32(offset + 4, true), kind = tag(offset);
      if (offset + 8 + length > end) throw new Error('Incomplete WebP file.');
      if (kind === 'VP8X') {
        if (length !== 10) throw new Error('Invalid WebP header.');
        const width = 1 + bytes[offset + 12] + (bytes[offset + 13] << 8) + (bytes[offset + 14] << 16);
        const height = 1 + bytes[offset + 15] + (bytes[offset + 16] << 8) + (bytes[offset + 17] << 16);
        if (width > 2048 || height > 2048) throw new Error('Sticker dimensions must be at most 2048 × 2048.');
      }
      if (kind === 'VP8 ' || kind === 'VP8L' || (kind === 'ANMF' && length >= 16)) image = true;
      offset += 8 + length + (length % 2);
    }
    if (image) return 'webp';
  }
  throw new Error('Choose a PNG, GIF or WebP image.');
}
