/** Shared account-scoped metadata refresh; SQLite remains the screen's source. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { BASE_URL } from './api';
import { useAppStore } from '../store/appStore';

type Resource = 'rooms' | 'contacts' | 'calls';
const inFlight = new Map<string, Promise<any[]>>();
const generations = new Map<string, number>();
const invalidated = new Set<string>();
const TTL_MS = 2 * 60_000;

export function invalidateCollection(resource: Resource): void {
  const owner = useAppStore.getState().user?.id;
  if (owner == null) return;
  const key = `${owner}:${resource}`;
  generations.set(key, (generations.get(key) ?? 0) + 1);
  invalidated.add(key);
}

/** Follow every legacy page; never replace a complete local list with page one. */
export async function fetchCollectionPages<T>(url: string): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let next: string | null = url;
  while (next) {
    if (seen.has(next)) throw new Error('Repeated collection page.');
    if (/^https?:/i.test(next) && !next.startsWith(`${BASE_URL}/`)) throw new Error('Untrusted pagination URL.');
    seen.add(next);
    const response: { data: any } = await api.get(next);
    const data = response.data;
    if (Array.isArray(data)) return [...rows, ...data];
    if (!Array.isArray(data?.results)) throw new Error('Invalid collection response.');
    rows.push(...data.results);
    next = typeof data.next === 'string' && data.next ? data.next : null;
  }
  return rows;
}

export async function refreshCollection<T>(options: {
  resource: Resource;
  syncUrl: string;
  legacyUrl: string;
  id: (row: T) => string;
  read: (owner: number) => Promise<T[]>;
  save: (owner: number, rows: T[]) => Promise<void>;
  force?: boolean;
  preserveHistory?: boolean;
}): Promise<T[]> {
  const owner = useAppStore.getState().user?.id;
  if (owner == null) return fetchCollectionPages<T>(options.legacyUrl);
  const key = `${owner}:${options.resource}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const generation = generations.get(key) ?? 0;
  const stateKey = `@axonic_collection_v1:${key}`;
  const work = (async () => {
    const cached = await options.read(owner);
    let previous: { checkedAt?: number; versions?: Record<string, string> } = {};
    try { previous = JSON.parse(await AsyncStorage.getItem(stateKey) ?? '{}'); } catch {}
    // Missing/pruned local rows must be requested even if an old hash exists.
    const localIds = new Set(cached.map(options.id));
    const known = previous.versions ?? {};
    const versions = options.preserveHistory
      ? Object.fromEntries(Object.entries(known).filter(([id]) => localIds.has(id)))
      : Object.fromEntries([...localIds].map((id) => [id, known[id] ?? '']));
    if (!options.force && !invalidated.has(key) && previous.checkedAt
        && Object.keys(known).every((id) => localIds.has(id))
        && (options.preserveHistory || [...localIds].every((id) => id in known))
        && Date.now() - previous.checkedAt < TTL_MS) return cached;
    let rows: T[], nextVersions: Record<string, string> = {};
    let changed = true;
    try {
      const { data } = await api.post(options.syncUrl, { versions });
      if (!Array.isArray(data?.upserts) || !Array.isArray(data?.removed_ids) || !data?.versions) {
        throw new Error('Invalid metadata delta.');
      }
      const merged = new Map(cached.map((row) => [options.id(row), row]));
      changed = data.upserts.length > 0 || (!options.preserveHistory
        && data.removed_ids.some((id: unknown) => merged.has(String(id))));
      // Server retention must not erase call history saved on the phone.
      if (!options.preserveHistory) for (const id of data.removed_ids) merged.delete(String(id));
      for (const row of data.upserts as T[]) merged.set(options.id(row), row);
      rows = [...merged.values()];
      nextVersions = data.versions;
    } catch (error: any) {
      if (![404, 405].includes(error?.response?.status)) throw error;
      const fetched = await fetchCollectionPages<T>(options.legacyUrl);
      rows = options.preserveHistory
        ? [...new Map([...cached, ...fetched].map((row) => [options.id(row), row])).values()]
        : fetched;
    }
    if (useAppStore.getState().user?.id !== owner) throw new Error('Account changed during metadata refresh.');
    if ((generations.get(key) ?? 0) !== generation) {
      // Do not overwrite a mutation that raced this snapshot. The invalidation
      // remains set, forcing a repair on the next caller.
      return options.read(owner);
    }
    if (changed) await options.save(owner, rows);
    await AsyncStorage.setItem(stateKey, JSON.stringify({ checkedAt: Date.now(), versions: nextVersions }));
    if ((generations.get(key) ?? 0) === generation) invalidated.delete(key);
    if (useAppStore.getState().user?.id !== owner) throw new Error('Account changed during metadata refresh.');
    return options.read(owner);
  })();
  inFlight.set(key, work);
  try { return await work; } finally {
    if (inFlight.get(key) === work) inFlight.delete(key);
  }
}
