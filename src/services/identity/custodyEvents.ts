/** Authenticated inbox-change notices contain no message contents or identities.
 * ACK means reconciliation was requested, never that a message was delivered.
 * Disconnected peers reconcile on authentication; only unacknowledged notices retry.
 */
export function createCustodyEvents(d:{
 current():boolean;now():number;peers():string[];
 operation?:'inbox-changed'|'call-inbox-changed';
 request(peer:string,raw:string):Promise<string|null>;
 reconcile(peer:string):void;
 scheduled?():void;
}){
 const pending=new Map<string,{revision:number;busy:boolean;next:number;failures:number}>();
 let sequence=0,stopped=false;
 const counts={sent:0,acknowledged:0,received:0,retries:0};
 async function flush(peer:string){
  const row=pending.get(peer);
  if(stopped||!d.current()||!row||row.busy||row.next>d.now())return;
  if(!d.peers().includes(peer)){pending.delete(peer);return;}
  row.busy=true;const revision=row.revision;
  try{
   counts.sent++;
   const reply=JSON.parse(await d.request(peer,JSON.stringify({version:1,operation:d.operation??'inbox-changed',revision}))??'{}');
   if(stopped||!d.current()||pending.get(peer)!==row)return;
   if(reply.status==='accepted'&&reply.revision===revision){
    counts.acknowledged++;row.failures=0;
    if(row.revision===revision)pending.delete(peer);
    else row.next=0;
   }else{row.failures++;counts.retries++;row.next=d.now()+Math.min(60000,1000*2**Math.min(row.failures,6));}
  }catch{row.failures++;counts.retries++;row.next=d.now()+Math.min(60000,1000*2**Math.min(row.failures,6));}
  finally{row.busy=false;d.scheduled?.();}
  // A commit during the request needs another notice, even if the older one ACKed.
  if(pending.get(peer)===row&&row.next<=d.now())void flush(peer);
 }
 return {
  changed(peer:string){
   if(stopped||!d.current()||!d.peers().includes(peer))return;
   let row=pending.get(peer);
   if(!row){if(pending.size>=128)return;row={revision:0,busy:false,next:0,failures:0};pending.set(peer,row);}
   row.revision=++sequence;
   void flush(peer);
  },
  receive(peer:string,raw:string):string|null{
   let q;try{q=JSON.parse(raw);}catch{return null;}
   if(q?.operation!==(d.operation??'inbox-changed'))return null;
   if(stopped||!d.current()||raw.length>256||q.version!==1||!Number.isSafeInteger(q.revision)||q.revision<1
    ||!d.peers().includes(peer))return JSON.stringify({status:'rejected'});
   // The callback marks local work eligible synchronously, before sending ACK.
   // It must not wait for a request on the same transport.
   try{d.reconcile(peer);}catch{return JSON.stringify({status:'retry'});}
   counts.received++;return JSON.stringify({status:'accepted',revision:q.revision});
  },
  nextDeadline:()=>stopped||!d.current()?Infinity:Math.min(Infinity,...[...pending.values()].filter(r=>!r.busy).map(r=>r.next)),
  tick(){for(const peer of pending.keys())void flush(peer);},
  disconnected(peer:string){pending.delete(peer);},
  diagnostics:()=>({...counts,pending:pending.size}),
  stop(){stopped=true;pending.clear();},
 };
}
