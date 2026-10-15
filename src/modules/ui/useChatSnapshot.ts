import {readProfileAvatar,readSharedAvatar,subscribeSharedAvatars} from '../storage';
import {useEffect,useState,useMemo} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {conversations,rootChatView,type RootChatState} from '../messaging';
import {localAccount} from '../identity';
import {ownChatRevision} from '../storage/chatStore';
import {createChatSnapshotCache} from './chatSnapshotCache';
import {createAvatarSnapshotCache} from './avatarSnapshotCache';
import {diagnosticJournal} from '../../services/diagnosticJournal';
import {storageErrorText,storageRetryDelay} from '../storage/storageReadSafety';

const avatarSnapshots=createAvatarSnapshotCache({current:owner=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:(owner,peer)=>peer===owner?readProfileAvatar(owner):readSharedAvatar(owner,peer)});
subscribeSharedAvatars(()=>avatarSnapshots.clear());

const snapshots=createChatSnapshotCache({revision:ownChatRevision,
 current:(owner:string)=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:async(owner:string)=>rootChatView(owner,await conversations().snapshot())});
let snapshotOwner=localAccount.status().account;
localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==snapshotOwner){snapshots.clear();avatarSnapshots.clear();}snapshotOwner=status.account;});

/** Only the visible foreground screen polls. Unchanged history keeps its view/reference. */
export function useChatSnapshot(){
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const [state,setState]=useState<RootChatState>(()=>{const owner=localAccount.status().account;return owner&&snapshots.peek(owner)||{version:1,contacts:[],messages:[]};}),[error,setError]=useState('');
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));return()=>sub.remove();},[]);
 useEffect(()=>{
  if(!focused||!foreground)return;
  let active=true,running=false,first=true,failures=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  async function refresh(){
   if(running)return;running=true;const started=Date.now();
   try{
    const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')return;
    const value=await snapshots.read(owner);
    if(!active||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
    if(value){setState(value);if(first){diagnosticJournal.record('chat_snapshot_ready',{milliseconds:Date.now()-started});first=false;}}
    setError('');
    failures=0;
   }catch(error){failures++;if(active){if(first){diagnosticJournal.record('chat_snapshot_failed');first=false;}setError(storageErrorText(error));}}
   finally{running=false;if(active)timer=setTimeout(()=>void refresh(),failures?storageRetryDelay(failures):700);}
  }
  void refresh();
  return()=>{active=false;clearInterval(timer);};
 },[focused,foreground]);
 const avatarOwner=localAccount.status().state==='unlocked'?localAccount.status().account:null;
 const avatarPeers=useMemo(()=>[...new Set([...state.contacts.map(c=>c.account),...(state.groups??[]).flatMap(g=>g.members)])].sort().join(','),[state.contacts,state.groups]);
 const [avatars,setAvatars]=useState<{owner:string|null;uris:Record<string,string|null>}>({owner:null,uris:{}});
 useEffect(()=>{if(!focused||!foreground)return;let active=true,revision=0;const refresh=async()=>{const epoch=++revision;if(!avatarOwner)return;const pairs=await Promise.all(avatarPeers.split(',').filter(Boolean).map(async peer=>[peer,await avatarSnapshots.read(avatarOwner,peer)] as const));if(active&&epoch===revision)setAvatars(previous=>{const uris=Object.fromEntries(pairs);return previous.owner===avatarOwner&&Object.keys(previous.uris).length===pairs.length&&pairs.every(([peer,uri])=>previous.uris[peer]===uri)?previous:{owner:avatarOwner,uris};});};void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};},[avatarOwner,avatarPeers,focused,foreground]);
 const withAvatars=useMemo(()=>({...state,avatarUris:avatars.owner===avatarOwner?avatars.uris:{}}),[state,avatars,avatarOwner]);
 return {state:withAvatars,error};
}
