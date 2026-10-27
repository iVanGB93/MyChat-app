import {createEventDeadlineTask} from './eventDeadlineTask.ts';
/** Expiry needs time even without traffic. Lifecycle events wake a dormant owner;
 * they do not trigger a store scan before its next due time. */
export function createCustodyMaintenance(d:{
 owner():string|null;now():number;sweep():Promise<unknown>;
 changed?():void;schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void;
}){
 let owner:string|null=null,next=0;
 const task=createEventDeadlineTask({now:d.now,schedule:d.schedule,cancel:d.cancel,run:async()=>{
  const account=d.owner();if(!account){owner=null;next=0;return;}
  if(owner!==account){owner=account;next=0;}
  if(d.now()<next)return next;
  await d.sweep();
  if(d.owner()!==account){owner=null;next=0;return;}
  d.changed?.();return next=d.now()+60_000;
 }});
 return task;
}

