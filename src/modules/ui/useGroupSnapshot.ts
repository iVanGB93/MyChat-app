import {useEffect,useRef,useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {conversations,rootChatView,type RootChatState} from '../messaging';
import {localAccount} from '../identity';
import {subscribeOwnChatWrites} from '../storage/chatStore';
import {storageErrorText} from '../storage/storageReadSafety';
import {useAccountState,useForeground} from './liveState';
import {createChatRefresh} from './chatRefresh';
const empty:RootChatState={version:1,contacts:[],messages:[]};
/** Metadata for creation; selected group's media for settings; one logical message for info. */
export function useGroupSnapshot(group?:string,messageId?:string){
 const status=useAccountState(),owner=status.state==='unlocked'?status.account:null,focused=useIsFocused(),foreground=useForeground();
 const context=useRef({owner,group,messageId});if(context.current.owner!==owner||context.current.group!==group||context.current.messageId!==messageId)context.current={owner,group,messageId};const scope=context.current;
 const [result,setResult]=useState<{scope:typeof scope;state:RootChatState;error:string}>({scope,state:empty,error:''});
 useEffect(()=>{if(!owner||!focused||!foreground)return;let active=true;const current=()=>active&&context.current===scope&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner?owner:null;
  const refresh=createChatRefresh({owner:current,read:async()=>{const api=conversations();return rootChatView(owner,group?await api.groupSnapshot(group,messageId):await api.metadataSnapshot());},ready:state=>{if(current())setResult({scope,state,error:''});},failed:error=>{if(current())setResult(previous=>({scope,state:previous.scope===scope?previous.state:empty,error:storageErrorText(error)}));}});
  const off=subscribeOwnChatWrites(who=>refresh.wake(who));return()=>{active=false;off();refresh.stop();};
 },[scope,owner,group,messageId,focused,foreground]);
 return owner&&result.scope===scope?{state:result.state,error:result.error}:{state:empty,error:''};
}
