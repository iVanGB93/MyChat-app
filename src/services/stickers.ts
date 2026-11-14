import AsyncStorage from '@react-native-async-storage/async-storage';

import { STICKERS } from './identity/stickerProtocol';
export { STICKERS, stickerMessage, parseSticker, type Sticker } from './identity/stickerProtocol';
export type StickerPreferences = { recent: string[]; favorites: string[] };
export type StickerOwner = number | string;
export function stickerOwnerKey(owner: StickerOwner): string {
 if (typeof owner === 'number' && Number.isSafeInteger(owner) && owner > 0) return String(owner);
 if (typeof owner === 'string' && /^axonic:1:[a-f0-9]{64}$/.test(owner)) return 'root-' + owner.slice(9);
 throw new Error('Invalid sticker account');
}
const key = (owner: StickerOwner) => `@axonic_stickers:v1:${stickerOwnerKey(owner)}`;
const validIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && STICKERS.some((s) => s.id === id)))].slice(0, 24) : [];
export async function loadStickerPreferences(owner: StickerOwner): Promise<StickerPreferences> {
  const raw = await AsyncStorage.getItem(key(owner));
  try {
    const value = JSON.parse(raw || '{}');
    return { recent: validIds(value?.recent), favorites: validIds(value?.favorites) };
  } catch { return { recent: [], favorites: [] }; }
}
let writes: Promise<unknown> = Promise.resolve();
export function updateStickerPreferences(owner: StickerOwner, id: string, action: 'recent' | 'favorite'): Promise<StickerPreferences> {
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
