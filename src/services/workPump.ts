/** Single-flight, coalesced work. Explicit deadlines allow empty queues to sleep;
 * adapters without deadline support retain legacy backoff. No payloads. */
export function createWorkPump(d:{run():Promise<boolean|void>;idleMilliseconds:number;maximumIdleMilliseconds:number;
 nextDelay?:()=>number|Promise<number>;
 schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void}){
 const schedule=d.schedule??((run:()=>void,delay:number)=>setTimeout(run,delay)),cancel=d.cancel??((timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer));
 let timer:ReturnType<typeof setTimeout>|undefined,running=false,stopped=false,dirty=false,idle=d.idleMilliseconds;
 const counts={runs:0,wakes:0,progress:0,failures:0};
 function arm(delay:number){if(Number.isFinite(delay))timer=schedule(()=>{timer=undefined;void pump();},Math.max(0,Math.min(2147483647,delay)));}
 async function pump(){
  if(stopped||running)return;running=true;dirty=false;counts.runs++;
  let progressed=false,next:number|undefined;
  try{progressed=!!await d.run();if(progressed)counts.progress++;if(!progressed&&d.nextDelay)next=await d.nextDelay();}catch{counts.failures++;next=d.maximumIdleMilliseconds;}
  finally{
   running=false;
   if(!stopped){if(dirty||progressed){idle=d.idleMilliseconds;arm(0);}else{arm(next??idle);idle=Math.min(d.maximumIdleMilliseconds,idle*2);}}
  }
 }
 function wake(){if(stopped)return;counts.wakes++;idle=d.idleMilliseconds;dirty=true;
  if(!running&&timer===undefined)arm(0);
  else if(!running){cancel(timer!);arm(0);}
 }
 arm(0);
 return {wake,stop(){stopped=true;if(timer!==undefined)cancel(timer);timer=undefined;},snapshot:()=>({...counts,running,stopped,scheduled:timer!==undefined})};
}
