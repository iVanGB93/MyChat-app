import {useEffect,useRef} from 'react';
import {AppState} from 'react-native';
import {createEventDeadlineTask} from '../services/identity/eventDeadlineTask';

/** Read on entry, resume and committed changes. Changes during a read are replayed. */
export function useForegroundEvents(work:(current:()=>boolean)=>void|Promise<void>,subscribe:(changed:()=>void)=>()=>void,enabled=true,refreshKey?:string){
 const latest=useRef(work);latest.current=work;
 useEffect(()=>{
  if(!enabled)return;
  let alive=true,epoch=0;
  const task=createEventDeadlineTask({now:Date.now,run:async()=>{
   if(!alive||AppState.currentState!=='active')return;
   const own=epoch;
   await latest.current(()=>alive&&own===epoch&&AppState.currentState==='active');
  }});
  const changed=()=>{if(AppState.currentState==='active')task.changed();};
  const off=subscribe(changed),app=AppState.addEventListener('change',()=>{epoch++;changed();});
  changed();
  return()=>{alive=false;epoch++;off();app.remove();task.stop();};
 },[enabled,subscribe,refreshKey]);
}
