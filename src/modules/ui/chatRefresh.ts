import {storageRetryDelay} from '../storage/storageReadSafety';
/** One focused screen: coalesce committed changes, retain a safety poll, and
 * never replace the last good view with an empty view on a storage failure. */
export function createChatRefresh<T>(d:{owner():string|null;read(owner:string):Promise<T|undefined>;
 fresh?(owner:string,value:T):boolean;
 ready(value:T,milliseconds:number):void;failed(error:unknown):void;
 now?:()=>number;schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;cancel?:(timer:ReturnType<typeof setTimeout>)=>void}){
 const now=d.now??Date.now,schedule=d.schedule??((run:()=>void,delay:number)=>setTimeout(run,delay)),cancel=d.cancel??((timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer));
 let stopped=false,running=false,dirty=false,failures=0,timer:ReturnType<typeof setTimeout>|undefined;
 const arm=(delay:number)=>{timer=schedule(()=>{timer=undefined;void refresh();},delay);};
 async function refresh(){
  if(stopped||running)return;running=true;dirty=false;const owner=d.owner(),start=now();
  try{if(!owner)return;const value=await d.read(owner);
   if(stopped||d.owner()!==owner)return;
   // A consistent read may precede a newer commit. Show it, then catch up,
   // rather than starving the screen while messages continuously arrive.
   if(value!==undefined){d.ready(value,now()-start);if(d.fresh&&!d.fresh(owner,value))dirty=true;}
   else dirty=true;
   failures=0;
  }catch(error){if(!stopped&&d.owner()===owner){failures++;d.failed(error);}}
  finally{running=false;if(!stopped)arm(dirty?0:failures?storageRetryDelay(failures):5000);}
 }
 function wake(owner:string){if(stopped||owner!==d.owner())return;dirty=true;
  if(!running){if(timer!==undefined)cancel(timer);arm(0);}
 }
 arm(0);
 return {wake,stop(){stopped=true;if(timer!==undefined)cancel(timer);}};
}
