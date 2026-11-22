/** The UI owns a foreground lease, not an always-on background service.
 * Notification recovery owns independent bounded leases on the shared runtime.
 * Keep an existing call alive through backgrounding; release on its terminal event. */
export function createForegroundNetworkLease<T extends {stop():void;resume():void;finishStartup?():void}>(start:()=>T){
 let foreground=false,call=false,stopped=false,reconciling=false,dirty=false,runtime:T|null=null;
 function reconcile(){
  dirty=true;if(reconciling)return;reconciling=true;
  try{while(dirty){dirty=false;
   if(!stopped&&(foreground||call)){if(!runtime)runtime=start();}
   else if(runtime){const old=runtime;runtime=null;old.stop();}
  }}finally{reconciling=false;}
 }
 const ready=()=>runtime?.finishStartup?.();
 return {
  activity(active:boolean){const resumed=active&&!foreground;foreground=active;reconcile();if(resumed)runtime?.resume();},
  ready,
  call(active:boolean){call=active;reconcile();if(active)ready();},
  stop(){stopped=true;reconcile();},
 };
}
