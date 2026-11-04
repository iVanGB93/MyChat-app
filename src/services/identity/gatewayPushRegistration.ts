import {createPushRegistration} from './pushRegistration';
import {createEventDeadlineTask} from './eventDeadlineTask';

/** One independent lease per authenticated, connected push gateway. No discovery polling. */
export function createGatewayPushRegistration(d:{
 current():boolean;peers():string[];now():number;token():Promise<string|null>;
 request(peer:string,raw:string):Promise<string|null>;rotateToken():Promise<void>;
}){
 let stopped=false,rotation:Promise<void>|undefined,lastRotated:string|undefined;
 type Row={status:string;worker:ReturnType<typeof createPushRegistration>;task:ReturnType<typeof createEventDeadlineTask>};
 const rows=new Map<string,Row>();
 const current=()=>!stopped&&d.current();
 function invalidate(){if(!current())return;for(const row of rows.values()){row.status='waiting';row.worker.invalidate();row.task.changed();}}
 async function rotate(token:string){
  if(!current()||lastRotated===token)return rotation;
  if(rotation){await rotation;if(!current()||lastRotated===token)return;}
  lastRotated=token;
  const work=d.rotateToken().then(()=>{if(current())invalidate();});rotation=work;
  try{await work;}catch(error){if(lastRotated===token)lastRotated=undefined;throw error;}finally{if(rotation===work)rotation=undefined;}
 }
 function connected(){
  if(!current())return;
  const peers=new Set(d.peers());
  for(const [peer,row] of rows)if(!peers.has(peer)){row.task.stop();row.worker.stop();rows.delete(peer);}
  for(const peer of peers){
   if(rows.has(peer))continue;
   const row={} as Row;
   row.status='waiting';
   row.worker=createPushRegistration({current:()=>current()&&rows.get(peer)===row&&d.peers().includes(peer),now:d.now,
    token:async()=>{if(rotation)await rotation;return current()?d.token():null;},
    request:raw=>d.request(peer,raw),rotateToken:rotate,diagnostic:stage=>{row.status=stage;}});
   row.task=createEventDeadlineTask({now:d.now,immediateEvents:true,run:async()=>{await row.worker.tick();return row.worker.nextDeadline();}});
   rows.set(peer,row);row.task.changed();
  }
 }
 connected();
 return {
  connected,invalidate,
  async tick(){connected();await Promise.all([...rows.values()].map(row=>row.worker.tick()));},
  snapshot(){const gateways=[...rows].map(([peer,row])=>({peer,status:row.status})),registered=gateways.filter(g=>g.status==='registered').length;
   return {status:gateways.length&&registered===gateways.length?'registered':registered?'partial':gateways[0]?.status??'waiting',registered,available:gateways.length,gateways};},
  stop(){stopped=true;for(const row of rows.values()){row.task.stop();row.worker.stop();}rows.clear();},
  async revoke(){stopped=true;const active=[...rows.values()];for(const row of active)row.task.stop();const results=await Promise.all(active.map(row=>row.worker.revoke()));rows.clear();return results.every(Boolean);},
 };
}
