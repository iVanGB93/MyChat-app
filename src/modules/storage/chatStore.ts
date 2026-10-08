import AsyncStorage from '@react-native-async-storage/async-storage';

/** Own chat data keeps its existing schema/key. Temporary relay custody uses separate stores. */
export function ownChatStore(owner: string) {
  const key = '@axonic_root_chat_v1:' + owner;
  return {read: () => AsyncStorage.getItem(key), write: (raw: string) => AsyncStorage.setItem(key, raw)};
}
