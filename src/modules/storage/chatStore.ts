import {indexedChatEnabled,indexedChatStore} from './indexedChatStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Native from '../../../modules/axonic-nearby';
import type {OwnHistoryStore} from '../../services/identity/ownHistoryStore';
import {supportsChatStorageRecovery,readNativeChatStorage,checkNativeChatWrite} from '../../../modules/axonic-app-update/src';
import {createStorageReadGate} from './storageReadSafety';
import {projectionHash,conversationPresentationChanged} from '../../services/identity/conversationProjection';
import {createConversationPageStore} from '../../services/identity/conversationPageStore';
const pages=new Map<string,ReturnType<typeof createConversationPageStore>>();
export function ownConversationPages(owner:string){let store=pages.get(owner);if(!store){store=createConversationPageStore(owner,{
 get:key=>AsyncStorage.getItem(key),set:(key,raw)=>AsyncStorage.setItem(key,raw),remove:keys=>AsyncStorage.multiRemove(keys),
 readSource:()=>ownChatStore(owner).read(),
 ...(indexedChatEnabled()?{readRooms:(rooms:string[])=>{const indexed=ownChatStore(owner).indexed;if(!indexed)throw Error('Indexed history unavailable');return indexed.readRooms(rooms);}}:{}),
 // Canonical writes must not wait for display-page reconstruction, even while
 // foregrounded. The durable dirty-room marker and existing UI subscription
 // rebuild on the next read, coalescing bursts without another timer or worker.
 deferProjection:()=>true,
 hash:Native?.attachmentSha256?value=>value.length<=6_000_128?Native!.attachmentSha256!(value):projectionHash(value):undefined,
 });pages.set(owner,store);}return store;}
const revisions=new Map<string,number>();
const gates=new Map<string,ReturnType<typeof createStorageReadGate>>();
const listeners=new Set<(owner:string,visible?:boolean)=>void>();
/** Notification only after durable success; listeners cannot fail a committed write. */
export function subscribeOwnChatWrites(listener:(owner:string,visible?:boolean)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
/** Process-local change token: long transfers can refresh permission snapshots
 * after a chat write without rereading the complete ledger for every buffer. */
export const ownChatRevision=(owner:string)=>revisions.get(owner)??0;

/** Own chat data keeps its existing schema/key. Temporary relay custody uses separate stores. */
export function ownChatStore(owner: string):OwnHistoryStore & {indexed?:Pick<ReturnType<typeof indexedChatStore>,'readRooms'>} {
  const key = '@axonic_root_chat_v1:' + owner;
  let gate=gates.get(owner);if(!gate){if(gates.size>=8)gates.delete(gates.keys().next().value!);gate=createStorageReadGate();gates.set(owner,gate);}
  const legacy=()=>supportsChatStorageRecovery()?readNativeChatStorage(owner):AsyncStorage.getItem(key);
  const indexed=indexedChatEnabled()?indexedChatStore(owner,legacy):undefined;
  const committed=()=>{gate.invalidate();revisions.set(owner,ownChatRevision(owner)+1);};
  const notify=(visible=true)=>{for(const listener of listeners){try{listener(owner,visible);}catch{}}};
  return {read: () => gate.read(()=>indexed?indexed.read():legacy()),
   ...(indexed?{indexed:{...indexed,writeScope:async(scope,before,raw)=>{
    await checkNativeChatWrite(owner,new TextEncoder().encode(raw).length);
    const states=[JSON.parse(before.raw),JSON.parse(raw)],rooms=new Set<string>();
    if(!conversationPresentationChanged(owner,states[0],states[1])){
     await indexed.writeScope(scope,before,raw);committed();notify(false);return;
    }
    for(const state of states)for(const m of state.messages)rooms.add(m.group?'group:'+m.group.id:m.peer);
    for(const group of states[1].groups??[]){const old=states[0].groups?.find((g:{id:string})=>g.id===group.id);if(old?.photo!==group.photo||old?.accepted!==group.accepted||old?.blocked!==group.blocked)rooms.add('group:'+group.id);}
    // Action targets affect the selected conversation's visible state as well.
    if('peer' in scope)rooms.add(scope.peer);if('group' in scope)rooms.add('group:'+scope.group);if('groupRead' in scope)rooms.add('group:'+scope.groupRead);
    await ownConversationPages(owner).patch([...rooms],()=>indexed.readRooms([...rooms]),async()=>{await indexed.writeScope(scope,before,raw);committed();});notify();
   }}}:{}) ,write: async (raw: string) => {
    await checkNativeChatWrite(owner,new TextEncoder().encode(raw).length);
    await ownConversationPages(owner).write(raw,async()=>{if(indexed)await indexed.write(raw);else await AsyncStorage.setItem(key,raw);committed();});notify();
  }};
}
