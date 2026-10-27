/** Single-flight, coalesced work. Explicit deadlines allow empty queues to sleep;
 * adapters without deadline support retain legacy backoff. No payloads. */
export function createWorkPump(d:{run():Promise<boolean|void>;idleMilliseconds:number;maximumIdleMilliseconds:number;
 nextDelay?:()=>number|Promise<number>;now?:()=>number;
 schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void}){
 const schedule=d.schedule??((run:()=>void,delay:number)=>setTimeout(run,delay)),cancel=d.cancel??((timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer));
 const now=d.now??Date.now;
 let timer:ReturnType<typeof setTimeout>|undefined,running=false,stopped=false,dirty=false,urgent=false,eventPending=false,idle=d.idleMilliseconds,due=Infinity;
 const counts={runs:0,wakes:0,progress:0,failures:0};
 function arm(delay:number){due=Infinity;if(Number.isFinite(delay)){const wait=Math.max(0,Math.min(2147483647,delay));due=now()+wait;timer=schedule(()=>{timer=undefined;due=Infinity;void pump();},wait);}}
 // A real event can dispatch without a frame timer, including when it arrived
 // during an in-flight write. Coalesce onto one microtask; never run reentrantly.
 function dispatchEvent(){
  if(timer!==undefined){cancel(timer);timer=undefined;}
  if(eventPending)return;eventPending=true;due=now();
  void Promise.resolve().then(()=>{eventPending=false;if(stopped)return;due=Infinity;void pump();});
 }
 async function pump(){
  if(stopped||running)return;running=true;dirty=false;urgent=false;counts.runs++;
  let progressed=false,next:number|undefined;
  try{progressed=!!await d.run();if(progressed)counts.progress++;if(!progressed&&d.nextDelay)next=await d.nextDelay();}catch{counts.failures++;next=d.maximumIdleMilliseconds;}
  finally{
   running=false;
   if(!stopped){if(dirty||progressed){idle=d.idleMilliseconds;if(dirty&&urgent)dispatchEvent();else arm(0);}else{arm(next??idle);idle=Math.min(d.maximumIdleMilliseconds,idle*2);}}
  }
 }
 function wake(){if(stopped)return;counts.wakes++;idle=d.idleMilliseconds;dirty=true;
  if(eventPending)return;
  if(!running&&timer===undefined)arm(0);
  else if(!running){cancel(timer!);arm(0);}
 }
 arm(0);
 function wakeNow(){if(stopped)return;counts.wakes++;idle=d.idleMilliseconds;dirty=true;urgent=true;if(!running)dispatchEvent();}
 return {wake,wakeNow,runDue(){if(stopped||running||eventPending||due>now())return;if(timer!==undefined)cancel(timer);timer=undefined;due=Infinity;void pump();},stop(){stopped=true;if(timer!==undefined)cancel(timer);timer=undefined;due=Infinity;},snapshot:()=>({...counts,running,stopped,scheduled:timer!==undefined||!stopped&&eventPending}),
  diagnostics:()=>({runs:counts.runs,events:counts.wakes,failures:counts.failures,running,dirty,nextDeadline:Number.isFinite(due)?due:null})};
}
