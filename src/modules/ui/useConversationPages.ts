import {retainEqual} from '../../services/identity/sharedState';
import {diagnosticJournal} from '../../services/diagnosticJournal';
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {useStore} from 'zustand';
import {localAccount} from '../identity';
import {pendingMessages,type RootChatState,type RootChatMessage} from '../messaging';
import {ownConversationPages,subscribeOwnChatWrites} from '../storage/chatStore';
import {storageErrorText} from '../storage/storageReadSafety';
import type {ConversationWindow} from '../../services/identity/conversationPageStore';
import {conversationKey,messagePosition,comparePositions,type MessagePosition,type ConversationSummary} from '../../services/identity/conversationProjection';
import {createChatRefresh} from './chatRefresh';
import {conversationState} from './conversationState';
import {useForeground} from './liveState';
const empty:RootChatState={version:1,contacts:[],messages:[]},summaries:Record<string,ConversationSummary>={};
export function useConversationIndex(enabled=true){
 const foreground=useForeground(),active=enabled&&foreground;
 const observed=useMemo(()=>({...conversationState,subscribe:active?conversationState.subscribe:()=>()=>{}}),[active]);
 return useStore(observed);
}
export function useConversationSummaries(){const focused=useIsFocused(),value=useConversationIndex(focused);
 return {state:value.index?.state??empty,summaries:value.index?.summaries??summaries,error:value.error,loading:!value.index&&!value.error};
}
/** Refresh through the oldest loaded key, so new arrivals cannot push older
 * rows out of the window. Only explicit scrolling expands that boundary. */
export function useConversationWindow(key:string){
 const focused=useIsFocused(),foreground=useForeground(),base=useConversationIndex(focused),owner=localAccount.status().state==='unlocked'?localAccount.status().account:null;
 const context=useRef({owner,key});if(context.current.owner!==owner||context.current.key!==key)context.current={owner,key};
 const scope=context.current;
 const [window,setWindow]=useState<{scope:typeof scope;owner:string|null;key:string;value:ConversationWindow|null;error:string;loading:boolean}>({scope,owner,key,value:null,error:'',loading:true});
 const request=useRef<{minimum:number;through?:MessagePosition}>({minimum:50});
 const controller=useRef<ReturnType<typeof createChatRefresh<ConversationWindow>>|undefined>(undefined);
 const requestScope=useRef(scope);if(requestScope.current!==scope){requestScope.current=scope;request.current={minimum:50};}
 const value=window.scope===scope?window.value:null;
 const valueRef=useRef(value);valueRef.current=value;
 useEffect(()=>{
  if(!owner){setWindow({scope,owner,key,value:null,error:'',loading:true});return;}
  // Keep this account's last rendered page while a picker/camera is open.
  // The scope guard prevents another account or conversation seeing it.
  if(!focused||!foreground)return;
  const account=owner,room=key;let active=true;
  const current=()=>active&&localAccount.status().state==='unlocked'&&localAccount.status().account===account&&context.current===scope?account:null;
  const refresh=createChatRefresh({owner:current,read:()=>ownConversationPages(account).readWindow(room,request.current.minimum,request.current.through),
   ready:(next,milliseconds)=>{if(!current())return;diagnosticJournal.record('chat_snapshot_ready',{milliseconds});if(next.oldest&&(!request.current.through||comparePositions(next.oldest,request.current.through)<0))request.current.through=next.oldest;setWindow(previous=>{const value=previous.scope===scope?retainEqual(previous.value,next):next;return previous.scope===scope&&previous.value===value&&!previous.error&&!previous.loading?previous:{scope,owner:account,key:room,value,error:'',loading:false};});},
   failed:error=>{if(current())setWindow(s=>({scope,owner:account,key:room,value:s.scope===scope?s.value:null,error:storageErrorText(error),loading:false}));}});
  controller.current=refresh;const off=subscribeOwnChatWrites((who,visible)=>{if(visible!==false)refresh.wake(who);});
  return()=>{active=false;off();refresh.stop();if(controller.current===refresh)controller.current=undefined;};
 },[owner,key,focused,foreground]);
 // Retire optimistic rows only after their durable replacement is rendered.
 useEffect(()=>{if(owner&&value)pendingMessages.reconcile(owner,{...empty,messages:value.messages});},[owner,value]);
 const loadMore=useCallback(()=>{const current=valueRef.current;if(!owner||!current?.hasMore||window.loading)return;
  request.current.minimum=current.messages.length+50;request.current.through=current.oldest;setWindow(s=>({...s,loading:true}));controller.current?.wake(owner);
 },[owner,window.loading]);
 const revealMessage=useCallback((message:RootChatMessage)=>{
  if(!owner||context.current!==scope||!focused||!foreground||conversationKey(message)!==key)return;
  const position=messagePosition(message,owner);
  if(!request.current.through||comparePositions(position,request.current.through)<0)request.current.through=position;
  setWindow(s=>({...s,loading:true}));controller.current?.wake(owner);
 },[owner,key,scope,focused,foreground]);
 const subscribePending=useCallback((fn:()=>void)=>focused&&foreground?pendingMessages.subscribe(fn):()=>{},[focused,foreground]);
 const pending=useSyncExternalStore(subscribePending,pendingMessages.version,pendingMessages.version);
 const state=useMemo(()=>{const metadata=base.index?.state??empty;
  const merged=pendingMessages.merge(owner,{...metadata,messages:value?.messages??[]});return {...merged,messages:merged.messages.filter(m=>conversationKey(m)===key)};
 },[base.index,owner,key,value,pending]);
 return {state,error:window.scope===scope?window.error||base.error:base.error,references:value?.references??[],hasMore:value?.hasMore??false,loading:window.scope!==scope||window.loading,loadMore,revealMessage,photoState:base.index?.state??empty};
}
