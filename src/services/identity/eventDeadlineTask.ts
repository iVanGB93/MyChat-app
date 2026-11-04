/** Single-flight event work. Idle work has no timer; failed work has a deadline.
 * Changes arriving during a run must survive that run's completion. */
export function createEventDeadlineTask(d:{
 now():number;run():Promise<number|void>;
 /** Mobile background events cannot depend on display-frame timers. */
 immediateEvents?:boolean;
 schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void;
}){
 const schedule=d.schedule??((run:()=>void,delay:number)=>setTimeout(run,delay)),cancel=d.cancel??((timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer));
 let stopped=false,running=false,dirty=false,eventPending=false,timer:ReturnType<typeof setTimeout>|undefined;
 let due=Infinity,eventRuns=0;
 const counts={runs:0,events:0,failures:0};
 function arm(at:number){
  if(stopped||!Number.isFinite(at))return;
  if(timer!==undefined&&due<=at)return;
  if(timer!==undefined)cancel(timer);
  due=at;timer=schedule(()=>{timer=undefined;due=Infinity;eventRuns=0;void run();},Math.max(0,Math.min(2147483647,at-d.now())));
 }
 // Events do not need a display-frame timer. Deadlines still do: retry and
 // expiry must not turn into microtask polling. One queued event coalesces bursts.
 function dispatch(){
  if(!d.immediateEvents){arm(d.now());return;}
  if(timer!==undefined){cancel(timer);timer=undefined;}
  due=d.now();if(eventPending)return;
  // Feedback from work must yield occasionally so sockets, file I/O and UI can
  // run. This is a per-turn fairness bound, not a limit on accepted events.
  if(eventRuns>=8){arm(d.now());return;}eventPending=true;
  void Promise.resolve().then(()=>{eventPending=false;if(stopped)return;due=Infinity;eventRuns++;void run();});
 }
 async function run(){
  if(stopped||running)return;
  running=true;dirty=false;counts.runs++;let next:number|void;
  try{next=await d.run();}catch{counts.failures++;next=d.now()+5000;}
  finally{running=false;}
  if(stopped)return;
  if(dirty)dispatch();else{eventRuns=0;if(typeof next==='number')arm(next);}
 }
 return {
  changed(){if(stopped)return;counts.events++;dirty=true;if(!running)dispatch();},
  diagnostics:()=>({...counts,running,dirty,nextDeadline:Number.isFinite(due)?due:null}),
  runDue(){if(stopped||running||eventPending||due>d.now())return;if(timer!==undefined)cancel(timer);timer=undefined;due=Infinity;eventRuns=0;void run();},
  stop(){stopped=true;if(timer!==undefined)cancel(timer);timer=undefined;due=Infinity;},
 };
}
