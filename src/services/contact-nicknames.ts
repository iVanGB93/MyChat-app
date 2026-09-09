import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

type Names = Record<string, string>;
const key = (ownerId: number) => `@axonic_contact_nicknames:${ownerId}`;
const empty: Names = {};
export const useNicknameStore = create<{ byOwner: Record<string, Names> }>(() => ({ byOwner: {} }));
let writes: Promise<unknown> = Promise.resolve();

export async function loadContactNicknames(ownerId: number): Promise<Names> {
  const cached = useNicknameStore.getState().byOwner[ownerId];
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(key(ownerId));
  let names: Names = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    names = Object.fromEntries(Object.entries(parsed).filter(([id, name]) => /^\d+$/.test(id) && typeof name === 'string')) as Names;
  } catch { /* A malformed local entry must not prevent opening contacts. */ }
  useNicknameStore.setState((state) => ({ byOwner: { ...state.byOwner, [ownerId]: state.byOwner[ownerId] ?? names } }));
  return useNicknameStore.getState().byOwner[ownerId];
}

/** Scoped to both the signed-in account and the contact's stable numeric id. */
export function saveContactNickname(ownerId: number, contactId: number, value: string): Promise<void> {
  const task = writes.then(async () => {
    if (!ownerId || !contactId) throw new Error('Sign in before editing a nickname.');
    const names = { ...await loadContactNicknames(ownerId) };
    const nickname = value.trim().slice(0, 50);
    if (nickname) names[contactId] = nickname;
    else delete names[contactId];
    await AsyncStorage.setItem(key(ownerId), JSON.stringify(names));
    useNicknameStore.setState((state) => ({ byOwner: { ...state.byOwner, [ownerId]: names } }));
  });
  writes = task.catch(() => {});
  return task;
}

export function resolveContactName(names: Names, contactId: number | undefined, fallback: string, username?: string): string {
  const nickname = contactId ? names[contactId] : undefined;
  return nickname ? (username ? `${nickname} - ${username}` : nickname) : fallback;
}

export function namesForOwner(ownerId: number | undefined): Names {
  return ownerId ? useNicknameStore.getState().byOwner[ownerId] ?? empty : empty;
}

/** Headless notification tasks do not mount React or the auth context. */
export async function notificationContactName(contactId: number | undefined, fallback: string): Promise<string> {
  try {
    const user = JSON.parse(await AsyncStorage.getItem('@axonic_user_cache') || 'null');
    if (!user?.id) return fallback;
    const names = await loadContactNicknames(user.id);
    return resolveContactName(names, contactId, fallback);
  } catch { return fallback; }
}
