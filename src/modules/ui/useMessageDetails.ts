import {useEffect,useRef,useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {conversations,rootChatView,type RootChatState} from '../messaging';
import {localAccount} from '../identity';
import {subscribeOwnChatWrites} from '../storage/chatStore';
import {storageErrorText} from '../storage/storageReadSafety';
import {useAccountState,useForeground} from './liveState';
import {createChatRefresh} from './chatRefresh';
const empty:RootChatState={version:1,contacts:[],messages:[]};
/** Read one message by indexed ID; never infer absence from the summary cache. */
export function useMessageDetails(messageId:string){
 const status=useAccountState(),owner=status.state==='unlocked'?status.account:null,focused=useIsFocused(),foreground=useForeground();
 const context=useRef({owner,messageId});if(context.current.owner!==owner||context.current.messageId!==messageId)context.current={owner,messageId};const scope=context.current;
 const [result,setResult]=useState<{scope:typeof scope;state:RootChatState;error:string;loading:boolean}>({scope,state:empty,error:'',loading:true});
 useEffect(()=>{if(!owner||!focused||!foreground)return;let active=true;const current=()=>active&&context.current===scope&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner?owner:null;
  const refresh=createChatRefresh({owner:current,read:async()=>{const api=conversations();return rootChatView(owner,await api.messageIdSnapshot(messageId));},ready:state=>{if(current())setResult({scope,state,error:'',loading:false});},failed:error=>{if(current())setResult(previous=>({scope,state:previous.scope===scope?previous.state:empty,error:storageErrorText(error),loading:false}));}});
  const off=subscribeOwnChatWrites(who=>refresh.wake(who));return()=>{active=false;off();refresh.stop();};
 },[scope,owner,messageId,focused,foreground]);
 return owner&&result.scope===scope?{state:result.state,error:result.error,loading:result.loading}:{state:empty,error:'',loading:true};
}
