import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { useAppStore } from '../store/appStore';

type Entry = { callId: string; action: 'end' | 'reject' };
const memory = new Map<number, Map<string, Entry>>();
const loaded = new Set<number>();
let tail: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let delay = 2000;
const owner = () => useAppStore.getState().user?.id;
const key = (id: number) => `@axonic_call_end_queue:${id}`;
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.catch(() => {});
  return result;
}
function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flushPendingCallEnds();
  }, delay);
  delay = Math.min(delay * 2, 60000);
}
async function queueFor(id: number) {
  if (!loaded.has(id)) {
    const raw = await AsyncStorage.getItem(key(id));
    const entries: Entry[] = raw ? JSON.parse(raw) : [];
    memory.set(id, new Map([...entries.map((entry) => [entry.callId, entry] as const), ...(memory.get(id) ?? [])]));
    loaded.add(id);
  }
  return memory.get(id)!;
}
async function flush(id: number, queue: Map<string, Entry>) {
  // Persist before HTTP so process death cannot lose the user's hang-up.
  await AsyncStorage.setItem(key(id), JSON.stringify([...queue.values()]));
  for (const [callId, entry] of queue) {
    if (owner() !== id) return;
    try {
      await api.post(`/api/calls/${callId}/end/`, { action: entry.action }, { timeout: 8000 });
      queue.delete(callId);
    } catch (error: any) {
      if (error?.response?.status === 404 || error?.response?.status === 403) queue.delete(callId);
      else { schedule(); break; }
    }
    await AsyncStorage.setItem(key(id), JSON.stringify([...queue.values()]));
  }
  if (!queue.size) delay = 2000;
}
export function flushPendingCallEnds(): Promise<void> {
  return serialized(async () => {
    const id = owner();
    if (!id) return;
    try { await flush(id, await queueFor(id)); }
    catch { console.warn('[CallEnd] Unable to persist or flush hang-ups; retrying'); schedule(); }
  });
}
export function requestCallEnd(callId: string, action: 'end' | 'reject'): Promise<{ status: string }> {
  return serialized(async () => {
    const id = owner();
    if (!id) throw new Error('Sign in to end the call');
    let queue = memory.get(id) ?? new Map<string, Entry>();
    memory.set(id, queue);
    if (!queue.has(callId)) queue.set(callId, { callId, action });
    try { queue = await queueFor(id); await flush(id, queue); }
    catch {
      console.warn('[CallEnd] Hang-up retained in memory; durable storage unavailable');
      // Still try immediately; keep the in-memory entry for later persistence.
      try { await api.post(`/api/calls/${callId}/end/`, { action }, { timeout: 8000 }); } catch {}
      schedule();
    }
    return { status: queue.has(callId) ? 'queued' : action === 'reject' ? 'rejected' : 'ended' };
  });
}
