import {AppState} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {localAccount} from '../identity';
import {conversations,pendingMessages,type RootChatState} from '../messaging';
import {ownChatRevision,subscribeOwnChatWrites} from '../storage/chatStore';
import {storageErrorText} from '../storage/storageReadSafety';
import {createChatSnapshotCache} from './chatSnapshotCache';
import {createChatReadModel,indexConversationMessages,type ConversationMessages} from './chatReadModel';
import {createChatRefresh} from './chatRefresh';
import {diagnosticJournal} from '../../services/diagnosticJournal';

const empty:RootChatState={version:1,contacts:[],messages:[]};
const model=createChatReadModel();
const currentOwner=()=>localAccount.status().state==='unlocked'?localAccount.status().account:null;
const snapshots=createChatSnapshotCache({revision:ownChatRevision,current:owner=>currentOwner()===owner,
 read:async owner=>{const start=performance.now(),raw=await conversations().snapshot(),loaded=performance.now();
  if(currentOwner()!==owner)return empty;
  const result=model.derive(owner,raw);
  diagnosticJournal.record('chat_history_read',{milliseconds:loaded-start});
  diagnosticJournal.record('chat_view_derived',{milliseconds:performance.now()-loaded});return result;}});
const store=createStore<{owner:string|null;state:RootChatState;rooms:ConversationMessages;error:string}>(()=>({owner:currentOwner(),state:empty,rooms:{},error:''}));
let readers=0,refresh:ReturnType<typeof createChatRefresh<RootChatState>>|undefined,stopSources:(()=>void)|undefined;
function startRefresh(){
 refresh?.stop();refresh=undefined;
 if(!readers||AppState.currentState!=='active'||!currentOwner())return;
 refresh=createChatRefresh({owner:currentOwner,read:snapshots.read,fresh:(owner,state)=>snapshots.peek(owner)===state,
  ready(state,milliseconds){const owner=currentOwner();if(!owner)return;pendingMessages.reconcile(owner,state);
   if(store.getState().state!==state||store.getState().error)store.setState({owner,state,rooms:indexConversationMessages(state,store.getState().rooms),error:''});
   diagnosticJournal.record('chat_snapshot_ready',{milliseconds});},
  failed(error){store.setState({error:storageErrorText(error)});diagnosticJournal.record('chat_snapshot_failed');}});
}
// Clear private data even when there are no mounted consumers. A generation in
// snapshots also prevents same-account lock/unlock from accepting an old read.
localAccount.subscribe(()=>{const owner=currentOwner();if(owner!==store.getState().owner||!owner){
 snapshots.clear();model.clear();store.setState({owner,state:empty,rooms:{},error:''});startRefresh();
}});
export const chatState={getState:store.getState,getInitialState:store.getInitialState,
 subscribe(listener:Parameters<typeof store.subscribe>[0]){const off=store.subscribe(listener);
  if(readers++===0){const writes=subscribeOwnChatWrites(owner=>refresh?.wake(owner)),app=AppState.addEventListener('change',startRefresh);
   stopSources=()=>{writes();app.remove();};startRefresh();}
  return()=>{off();if(--readers===0){refresh?.stop();refresh=undefined;stopSources?.();stopSources=undefined;}};
 }};
