import {useEffect,useState} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {nextMessageStateExpiry} from '../messaging/messageInfoState';
import type {RootChatMessage} from '../messaging';
/** One expiry timer, only while this screen is visible; no history polling. */
export function useMessageStateClock(messages:readonly RootChatMessage[]){
 const focused=useIsFocused(),[now,setNow]=useState(Date.now);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined,alive=true;
  const refresh=()=>{
   if(timer!==undefined)clearTimeout(timer);timer=undefined;
   if(!alive||!focused||AppState.currentState!=='active')return;
   const at=Date.now();setNow(at);const expiry=nextMessageStateExpiry(messages,at);
   if(expiry!==undefined)timer=setTimeout(refresh,Math.min(2147483647,Math.max(1,expiry-at+1)));
  };
  const sub=AppState.addEventListener('change',refresh);refresh();
  return()=>{alive=false;if(timer!==undefined)clearTimeout(timer);sub.remove();};
 },[messages,focused]);
 return now;
}
