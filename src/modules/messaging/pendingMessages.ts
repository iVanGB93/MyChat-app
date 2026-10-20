import type {RootChatState,RootChatReply,RootChatMessage} from '../../services/identity/rootChatTypes';
export type PendingText={owner:string;id:string;peer:string;text:string;reply?:RootChatReply;group?:boolean;at:number};
/** Presentation only. Never passed to encryption, relay, receipts or durable storage. */
export function createPendingMessages(){
 const rows=new Map<string,PendingText>(),listeners=new Set<()=>void>();let revision=0;
 const timings=new Map<string,{started:number;readyMs:number;layoutMs?:number}>();
 const key=(r:PendingText)=>r.owner+':'+r.id;
 const changed=()=>{revision++;for(const fn of listeners)fn();};
 const contains=(s:RootChatState,r:PendingText)=>s.messages.some(m=>m.direction==='outgoing'&&(r.group?m.group?.id===r.peer&&m.group.messageId===r.id:!m.group&&m.peer===r.peer&&m.id===r.id));
 return {
  subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  version:()=>revision,
  begin(row:PendingText){if(rows.size>=256)throw Error('Please wait for pending messages to save');rows.set(key(row),row);if(timings.size>=32)timings.delete(timings.keys().next().value!);timings.set(key(row),{started:row.at,readyMs:Date.now()-row.at});changed();return()=>{if(rows.delete(key(row)))changed();};},
  laidOut(owner:string|null,id:string){const t=timings.get(owner+':'+id);if(t&&t.layoutMs===undefined)t.layoutMs=Date.now()-t.started;},
  diagnostics:()=>[...timings.values()].map(({readyMs,layoutMs})=>({readyMs,layoutMs})),
  clear(){timings.clear();if(rows.size){rows.clear();changed();}},
  reconcile(owner:string,s:RootChatState){let removed=false;for(const [k,r] of rows)if(r.owner===owner&&contains(s,r)){rows.delete(k);removed=true;}if(removed)changed();},
  merge(owner:string|null,s:RootChatState):RootChatState{
   if(!owner||!rows.size)return s;const extra:RootChatMessage[]=[];
   for(const r of rows.values()){
    if(r.owner!==owner||contains(s,r))continue;
    const group=r.group?s.groups?.find(g=>g.id===r.peer):undefined;
    if(r.group&&!group)continue;
    extra.push({id:r.id,peer:r.group?owner:r.peer,text:r.text,at:r.at,direction:'outgoing',status:'pending',localPending:true,...(r.reply?{reply:r.reply}:{}),...(group?{group:{id:group.id,revision:group.revision,messageId:r.id}}:{})});
   }
   return extra.length?{...s,messages:[...s.messages,...extra]}:s;
  },
 };
}
export const pendingMessages=createPendingMessages();
