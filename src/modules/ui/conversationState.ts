import {AppState} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {localAccount} from '../identity';
import {ownConversationPages,subscribeOwnChatWrites} from '../storage/chatStore';
import {storageErrorText} from '../storage/storageReadSafety';
import {retainEqual} from '../../services/identity/sharedState';
import type {ConversationIndex} from '../../services/identity/conversationProjection';
import {createChatRefresh} from './chatRefresh';
import {diagnosticJournal} from '../../services/diagnosticJournal';
const owner=()=>localAccount.status().state==='unlocked'?localAccount.status().account:null;
const store=createStore<{owner:string|null;index:ConversationIndex|null;error:string}>(()=>({owner:owner(),index:null,error:''}));
let readers=0,refresh:ReturnType<typeof createChatRefresh<ConversationIndex>>|undefined,detach:(()=>void)|undefined;
function start(){refresh?.stop();refresh=undefined;if(!readers||!owner()||AppState.currentState!=='active')return;
 refresh=createChatRefresh({owner,read:account=>ownConversationPages(account).index(),ready:(index,milliseconds)=>{if(!store.getState().index)diagnosticJournal.record('chat_list_ready',{milliseconds});store.setState(s=>{const next=retainEqual(s.index,index);return s.owner===index.owner&&s.index===next&&!s.error?s:{owner:index.owner,index:next,error:''};});},failed:error=>store.setState({error:storageErrorText(error)})});
}
localAccount.subscribe(()=>{const current=owner();if(current!==store.getState().owner||!current){store.setState({owner:current,index:null,error:''});start();}});
/** Shared summaries only; opened conversation windows belong to their screen. */
export const conversationState={getState:store.getState,getInitialState:store.getInitialState,
 subscribe(listener:Parameters<typeof store.subscribe>[0]){const off=store.subscribe(listener);if(readers++===0){const writes=subscribeOwnChatWrites((account,visible)=>{if(visible!==false)refresh?.wake(account);}),app=AppState.addEventListener('change',start);detach=()=>{writes();app.remove();};start();}
  return()=>{off();if(--readers===0){refresh?.stop();refresh=undefined;detach?.();detach=undefined;}};
 }};
