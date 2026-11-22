export {useConversationIndex} from './useConversationPages';
export {createChatReplyLookup} from './chatReplyLookup';
export {retainEqual as retainEqualChatProps} from '../../services/identity/sharedState';
import {useGroupSnapshot} from './useGroupSnapshot';
import {useConversationSelection,useConversationSummaries,useConversationWindow} from './useConversationPages';
import {readProfileAvatar,readSharedAvatar,subscribeSharedAvatars} from '../storage';
import {useCallback,useEffect,useState,useMemo,useRef,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {pendingMessages} from '../messaging';
import {localAccount} from '../identity';
import {createAvatarSnapshotCache} from './avatarSnapshotCache';
import {diagnosticJournal} from '../../services/diagnosticJournal';
import {useForeground} from './liveState';
import {useStore} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import {chatState} from './chatState';
import {createConversationSelector} from './chatReadModel';

const avatarSnapshots=createAvatarSnapshotCache({current:owner=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:(owner,peer)=>peer===owner?readProfileAvatar(owner):readSharedAvatar(owner,peer)});
subscribeSharedAvatars(change=>change?avatarSnapshots.invalidate(change.owner,change.peer):avatarSnapshots.clear());

let snapshotOwner=localAccount.status().account;
localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==snapshotOwner)avatarSnapshots.clear();snapshotOwner=status.account;});

/** Names and approvals do not subscribe to message or transfer changes. */
export function useChatContacts(enabled=true){
 return useConversationSelection(enabled,useShallow(value=>({contacts:value.index?.state.contacts??emptyContacts,hiddenChats:value.index?.state.hiddenChats,error:value.error})));
}
const emptyContacts:import('../messaging').RootChatState['contacts']=[];


/** The visible foreground screen refreshes on durable writes and foreground entry.
 * Unchanged and hidden screens do no refresh work. */
export function useChatSnapshot(conversation?:string){
 const focused=useIsFocused(),foreground=useForeground();
 const observed=useMemo(()=>({...chatState,subscribe:focused&&foreground?chatState.subscribe:()=>()=>{}}),[focused,foreground]);
 const select=useMemo(()=>{const room=conversation?createConversationSelector(conversation):null;
  return (s:ReturnType<typeof chatState.getState>)=>room?room(s.state,s.rooms):s.state;
 },[conversation]);
 const state=useStore(observed,select),error=useStore(observed,s=>s.error);
 const avatarOwner=localAccount.status().state==='unlocked'?localAccount.status().account:null;
 const subscribePending=useCallback((listener:()=>void)=>focused&&foreground?pendingMessages.subscribe(listener):()=>{},[focused,foreground]);
 const pendingVersion=useSyncExternalStore(subscribePending,pendingMessages.version,pendingMessages.version);
 const visible=useMemo(()=>{const merged=pendingMessages.merge(avatarOwner,state);if(!conversation||merged===state)return merged;
  return {...merged,messages:merged.messages.filter(m=>(m.group?'group:'+m.group.id:m.peer)===conversation)};
 },[state,avatarOwner,pendingVersion,conversation]);
 const withAvatars=useIndexedAvatars(visible);
 return {state:withAvatars,error};
}

/** First screen-container layout only: not message paint or transition completion.
 * Fixed event names and elapsed time; no chat IDs, content, or persistent timers. */
export function useChatLayoutTiming(event:'private_chat_layout'|'group_chat_layout'){
 const focused=useIsFocused(),visible=useRef(focused);visible.current=focused;
 const sample=useRef({started:performance.now(),owner:localAccount.status().account,recorded:false});
 return useCallback(()=>{const s=sample.current,status=localAccount.status();
  if(s.recorded||!visible.current||AppState.currentState!=='active'||status.state!=='unlocked'||status.account!==s.owner)return;
  s.recorded=true;diagnosticJournal.record(event,{milliseconds:performance.now()-s.started});
 },[event]);
}

/** Summary/page readers share the same avatar cache as detail screens. */
function useIndexedAvatars(state:import('../messaging').RootChatState,conversation?:string,visiblePeers?:readonly string[]){
 const focused=useIsFocused(),foreground=useForeground(),owner=localAccount.status().state==='unlocked'?localAccount.status().account:null;
 const peers=useMemo(()=>{
  if(visiblePeers)return [...new Set(visiblePeers)].sort().join(',');
  if(conversation&&!conversation.startsWith('group:'))return conversation;
  const members=conversation?state.groups?.find(g=>g.id===conversation.slice(6))?.members??[]:
    [...state.contacts.map(c=>c.account),...(state.groups??[]).flatMap(g=>g.members)];
  return [...new Set(members)].sort().join(',');
 },[conversation,state.contacts,state.groups,visiblePeers]);
 const accounts=useMemo(()=>peers?peers.split(','):[],[peers]);
 const [avatars,setAvatars]=useState<{owner:string|null;uris:Record<string,string|null>}>(()=>{const uris:Record<string,string|null>={};if(owner)for(const peer of accounts){const value=avatarSnapshots.peek(owner,peer);if(value!==undefined)uris[peer]=value;}return {owner,uris};});
 useEffect(()=>{if(!focused||!foreground||!owner)return;let active=true,revision=0;
  const refresh=async()=>{const version=++revision,pairs=await Promise.all(accounts.map(async peer=>[peer,await avatarSnapshots.read(owner,peer)] as const));if(active&&version===revision)setAvatars(previous=>previous.owner===owner&&Object.keys(previous.uris).length===pairs.length&&pairs.every(([peer,uri])=>previous.uris[peer]===uri)?previous:{owner,uris:Object.fromEntries(pairs)});};
  void refresh().catch(()=>{});const off=subscribeSharedAvatars(change=>{if(!change||change.owner===owner&&accounts.includes(change.peer))void refresh().catch(()=>{});});return()=>{active=false;off();};
 },[focused,foreground,owner,accounts]);
 return useMemo(()=>({...state,avatarUris:avatars.owner===owner?avatars.uris:{}}),[state,avatars,owner]);
}
export function useChatListSnapshot(onlyConversations=false){
 const value=useConversationSummaries();
 const peers=useMemo(()=>onlyConversations?value.state.contacts.filter(contact=>!value.state.hiddenChats?.includes(contact.account)).map(contact=>contact.account):undefined,[onlyConversations,value.state.contacts,value.state.hiddenChats]);
 return {...value,state:useIndexedAvatars(value.state,undefined,peers)};
}
export function usePagedChat(conversation:string){const value=useConversationWindow(conversation);return {...value,state:useIndexedAvatars(value.state,conversation)};}

export {usePrivateCallHistory} from './usePrivateCallHistory';
export {privateChatTimeline,groupChatTimeline,type PrivateChatRow} from './privateChatTimeline';

export function useGroupDetails(group?:string,messageId?:string){const value=useGroupSnapshot(group,messageId);return {...value,state:useIndexedAvatars(value.state)};}

export {useReplyNavigation} from './useReplyNavigation';

export {useChatScroll,CHAT_REVEAL_SPACE} from './useChatScroll';

export {useMessageDetails} from './useMessageDetails';

export {attachmentTimeline,type PreparationRow} from './attachmentTimeline';

