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
import {chatState} from './chatState';
import {createConversationSelector} from './chatReadModel';

const avatarSnapshots=createAvatarSnapshotCache({current:owner=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:(owner,peer)=>peer===owner?readProfileAvatar(owner):readSharedAvatar(owner,peer)});
subscribeSharedAvatars(change=>change?avatarSnapshots.invalidate(change.owner,change.peer):avatarSnapshots.clear());

let snapshotOwner=localAccount.status().account;
localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==snapshotOwner)avatarSnapshots.clear();snapshotOwner=status.account;});

/** Names and approvals do not subscribe to message or transfer changes. */
export function useChatContacts(enabled=true){
 const observed=useMemo(()=>({...chatState,subscribe:enabled?chatState.subscribe:()=>()=>{}}),[enabled]);
 const contacts=useStore(observed,s=>s.state.contacts),hiddenChats=useStore(observed,s=>s.state.hiddenChats);
 return {contacts,hiddenChats,error:useStore(observed,s=>s.error)};
}

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
 const avatarPeers=useMemo(()=>[...new Set([...state.contacts.map(c=>c.account),...(state.groups??[]).flatMap(g=>g.members)])].sort().join(','),[state.contacts,state.groups]);
 const [avatars,setAvatars]=useState<{owner:string|null;uris:Record<string,string|null>}>(()=>{const uris:Record<string,string|null>={};if(avatarOwner)for(const peer of avatarPeers.split(',').filter(Boolean)){const uri=avatarSnapshots.peek(avatarOwner,peer);if(uri!==undefined)uris[peer]=uri;}return {owner:avatarOwner,uris};});
 useEffect(()=>{if(!focused||!foreground)return;let active=true,revision=0;const refresh=async()=>{const epoch=++revision;if(!avatarOwner)return;const pairs=await Promise.all(avatarPeers.split(',').filter(Boolean).map(async peer=>[peer,await avatarSnapshots.read(avatarOwner,peer)] as const));if(active&&epoch===revision)setAvatars(previous=>{const uris=Object.fromEntries(pairs);return previous.owner===avatarOwner&&Object.keys(previous.uris).length===pairs.length&&pairs.every(([peer,uri])=>previous.uris[peer]===uri)?previous:{owner:avatarOwner,uris};});};void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};},[avatarOwner,avatarPeers,focused,foreground]);
 const subscribePending=useCallback((listener:()=>void)=>focused&&foreground?pendingMessages.subscribe(listener):()=>{},[focused,foreground]);
 const pendingVersion=useSyncExternalStore(subscribePending,pendingMessages.version,pendingMessages.version);
 const visible=useMemo(()=>{const merged=pendingMessages.merge(avatarOwner,state);if(!conversation||merged===state)return merged;
  return {...merged,messages:merged.messages.filter(m=>(m.group?'group:'+m.group.id:m.peer)===conversation)};
 },[state,avatarOwner,pendingVersion,conversation]);
 const withAvatars=useMemo(()=>({...visible,avatarUris:avatars.owner===avatarOwner?avatars.uris:{}}),[visible,avatars,avatarOwner]);
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
