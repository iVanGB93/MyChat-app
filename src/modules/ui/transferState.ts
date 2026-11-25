import type {RootChatMessage} from '../messaging';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import {useMemo} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useForeground} from './liveState';
import {localAccount} from '../identity';
import {rootAttachmentProgress,subscribeAttachmentSelections} from '../../services/identity/rootAttachmentSelections';
import {subscribeAttachmentJobProgress,subscribeAttachmentReceiveProgress} from '../../services/identity/mobileAttachmentJobs';
import {retainEqual} from '../../services/identity/sharedState';
import {createAttachmentProgressLookup} from '../../utils/attachment-progress';

type Progress=Awaited<ReturnType<typeof rootAttachmentProgress>>;
const handoffs=new Map<string,Progress['selections'][number]>();
const empty:Progress={jobs:[],selections:[]};
type Lookup=(digest:string)=>Progress['jobs'][number]|undefined;
const makeLookup=(jobs:Progress['jobs'])=>createAttachmentProgressLookup(jobs,(digest:string)=>digest);
const store=createStore<{value:Progress;lookup:Lookup;received:ReadonlyMap<string,number>}>(()=>({value:empty,lookup:makeLookup(empty.jobs),received:new Map()}));
let readers=0,epoch=0,revision=0,jobRevision=0,stop:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
let flight=false,dirty=false;
const owner=()=>localAccount.status().state==='unlocked'?localAccount.status().account:null;
function publish(value:Progress){if(handoffs.size){const ids=new Set(value.selections.map(s=>s.id));value={...value,selections:[...value.selections,...[...handoffs.values()].filter(s=>!ids.has(s.id))]};}const previous=store.getState(),next=retainEqual(previous.value,value);if(next!==previous.value)store.setState({value:next,lookup:next.jobs===previous.value.jobs?previous.lookup:makeLookup(next.jobs)});}
async function hydrate(){
 if(!readers||AppState.currentState!=='active')return;
 if(flight){dirty=true;return;}flight=true;dirty=false;
 let failed=false;
 const account=owner(),generation=epoch,version=revision,jobsVersion=jobRevision;
 try{const next=await rootAttachmentProgress();if(account===owner()&&generation===epoch){if(version===revision)publish(jobsVersion===jobRevision?next:{...next,jobs:store.getState().value.jobs});else dirty=true;}}
 catch{/* Preserve last known progress; retry while observed. */dirty=true;failed=true;}
 finally{flight=false;if(dirty&&readers&&AppState.currentState==='active'){clearTimeout(timer);timer=setTimeout(()=>void hydrate(),failed?1000:0);}}
}
function receiveBytes(digest:string,bytes:number){
 const old=store.getState().received;
 if((old.get(digest)??0)===bytes)return;
 const received=new Map(old);
 if(bytes>0)received.set(digest,bytes);else received.delete(digest);
 store.setState({received});
}
export const transferState={getState:store.getState,getInitialState:store.getInitialState,subscribe(listener:Parameters<typeof store.subscribe>[0]){
 const off=store.subscribe(listener);
 if(readers++===0){
  const jobs=subscribeAttachmentJobProgress(row=>{if(row.owner!==owner())return;jobRevision++;
   if(row.failures||['confirming','complete','expired','cancelled'].includes(row.phase))receiveBytes(row.digest,0);
   const {owner:_owner,...value}=row;const old=store.getState().value;
   const jobs=old.jobs.filter(j=>j.digest!==row.digest);if(!['complete','expired'].includes(row.phase))jobs.push(value);
   jobs.sort((a,b)=>a.digest.localeCompare(b.digest));publish({...old,jobs});});
  const streaming=subscribeAttachmentReceiveProgress((account,_id,bytes,digest)=>{if(account===owner())receiveBytes(digest,bytes);});
  const selections=subscribeAttachmentSelections((account,_pending,published)=>{if(account===owner()){for(const selection of published??[]){handoffs.set(selection.id,selection);if(handoffs.size>64)handoffs.delete(handoffs.keys().next().value!);}revision++;void hydrate();}});
  const app=AppState.addEventListener('change',()=>{if(AppState.currentState==='active')void hydrate();});
  stop=()=>{jobs();streaming();selections();app.remove();store.setState({received:new Map()});};void hydrate();
 }
 return()=>{off();if(--readers===0){epoch++;stop?.();stop=undefined;clearTimeout(timer);}};
}};
let boundOwner=owner();
localAccount.subscribe(()=>{const next=owner();if(next&&next===boundOwner)return;boundOwner=next;epoch++;revision++;handoffs.clear();store.setState({received:new Map()});publish(empty);if(readers)void hydrate();});
function useSource(){const focused=useIsFocused(),foreground=useForeground();
 const source=useMemo(()=>({...transferState,subscribe:focused&&foreground?transferState.subscribe:()=>()=>{}}),[focused,foreground]);
 return source;
}
/** Parent screens observe pending selections only. Progress belongs to its row. */
export function useChatTransferSelections(conversation:string,group=false){
 return useStore(useSource(),useShallow(s=>s.value.selections.filter(selection=>group?selection.group?.id===conversation:!selection.group&&selection.peer===conversation)));
}
export function useTransferProgress(digest:string){return useStore(useSource(),s=>s.lookup(digest));}
export function useReceivingProgress(digest:string){return useStore(useSource(),useShallow(s=>[s.lookup(digest),s.received.get(digest)??0] as const));}

/** Called after durable rows render: there must be no empty frame between stores. */
export function acknowledgeAttachmentHandoffs(messages:RootChatMessage[]){
 const removed=new Set<string>();
 for(const [id,s] of handoffs)if(messages.some(m=>m.direction==='outgoing'&&(s.group?m.group?.id===s.group.id&&m.group.messageId===s.group.messageId:!m.group&&m.peer===s.peer&&m.id===s.id))){handoffs.delete(id);removed.add(id);}
 if(removed.size){const value=store.getState().value;publish({...value,selections:value.selections.filter(s=>!removed.has(s.id))});}
}
