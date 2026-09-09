import AsyncStorage from '@react-native-async-storage/async-storage';

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
export type StickerPreferences = { recent: string[]; favorites: string[] };
const key = (owner: number) => `@axonic_stickers:v1:${owner}`;
const validIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && STICKERS.some((s) => s.id === id)))].slice(0, 24) : [];
export async function loadStickerPreferences(owner: number): Promise<StickerPreferences> {
  const raw = await AsyncStorage.getItem(key(owner));
  try {
    const value = JSON.parse(raw || '{}');
    return { recent: validIds(value?.recent), favorites: validIds(value?.favorites) };
  } catch { return { recent: [], favorites: [] }; }
}
let writes: Promise<unknown> = Promise.resolve();
export function updateStickerPreferences(owner: number, id: string, action: 'recent' | 'favorite'): Promise<StickerPreferences> {
  const task = writes.then(async () => {
    if (!owner || !STICKERS.some((s) => s.id === id)) throw new Error('Invalid sticker or account');
    const prefs = await loadStickerPreferences(owner);
    if (action === 'recent') prefs.recent = [id, ...prefs.recent.filter((entry) => entry !== id)].slice(0, 24);
    else prefs.favorites = prefs.favorites.includes(id) ? prefs.favorites.filter((entry) => entry !== id) : [...prefs.favorites, id];
    await AsyncStorage.setItem(key(owner), JSON.stringify(prefs));
    return prefs;
  });
  writes = task.catch(() => {});
  return task;
}
