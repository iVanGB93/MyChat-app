/** Scheduling facts only. Admission, retries and delivery evidence remain owned
 * by each outbox. An active peer lane never needs a competing retry timer. */
export function messageRetryDeadline(rows:readonly {peer:string;id:string}[],now:number,minimumDelay:number,
 active:ReadonlySet<string>,retryAt:(peer:string,id:string)=>number|undefined){
 let next=Infinity;
 for(const row of rows)if(!active.has(row.peer))next=Math.min(next,Math.max(now+minimumDelay,retryAt(row.peer,row.id)??now));
 return next;
}
