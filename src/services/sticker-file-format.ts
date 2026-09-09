export const IMPORTED_STICKER_CONTENT = 'Sticker [axonic-sticker:import:v1]';
export const MAX_STICKER_BYTES = 2 * 1024 * 1024;
/** Inspect real container chunks, not filenames; reject animation rather than silently flattening it. */
export function validateStickerFile(bytes: Uint8Array): 'png' | 'webp' {
  if (!bytes.length || bytes.length > MAX_STICKER_BYTES) throw new Error('Each sticker must be no larger than 2 MB.');
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && (bytes[offset + 8] & 2))) throw new Error('Animated stickers are not supported yet. Choose a static image.');
      if (kind === 'VP8 ' || kind === 'VP8L') image = true;
      offset += 8 + length + (length % 2);
    }
    if (image) return 'webp';
  }
  throw new Error('Choose a static PNG or WebP image.');
}
