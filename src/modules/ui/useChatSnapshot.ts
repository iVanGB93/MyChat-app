import {readProfileAvatar,readSharedAvatar,subscribeSharedAvatars} from '../storage';
import {useEffect,useRef,useState,useMemo} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {conversations,rootChatView,type RootChatState} from '../messaging';
import {localAccount} from '../identity';

/** Only the visible foreground screen polls. Unchanged history keeps its view/reference. */
export function useChatSnapshot(){
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const [state,setState]=useState<RootChatState>({version:1,contacts:[],messages:[]}),[error,setError]=useState('');
 const previous=useRef<{owner:string;raw:string}|null>(null);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));return()=>sub.remove();},[]);
 useEffect(()=>{
  if(!focused||!foreground)return;
  let active=true,running=false;
  async function refresh(){
   if(running)return;running=true;
   try{
    const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')return;
    const value=await conversations().snapshot();
    if(!active||localAccount.status().account!==owner||localAccount.status().state!=='unlocked')return;
    const raw=JSON.stringify(value);
    if(previous.current?.owner!==owner||previous.current.raw!==raw){previous.current={owner,raw};setState(rootChatView(owner,value));}
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
 useEffect(()=>{let active=true,revision=0;const refresh=async()=>{const epoch=++revision;if(!avatarOwner)return;const pairs=await Promise.all(avatarPeers.split(',').filter(Boolean).map(async peer=>[peer,peer===avatarOwner?await readProfileAvatar(avatarOwner):await readSharedAvatar(avatarOwner,peer)] as const));if(active&&epoch===revision)setAvatars({owner:avatarOwner,uris:Object.fromEntries(pairs)});};void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};},[avatarOwner,avatarPeers]);
 const withAvatars=useMemo(()=>({...state,avatarUris:avatars.owner===avatarOwner?avatars.uris:{}}),[state,avatars,avatarOwner]);
 return {state:withAvatars,error};
}
