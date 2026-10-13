export type DeliveryStage='pending'|'stored'|'delivered'|'read';
export type DiagnosticEvent=DeliveryStage|'wake_verified'|'notification_requested'|'recovery_started'|'recovery_finished';
type Row={trace:string;at:number;event:DiagnosticEvent;direction:'incoming'|'outgoing';initialObservation:boolean;foreground:boolean|null};
/** Bounded, volatile, content-free observations. Raw correlation keys never leave this instance. */
export function createDeliveryDiagnostics(now=Date.now){
 let enabled=false,until=0,startedAt:number|null=null,sequence=0,dropped=0;
 const tracked=new Map<string,{trace:string;stage?:DeliveryStage}>(),events:Row[]=[];
 const active=()=>enabled&&now()<until;
 function entry(key:string){let row=tracked.get(key);if(!row){if(tracked.size>=256)return undefined;row={trace:'m'+(++sequence)};tracked.set(key,row);}return row;}
 function append(row:Row){if(events.length>=256){events.shift();dropped++;}events.push(row);}
 return {
  active,
  start(){enabled=true;startedAt=now();until=startedAt+15*60*1000;sequence=0;dropped=0;tracked.clear();events.length=0;},
  stop(){enabled=false;tracked.clear();},
  clear(){enabled=false;startedAt=null;tracked.clear();events.length=0;dropped=0;},
  observe(key:string,stage:DeliveryStage,direction:'incoming'|'outgoing',foreground:boolean|null=null){if(!active())return;const row=entry(key);if(!row||row.stage===stage)return;const initialObservation=row.stage===undefined;row.stage=stage;append({trace:row.trace,at:now(),event:stage,direction,initialObservation,foreground});},
  event(key:string,event:Exclude<DiagnosticEvent,DeliveryStage>,direction:'incoming'|'outgoing',foreground:boolean|null=null){if(!active())return;const row=entry(key);if(row)append({trace:row.trace,at:now(),event,direction,initialObservation:false,foreground});},
  snapshot(){return {schemaVersion:1,active:active(),startedAt,expiresAt:startedAt===null?null:until,observedAt:now(),droppedEvents:dropped,
   timestampMeaning:'Local observation time, not remote occurrence time. Initial observations do not reconstruct past transitions. Read reflects user behavior, not delivery latency. Notification requested does not prove visible display.',
   scope:'This capture only; temporary aliases cannot be joined automatically across devices. No contents, accounts, message IDs, tokens, addresses, or contact names.',
   states:{pending:'Pending',stored:'Stored on Axonic network; not device delivery',delivered:'Received by the destination device',read:'Read by recipient'},events:events.map(e=>({...e}))};},
 };
}
