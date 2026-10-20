/** Single-flight event work. Idle work has no timer; failed work has a deadline.
 * Changes arriving during a run must survive that run's completion. */
export function createEventDeadlineTask(d:{
 now():number;run():Promise<number|void>;
 schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void;
}){
 const schedule=d.schedule??((run:()=>void,delay:number)=>setTimeout(run,delay)),cancel=d.cancel??((timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer));
 let stopped=false,running=false,dirty=false,timer:ReturnType<typeof setTimeout>|undefined;
 let due=Infinity;
 const counts={runs:0,events:0,failures:0};
 function arm(at:number){
  if(stopped||!Number.isFinite(at))return;
  if(timer!==undefined&&due<=at)return;
  if(timer!==undefined)cancel(timer);
  due=at;timer=schedule(()=>{timer=undefined;due=Infinity;void run();},Math.max(0,Math.min(2147483647,at-d.now())));
 }
 async function run(){
  if(stopped||running)return;
  running=true;dirty=false;counts.runs++;let next:number|void;
  try{next=await d.run();}catch{counts.failures++;next=d.now()+5000;}
  finally{running=false;}
  if(stopped)return;
  if(dirty)arm(d.now());else if(typeof next==='number')arm(next);
 }
 return {
  changed(){if(stopped)return;counts.events++;dirty=true;if(!running)arm(d.now());},
  diagnostics:()=>({...counts,running,dirty,nextDeadline:Number.isFinite(due)?due:null}),
  runDue(){if(stopped||running||due>d.now())return;if(timer!==undefined)cancel(timer);timer=undefined;due=Infinity;void run();},
  stop(){stopped=true;if(timer!==undefined)cancel(timer);timer=undefined;},
 };
}
