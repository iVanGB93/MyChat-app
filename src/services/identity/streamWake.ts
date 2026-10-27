/** Coalesced single-consumer wake: an event before wait() is not lost.
 * Burst yields always yield; idle waits retain a bounded safety timer. */
export function createStreamWake(sleep?:(milliseconds:number)=>Promise<unknown>|undefined){
 let pending=false,wake:(()=>void)|undefined;
 return {
  signal(){pending=true;wake?.();},
  async wait(idle=false){
   if(idle&&pending){pending=false;return;}
   await new Promise<void>(resolve=>{
    let timer:ReturnType<typeof setTimeout>|undefined,finished=false;
    const finish=()=>{if(finished)return;finished=true;if(timer!==undefined)clearTimeout(timer);if(wake===finish)wake=undefined;if(idle)pending=false;resolve();};
    if(idle)wake=finish;
    const native=sleep?.(idle?100:0);
    if(native)void native.then(finish,finish);
    else timer=setTimeout(finish,idle?100:0);
   });
  },
 };
}
