/** Local, coalesced invalidation. No timer or work when nobody is observing. */
export function createChangeSignal(delay=200){
 const listeners=new Set<()=>void>();let timer:ReturnType<typeof setTimeout>|undefined;
 return {subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);if(!listeners.size){clearTimeout(timer);timer=undefined;}};},
  changed(){if(!listeners.size||timer!==undefined)return;timer=setTimeout(()=>{timer=undefined;for(const fn of listeners)try{fn();}catch{}},delay);}};
}
