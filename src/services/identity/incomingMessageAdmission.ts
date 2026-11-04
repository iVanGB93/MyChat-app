type Message={from:string;id:string;text:string};
/** Direct delivery, polling and inline wakes can race. Share only concurrent,
 * byte-identical admissions in the same account; durable dedup remains authoritative. */
export function createIncomingMessageAdmission(d:{owner():string|null;receive(message:Message,relay?:string):Promise<boolean>}){
 const pending=new Map<string,Promise<boolean>>();
 return (message:Message,relay?:string):Promise<boolean>=>{
  const owner=d.owner();if(!owner)return Promise.resolve(false);
  const key=JSON.stringify([owner,message.from,message.id,message.text]);
  const existing=pending.get(key);if(existing)return existing;
  const work=Promise.resolve().then(()=>d.owner()===owner?d.receive(message,relay):false)
   .then(accepted=>accepted&&d.owner()===owner);
  // Bound only the optimization, never discard work because this map is full.
  if(pending.size<128){pending.set(key,work);void work.finally(()=>{if(pending.get(key)===work)pending.delete(key);}).catch(()=>{});}
  return work;
 };
}
