import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { MAX_STICKER_BYTES, validateStickerFile } from './sticker-file-format';

export type ImportedSticker = { id: string; name: string; favorite?: boolean; lastSentAt?: number; format?: 'png' | 'webp' | 'gif' };
export function importedStickerMime(sticker: ImportedSticker): string {
  return `image/${sticker.format === 'gif' || sticker.format === 'webp' ? sticker.format : 'png'}`;
}
export async function stickerFileMime(uri: string): Promise<string> {
  return `image/${validateStickerFile(await new File(uri).bytes())}`;
}
const key = (owner: number) => `@axonic_imported_stickers:v1:${owner}`;
function directory(owner: number) {
  if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('Sign in to import stickers.');
  return new Directory(Paths.document, 'stickers', String(owner));
}
export function importedStickerUri(owner: number, sticker: ImportedSticker): string {
  if (!/^[a-f0-9]{32}$/.test(sticker.id)) throw new Error('Invalid sticker.');
  const extension = sticker.format === 'webp' || sticker.format === 'gif' ? sticker.format : 'png';
  return new File(directory(owner), `${sticker.id}.${extension}`).uri;
}
export async function loadImportedStickers(owner: number): Promise<ImportedSticker[]> {
  const raw = await AsyncStorage.getItem(key(owner));
  try {
    const rows = JSON.parse(raw || '[]');
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && /^[a-f0-9]{32}$/.test(r.id) && typeof r.name === 'string').slice(0, 100) : [];
  } catch { return []; }
}
let writes: Promise<unknown> = Promise.resolve();
export function markImportedStickerSent(owner: number, id: string): Promise<void> {
  const task = writes.then(async () => {
    const rows = await loadImportedStickers(owner);
    await AsyncStorage.setItem(key(owner), JSON.stringify(rows.map((s) => s.id === id ? { ...s, lastSentAt: Date.now() } : s)));
  });
  writes = task.catch(() => {});
  return task;
}
export async function isImportedStickerFavorite(owner: number, uri: string): Promise<boolean> {
  const file = new File(uri);
  if (!file.exists) return false;
  const id = file.md5;
  return (await loadImportedStickers(owner)).some((sticker) => sticker.id === id && sticker.favorite === true);
}

export function importSticker(owner: number, uri: string, name: string, favorite = false): Promise<ImportedSticker[]> {
  const task = writes.then(async () => {
    const source = new File(uri);
    if (!source.exists || source.size <= 0 || source.size > MAX_STICKER_BYTES) throw new Error('Choose a readable image no larger than 2 MB.');
    const format = validateStickerFile(await source.bytes());
    const { width, height } = await Image.getSize(uri);
    if (!width || !height || width > 2048 || height > 2048) throw new Error('Sticker dimensions must be at most 2048 × 2048.');
    const normalized = format !== 'png' ? { uri } : await manipulateAsync(uri, Math.max(width, height) > 512 ? [{ resize: width >= height ? { width: 512 } : { height: 512 } }] : [], { format: SaveFormat.PNG });
    const file = new File(normalized.uri);
    try {
      if (file.size > MAX_STICKER_BYTES) throw new Error('This sticker is too large after preparation.');
      const id = file.md5;
      if (!id || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Could not identify this sticker.');
      const rows = await loadImportedStickers(owner);
      const exists = rows.some((s) => s.id === id);
      if (!exists && rows.length >= 100) throw new Error('Your collection is full (100 stickers). Remove one before importing more.');
      const dir = directory(owner);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const dest = new File(dir, `${id}.${format}`);
      const created = !dest.exists;
      if (created) file.copy(dest);
      const updated = exists ? rows.map((s) => s.id === id && favorite ? { ...s, favorite: true } : s) : [...rows, { id, name: name.slice(0, 80) || 'Imported sticker', favorite, format }];
      try { await AsyncStorage.setItem(key(owner), JSON.stringify(updated)); }
      catch (error) { if (created && dest.exists) dest.delete(); throw error; }
      return updated;
    } finally { if (file.uri !== source.uri && file.exists) file.delete(); }
  });
  writes = task.catch(() => {});
  return task;
}
export function removeImportedSticker(owner: number, sticker: ImportedSticker): Promise<ImportedSticker[]> {
  const task = writes.then(async () => {
    const previous = await loadImportedStickers(owner);
    const rows = previous.filter((s) => s.id !== sticker.id);
    const file = new File(importedStickerUri(owner, sticker));
    await AsyncStorage.setItem(key(owner), JSON.stringify(rows));
    try { if (file.exists) file.delete(); }
    catch (error) { await AsyncStorage.setItem(key(owner), JSON.stringify(previous)); throw error; }
    return rows;
  });
  writes = task.catch(() => {});
  return task;
}
