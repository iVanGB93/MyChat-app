import {useEffect,useState} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {localAccountNetworkSnapshot,peerTyping,notifyPeerTyping} from '../messaging';

export function useChatActivity(group?:string){
 const focused=useIsFocused(),[online,setOnline]=useState<string[]>([]),[typing,setTyping]=useState<string[]>([]);
 useEffect(()=>{
  if(!focused)return;
  const refresh=()=>{
   const peers=AppState.currentState==='active'?(localAccountNetworkSnapshot()?.pool?.connections??[]).filter(c=>c.state==='connected').map(c=>c.account).sort():[];
   const typers=peers.filter(peer=>peerTyping(peer,group));
   setOnline(old=>old.join()===peers.join()?old:peers);setTyping(old=>old.join()===typers.join()?old:typers);
  };
  refresh();const timer=setInterval(refresh,1000);return()=>clearInterval(timer);
 },[focused,group]);
 return {online,typing,notify:(peer:string,value:boolean)=>void notifyPeerTyping(peer,value,group).catch(()=>{})};
}
