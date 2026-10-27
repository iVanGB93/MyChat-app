import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {useMemo} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useForeground} from './liveState';
import {localAccount} from '../identity';
import {rootAttachmentProgress,subscribeAttachmentSelections} from '../../services/identity/rootAttachmentSelections';
import {subscribeAttachmentJobProgress} from '../../services/identity/mobileAttachmentJobs';
import {retainEqual} from '../../services/identity/sharedState';
import {createAttachmentProgressLookup} from '../../utils/attachment-progress';

type Progress=Awaited<ReturnType<typeof rootAttachmentProgress>>;
const empty:Progress={jobs:[],selections:[]};
type Lookup=(digest:string)=>Progress['jobs'][number]|undefined;
const makeLookup=(jobs:Progress['jobs'])=>createAttachmentProgressLookup(jobs,(digest:string)=>digest);
const store=createStore<{value:Progress;lookup:Lookup}>(()=>({value:empty,lookup:makeLookup(empty.jobs)}));
let readers=0,epoch=0,revision=0,stop:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
let flight=false,dirty=false;
const owner=()=>localAccount.status().state==='unlocked'?localAccount.status().account:null;
function publish(value:Progress){const previous=store.getState(),next=retainEqual(previous.value,value);if(next!==previous.value)store.setState({value:next,lookup:next.jobs===previous.value.jobs?previous.lookup:makeLookup(next.jobs)});}
async function hydrate(){
 if(!readers||AppState.currentState!=='active')return;
 if(flight){dirty=true;return;}flight=true;dirty=false;
 const account=owner(),generation=epoch,version=revision;
 try{const next=await rootAttachmentProgress();if(account===owner()&&generation===epoch){if(version===revision)publish(next);else dirty=true;}}
 catch{/* Preserve last known progress; retry while observed. */dirty=true;}
 finally{flight=false;if(dirty&&readers){clearTimeout(timer);timer=setTimeout(()=>void hydrate(),1000);}}
}
export const transferState={getState:store.getState,getInitialState:store.getInitialState,subscribe(listener:Parameters<typeof store.subscribe>[0]){
 const off=store.subscribe(listener);
 if(readers++===0){
  const jobs=subscribeAttachmentJobProgress(row=>{if(row.owner!==owner())return;revision++;
   const {owner:_owner,...value}=row;const old=store.getState().value;
   const jobs=old.jobs.filter(j=>j.digest!==row.digest);if(!['complete','expired'].includes(row.phase))jobs.push(value);
   jobs.sort((a,b)=>a.digest.localeCompare(b.digest));publish({...old,jobs});});
  const selections=subscribeAttachmentSelections(account=>{if(account===owner()){revision++;void hydrate();}});
  const app=AppState.addEventListener('change',()=>{if(AppState.currentState==='active')void hydrate();});
  stop=()=>{jobs();selections();app.remove();};void hydrate();
 }
 return()=>{off();if(--readers===0){epoch++;stop?.();stop=undefined;clearTimeout(timer);}};
}};
let boundOwner=owner();
localAccount.subscribe(()=>{const next=owner();if(next&&next===boundOwner)return;boundOwner=next;epoch++;revision++;publish(empty);if(readers)void hydrate();});
function useSource(){const focused=useIsFocused(),foreground=useForeground();
 const source=useMemo(()=>({...transferState,subscribe:focused&&foreground?transferState.subscribe:()=>()=>{}}),[focused,foreground]);
 return source;
}
/** Parent screens observe pending selections only. Progress belongs to its row. */
export function useTransferState(){const source=useSource(),selections=useStore(source,s=>s.value.selections);return useMemo(()=>({selections}),[selections]);}
export function useTransferProgress(digest:string){return useStore(useSource(),s=>s.lookup(digest));}
