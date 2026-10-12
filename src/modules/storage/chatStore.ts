import AsyncStorage from '@react-native-async-storage/async-storage';
const revisions=new Map<string,number>();
/** Process-local change token: long transfers can refresh permission snapshots
 * after a chat write without rereading the complete ledger for every buffer. */
export const ownChatRevision=(owner:string)=>revisions.get(owner)??0;

/** Own chat data keeps its existing schema/key. Temporary relay custody uses separate stores. */
export function ownChatStore(owner: string) {
  const key = '@axonic_root_chat_v1:' + owner;
  return {read: () => AsyncStorage.getItem(key), write: async (raw: string) => {
    await AsyncStorage.setItem(key,raw);revisions.set(owner,ownChatRevision(owner)+1);
  }};
}
