/** Local scheduling only: an empty inbox is not a delivery failure. Polling is
 * retained as a safety net when push is unavailable. No protocol/data changes. */
export function createRelayPollSchedule(now:()=>number,concurrency=10,eventDriven:(peer:string)=>boolean=()=>false) {
  const states=new Map<string,{busy:boolean;next:number;empty:number;revision:number}>();
  let fastUntil=0;
  const counts={startedPasses:0,emptyPasses:0,itemPasses:0,unsuccessfulPasses:0,cooldownSkips:0,busySkips:0};
  const busy=()=>[...states.values()].filter(s=>s.busy).length;
  return {
    nextDeadline:(peers:string[])=>Math.min(Infinity,...[...new Set(peers)].slice(0,10).map(peer=>{const s=states.get(peer);return s?.busy?Infinity:s?.next??now();})),
    busy:(peer?:string)=>peer===undefined?busy()>0:states.get(peer)?.busy===true,
    prune(peers:string[]){for(const [peer,s] of states)if(!s.busy&&!peers.includes(peer))states.delete(peer);},
    begin(peer:string){
      let s=states.get(peer);
      if(!s){if(states.size>=10)return null;s={busy:false,next:0,empty:0,revision:0};states.set(peer,s);}
      if(s.busy||busy()>=concurrency){counts.busySkips++;return null;}
      if(now()<s.next){counts.cooldownSkips++;return null;}
      s.busy=true;counts.startedPasses++;const revision=s.revision;let finished=false;
      return {finish(result:{empty:boolean;item:boolean;settled?:boolean;retryAfterMs?:number}){
        if(finished)return;finished=true;s!.busy=false;
        if(result.item)counts.itemPasses++;else if(result.empty)counts.emptyPasses++;else counts.unsuccessfulPasses++;
        // A wake/reconnect during an outstanding request must not be overwritten
        // by its late empty response. Keep the single flight until it settles.
        if(s!.revision!==revision)return;
        // Explicitly drained event-capable peers sleep until reconnect, wake or
        // an acknowledged inbox-change notice. Errors/partial batches still retry.
        if(result.empty&&result.settled!==false&&eventDriven(peer)){s!.empty=0;s!.next=Infinity;return;}
        s!.empty=result.empty&&!result.item?Math.min(3,s!.empty+1):0;
        const interval=now()<fastUntil?1000:Math.min(15000,5000*2**Math.max(0,s!.empty-1));
        const retry=Number.isFinite(result.retryAfterMs)?Math.min(60000,Math.max(1000,result.retryAfterMs!)):0;
        s!.next=now()+Math.max(interval,retry);
      }};
    },
    resume(peer?:string){
      if(peer===undefined)fastUntil=now()+10000;
      for(const [key,s] of states)if(peer===undefined||key===peer){s.revision++;s.empty=0;s.next=0;}
    },
    diagnostics:()=>({...counts,activePasses:busy(),trackedRelays:states.size,eventIdlePeers:[...states.values()].filter(s=>s.next===Infinity).length,idleMaximumMs:15000}),
  };
}
