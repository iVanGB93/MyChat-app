import AsyncStorage from '@react-native-async-storage/async-storage';

const cache = new Map<string, string>();
let writes: Promise<unknown> = Promise.resolve();
const keyFor = (ownerId: number, roomId: string) => `@axonic_draft:${ownerId}:${roomId}`;

export async function loadChatDraft(ownerId: number, roomId: string): Promise<string> {
  const key = keyFor(ownerId, roomId);
  if (cache.has(key)) return cache.get(key)!;
  const stored = await AsyncStorage.getItem(key);
  // A user may have typed while storage was loading.
  if (!cache.has(key)) cache.set(key, stored ?? '');
  return cache.get(key)!;
}

export function saveChatDraft(ownerId: number, roomId: string, text: string): Promise<void> {
  const key = keyFor(ownerId, roomId);
  cache.set(key, text);
  const task = writes.then(() => text
    ? AsyncStorage.setItem(key, text)
    : AsyncStorage.removeItem(key));
  writes = task.catch(() => {});
  return task;
}
