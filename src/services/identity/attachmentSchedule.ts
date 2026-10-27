import type {AttachmentJob} from './attachmentTypes.ts';
/** Active byte movement gets three turns per background receipt lookup.
 * Separate cursors keep both lanes fair even when jobs enter/leave the queue. */
export function createAttachmentWorkSelection(){
 let activeCursor=0,waitingCursor=0,turn=0;
 return (jobs:AttachmentJob[])=>{
  const waiting=jobs.filter(j=>j.direction==='outgoing'&&j.phase==='confirming'&&!j.receipt);
  const active=jobs.filter(j=>!(j.direction==='outgoing'&&j.phase==='confirming'&&!j.receipt));
  if(!active.length)return waiting.length?waiting[waitingCursor++%waiting.length]:undefined;
  if(!waiting.length){turn=0;return active[activeCursor++%active.length];}
  return ++turn%4===0?waiting[waitingCursor++%waiting.length]:active[activeCursor++%active.length];
 };
}
/** No queued work means no clock. Blocked/disconnected jobs only need expiry. */
export function attachmentWorkDelay(jobs:AttachmentJob[],now:number,canRun:(job:AttachmentJob)=>boolean){
 let delay=Infinity;
 for(const job of jobs)if(!['complete','expired','cancelled'].includes(job.phase)){
  delay=Math.min(delay,Math.max(200,job.descriptor.manifest.expires-now));
  if(canRun(job))delay=Math.min(delay,Math.max(500,job.next-now));
 }
 return delay;
}
/** Events invalidate descriptor reconciliation; productive bursts reuse it.
 * The bounded recovery interval is checked on work, not an extra polling timer.
 * Mark only a fully completed walk. An event during the walk remains pending. */
export function createAttachmentReconcileGate(){
 let scanned:number|undefined,after=0;
 return {needed:(revision:number,now:number)=>scanned!==revision||now>=after,
  complete(revision:number,now:number){scanned=revision;after=now+30000;},
  clear(){scanned=undefined;after=0;}};
}

/** Optional readiness is a hint, never delivery evidence. A slow authenticated
 * request may finish in its transport, but cannot stall custody past the budget.
 * Coalesce still-running probes and bound retained work; stop releases waiters. */
export function createAttachmentReadinessProbe(budget=750){
 const pending=new Map<string,Promise<unknown>>(),waiting=new Set<()=>void>();
 return {
  async read<T>(key:string,work:()=>Promise<T>):Promise<T|undefined>{
   if(pending.has(key)||pending.size>=32)return undefined;
   const task=Promise.resolve().then(work);pending.set(key,task);
   const settled=task.catch(()=>undefined).finally(()=>{if(pending.get(key)===task)pending.delete(key);});
   let timer:ReturnType<typeof setTimeout>|undefined,release:()=>void=()=>{};
   const deadline=new Promise<undefined>(resolve=>{release=()=>resolve(undefined);waiting.add(release);timer=setTimeout(release,budget);});
   try{return await Promise.race([settled,deadline]);}
   finally{if(timer!==undefined)clearTimeout(timer);waiting.delete(release);}
  },
  clear(){for(const release of waiting)release();waiting.clear();}
 };
}
