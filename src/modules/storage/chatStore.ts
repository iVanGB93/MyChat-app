import AsyncStorage from '@react-native-async-storage/async-storage';
import {supportsChatStorageRecovery,readNativeChatStorage,checkNativeChatWrite} from '../../../modules/axonic-app-update/src';
import {createStorageReadGate} from './storageReadSafety';
const revisions=new Map<string,number>();
const gates=new Map<string,ReturnType<typeof createStorageReadGate>>();
/** Process-local change token: long transfers can refresh permission snapshots
 * after a chat write without rereading the complete ledger for every buffer. */
export const ownChatRevision=(owner:string)=>revisions.get(owner)??0;

/** Own chat data keeps its existing schema/key. Temporary relay custody uses separate stores. */
export function ownChatStore(owner: string) {
  const key = '@axonic_root_chat_v1:' + owner;
  let gate=gates.get(owner);if(!gate){if(gates.size>=8)gates.delete(gates.keys().next().value!);gate=createStorageReadGate();gates.set(owner,gate);}
  return {read: () => gate.read(()=>supportsChatStorageRecovery()?readNativeChatStorage(owner):AsyncStorage.getItem(key)), write: async (raw: string) => {
    await checkNativeChatWrite(owner,new TextEncoder().encode(raw).length);
    await AsyncStorage.setItem(key,raw);gate.invalidate();revisions.set(owner,ownChatRevision(owner)+1);
  }};
}
