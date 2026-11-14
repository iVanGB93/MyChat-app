// Immutable versioned ids: never reuse an id for different artwork.
export const STICKERS = [
  { id: 'hello', label: 'Hello!', emoji: '👋', mood: 'happy' },
  { id: 'love', label: 'Love it', emoji: '🩵', mood: 'love' },
  { id: 'laugh', label: 'Too funny', emoji: '😂', mood: 'laugh' },
  { id: 'wow', label: 'Wow!', emoji: '😮', mood: 'wow' },
  { id: 'thanks', label: 'Thank you', emoji: '🙏', mood: 'happy' },
  { id: 'yes', label: 'You got it', emoji: '👍', mood: 'happy' },
  { id: 'sad', label: 'Oh no', emoji: '😢', mood: 'sad' },
  { id: 'party', label: 'Let’s celebrate', emoji: '🎉', mood: 'laugh' },
] as const;
export type Sticker = typeof STICKERS[number];
export function stickerMessage(sticker: Sticker): string {
  return `${sticker.emoji} ${sticker.label} [axonic-sticker:v1:${sticker.id}]`;
}
export function parseSticker(content: string): Sticker | undefined {
  return STICKERS.find((sticker) => stickerMessage(sticker) === content);
}
export const IMPORTED_STICKER_CONTENT = 'Sticker [axonic-sticker:import:v1]';

export function identifySticker(text: string, attachment?: {name: string; mime: string}) {
  if (attachment) return attachment.name === IMPORTED_STICKER_CONTENT && ['image/png', 'image/webp', 'image/gif'].includes(attachment.mime)
    ? {kind: 'custom' as const} : undefined;
  const sticker = parseSticker(text);
  return sticker && {kind: 'built-in' as const, id: sticker.id, label: sticker.label, emoji: sticker.emoji};
}
