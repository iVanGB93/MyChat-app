import {readProfileAvatar,readSharedAvatar,subscribeSharedAvatars} from '../storage';
import {useEffect,useState,useMemo} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {conversations,rootChatView,type RootChatState} from '../messaging';
import {localAccount} from '../identity';
import {ownChatRevision} from '../storage/chatStore';
import {createChatSnapshotCache} from './chatSnapshotCache';

const snapshots=createChatSnapshotCache({revision:ownChatRevision,
 current:(owner:string)=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,
 read:async(owner:string)=>rootChatView(owner,await conversations().snapshot())});
let snapshotOwner=localAccount.status().account;
localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==snapshotOwner)snapshots.clear();snapshotOwner=status.account;});

/** Only the visible foreground screen polls. Unchanged history keeps its view/reference. */
export function useChatSnapshot(){
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const [state,setState]=useState<RootChatState>(()=>{const owner=localAccount.status().account;return owner&&snapshots.peek(owner)||{version:1,contacts:[],messages:[]};}),[error,setError]=useState('');
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));return()=>sub.remove();},[]);
 useEffect(()=>{
  if(!focused||!foreground)return;
  let active=true,running=false;
  async function refresh(){
   if(running)return;running=true;
   try{
    const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')return;
    const value=await snapshots.read(owner);
    if(!active||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
    if(value)setState(value);
    setError('');
   }catch{if(active)setError('Unable to read chats. Your saved data was not replaced.');}
   finally{running=false;}
  }
  void refresh();const timer=setInterval(()=>void refresh(),700);
  return()=>{active=false;clearInterval(timer);};
 },[focused,foreground]);
 const avatarOwner=localAccount.status().state==='unlocked'?localAccount.status().account:null;
 const avatarPeers=[...new Set([...state.contacts.map(c=>c.account),...(state.groups??[]).flatMap(g=>g.members)])].sort().join(',');
 const [avatars,setAvatars]=useState<{owner:string|null;uris:Record<string,string|null>}>({owner:null,uris:{}});
 useEffect(()=>{if(!focused||!foreground)return;let active=true,revision=0;const refresh=async()=>{const epoch=++revision;if(!avatarOwner)return;const pairs=await Promise.all(avatarPeers.split(',').filter(Boolean).map(async peer=>[peer,peer===avatarOwner?await readProfileAvatar(avatarOwner):await readSharedAvatar(avatarOwner,peer)] as const));if(active&&epoch===revision)setAvatars(previous=>{const uris=Object.fromEntries(pairs);return previous.owner===avatarOwner&&Object.keys(previous.uris).length===pairs.length&&pairs.every(([peer,uri])=>previous.uris[peer]===uri)?previous:{owner:avatarOwner,uris};});};void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};},[avatarOwner,avatarPeers,focused,foreground]);
 const withAvatars=useMemo(()=>({...state,avatarUris:avatars.owner===avatarOwner?avatars.uris:{}}),[state,avatars,avatarOwner]);
 return {state:withAvatars,error};
}
