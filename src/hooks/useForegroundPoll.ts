import {useEffect,useRef} from 'react';
import {AppState} from 'react-native';

/** UI polling only: pause timers in background, serialize work, discard stale results. */
export function useForegroundPoll(work:(current:()=>boolean)=>void|Promise<void>,ms:number,enabled=true){
 const latest=useRef(work);latest.current=work;
 useEffect(()=>{
  if(!enabled)return;
  let alive=true,epoch=0,running=false,timer:ReturnType<typeof setInterval>|undefined;
  const refresh=async()=>{if(!alive||running||AppState.currentState!=='active')return;running=true;const own=epoch;
   try{await latest.current(()=>alive&&own===epoch&&AppState.currentState==='active');}catch{/* The screen owns its error presentation. */}finally{running=false;}
  };
  const change=()=>{epoch++;if(timer!==undefined)clearInterval(timer);timer=undefined;if(AppState.currentState==='active'){void refresh();timer=setInterval(()=>void refresh(),ms);}};
  const sub=AppState.addEventListener('change',change);change();
  return()=>{alive=false;epoch++;if(timer!==undefined)clearInterval(timer);sub.remove();};
 },[enabled,ms]);
}
