import {networkState} from './liveState';
import {subscribeChatActivity,nextChatActivityDeadline} from '../messaging';
import {useCallback,useEffect,useState} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {peerTyping,notifyPeerTyping} from '../messaging';

export function useChatActivity(group?:string){
 const focused=useIsFocused(),[online,setOnline]=useState<string[]>([]),[typing,setTyping]=useState<string[]>([]);
 useEffect(()=>{
  if(!focused)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{
   clearTimeout(timer);
   const peers=AppState.currentState==='active'?networkState.getState().value.liveConnections.map(c=>c.account).sort():[];
   const typers=peers.filter(peer=>peerTyping(peer,group));
   setOnline(old=>old.join()===peers.join()?old:peers);setTyping(old=>old.join()===typers.join()?old:typers);
   const deadline=nextChatActivityDeadline();if(AppState.currentState==='active'&&Number.isFinite(deadline))timer=setTimeout(refresh,Math.max(0,deadline-Date.now()));
  };
  const a=subscribeChatActivity(refresh),b=networkState.subscribe(refresh),app=AppState.addEventListener('change',refresh);refresh();return()=>{clearTimeout(timer);a();b();app.remove();};
 },[focused,group]);
 const notify=useCallback((peer:string,value:boolean)=>{
  // Ephemeral hints have no offline delivery value; use the existing local session view.
  if(online.includes(peer))void notifyPeerTyping(peer,value,group).catch(()=>{});
 },[online,group]);
 return {online,typing,notify};
}
