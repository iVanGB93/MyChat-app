import {readProfileAvatar,readSharedAvatar,subscribeSharedAvatars} from '../storage';
import {useCallback,useEffect,useState,useMemo,useRef} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {conversations,rootChatView,type RootChatState} from '../messaging';
import {localAccount} from '../identity';
import {ownChatRevision,subscribeOwnChatWrites} from '../storage/chatStore';
import {createChatRefresh} from './chatRefresh';
import {createChatSnapshotCache} from './chatSnapshotCache';
import {createAvatarSnapshotCache} from './avatarSnapshotCache';
import {diagnosticJournal} from '../../services/diagnosticJournal';
import {storageErrorText} from '../storage/storageReadSafety';

const avatarSnapshots=createAvatarSnapshotCache({current:owner=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:(owner,peer)=>peer===owner?readProfileAvatar(owner):readSharedAvatar(owner,peer)});
subscribeSharedAvatars(()=>avatarSnapshots.clear());

const snapshots=createChatSnapshotCache({revision:ownChatRevision,
 current:(owner:string)=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:async(owner:string)=>{const started=performance.now(),state=await conversations().snapshot(),loaded=performance.now();
  const view=rootChatView(owner,state),derived=performance.now();
  if(localAccount.status().state==='unlocked'&&localAccount.status().account===owner){diagnosticJournal.record('chat_history_read',{milliseconds:loaded-started});diagnosticJournal.record('chat_view_derived',{milliseconds:derived-loaded});}
  return view;}});
let snapshotOwner=localAccount.status().account;
localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==snapshotOwner){snapshots.clear();avatarSnapshots.clear();}snapshotOwner=status.account;});

/** The visible foreground screen refreshes on durable writes. The slower safety
 * poll reuses unchanged history; hidden screens do no refresh work. */
export function useChatSnapshot(){
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const [state,setState]=useState<RootChatState>(()=>{const owner=localAccount.status().account;return owner&&snapshots.peek(owner)||{version:1,contacts:[],messages:[]};}),[error,setError]=useState('');
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));return()=>sub.remove();},[]);
 useEffect(()=>{
  if(!focused||!foreground)return;
  let first=true;
  const refresh=createChatRefresh({owner:()=>localAccount.status().state==='unlocked'?localAccount.status().account:null,read:snapshots.read,fresh:(owner,value)=>snapshots.peek(owner)===value,
   ready(value,milliseconds){setState(value);setError('');if(first){diagnosticJournal.record('chat_snapshot_ready',{milliseconds});first=false;}},
   failed(error){if(first){diagnosticJournal.record('chat_snapshot_failed');first=false;}setError(storageErrorText(error));}});
  const off=subscribeOwnChatWrites(refresh.wake);
  let bound=localAccount.status().account;
  const offAccount=localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==bound)setState({version:1,contacts:[],messages:[]});bound=status.account;if(status.state==='unlocked'&&bound)refresh.wake(bound);});
  return()=>{off();offAccount();refresh.stop();};
 },[focused,foreground]);
 const avatarOwner=localAccount.status().state==='unlocked'?localAccount.status().account:null;
 const avatarPeers=useMemo(()=>[...new Set([...state.contacts.map(c=>c.account),...(state.groups??[]).flatMap(g=>g.members)])].sort().join(','),[state.contacts,state.groups]);
 const [avatars,setAvatars]=useState<{owner:string|null;uris:Record<string,string|null>}>(()=>{const uris:Record<string,string|null>={};if(avatarOwner)for(const peer of avatarPeers.split(',').filter(Boolean)){const uri=avatarSnapshots.peek(avatarOwner,peer);if(uri!==undefined)uris[peer]=uri;}return {owner:avatarOwner,uris};});
 useEffect(()=>{if(!focused||!foreground)return;let active=true,revision=0;const refresh=async()=>{const epoch=++revision;if(!avatarOwner)return;const pairs=await Promise.all(avatarPeers.split(',').filter(Boolean).map(async peer=>[peer,await avatarSnapshots.read(avatarOwner,peer)] as const));if(active&&epoch===revision)setAvatars(previous=>{const uris=Object.fromEntries(pairs);return previous.owner===avatarOwner&&Object.keys(previous.uris).length===pairs.length&&pairs.every(([peer,uri])=>previous.uris[peer]===uri)?previous:{owner:avatarOwner,uris};});};void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};},[avatarOwner,avatarPeers,focused,foreground]);
 const withAvatars=useMemo(()=>({...state,avatarUris:avatars.owner===avatarOwner?avatars.uris:{}}),[state,avatars,avatarOwner]);
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
