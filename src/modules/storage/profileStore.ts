import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Files from 'expo-file-system/legacy';

const key = (account: string) => '@axonic_root_profile_v1:' + account;
export async function readProfileAvatar(account: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key(account));
  return raw ? JSON.parse(raw).avatar ?? null : null;
}
export async function storeProfileAvatar(account: string, source: string, previous: string | null) {
  const directory = Files.documentDirectory + 'root-profiles/';
  await Files.makeDirectoryAsync(directory, {intermediates: true});
  const destination = directory + account.slice(-64) + '-' + Date.now() + '.jpg';
  await Files.copyAsync({from: source, to: destination});
  await AsyncStorage.setItem(key(account), JSON.stringify({version: 1, avatar: destination}));
  if (previous?.startsWith(directory)) await Files.deleteAsync(previous, {idempotent: true}).catch(() => {});
  return destination;
}
