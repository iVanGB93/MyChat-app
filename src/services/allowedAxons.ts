import AsyncStorage from '@react-native-async-storage/async-storage';
const key = '@axonic_allowed_axons_v1';
let value = 5, loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
export const allowedAxons = () => value;
export const subscribeAllowedAxons = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const loadAllowedAxons = () => loading ??= AsyncStorage.getItem(key).then(raw => {
  const saved = Number(raw); if (Number.isInteger(saved) && saved >= 3 && saved <= 10) { value = saved; listeners.forEach(fn => fn()); }
}).catch(error => { loading = undefined; throw error; });
export async function setAllowedAxons(next: number) {
  if (!Number.isInteger(next) || next < 3 || next > 10) throw Error('Choose between 3 and 10 axons.');
  await loadAllowedAxons(); await AsyncStorage.setItem(key, String(next)); value = next; listeners.forEach(fn => fn());
}
