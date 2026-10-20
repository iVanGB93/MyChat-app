/** Native deadlines continue while Android suspends frame-based JS timers.
 * Only call workers use these: no idle polling or permanent background lease. */
export function createNativeCallDeadline(wait:(ms:number)=>Promise<void>){
 let next=0;const pending=new Set<number>();
 return {
  schedule(run:()=>void,delay:number):ReturnType<typeof setTimeout>{
   const id=++next;pending.add(id);
   void wait(Math.max(0,Math.min(65000,Math.ceil(delay)))).then(()=>{if(pending.delete(id))run();}).catch(()=>{if(pending.delete(id))run();});
   return id as unknown as ReturnType<typeof setTimeout>;
  },
  cancel(timer:ReturnType<typeof setTimeout>){pending.delete(timer as unknown as number);},
 };
}
