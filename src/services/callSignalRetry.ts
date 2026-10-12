/** Bounded retries for essential SDP; optional trickle ICE is best-effort. */
export async function deliverCallSignal(d:{kind:string;send():Promise<boolean>;current():boolean;wait(ms:number):Promise<void>;now():number}){
 const until=d.now()+25000;
 for(let attempt=0;attempt<12&&d.current();attempt++){
  try{if(await d.send())return d.current();}catch{/* A route can reconnect during handoff. */}
  if(d.kind==='ice-candidate'||!d.current()||d.now()>=until)return false;
  await d.wait(1500);
 }
 return false;
}
