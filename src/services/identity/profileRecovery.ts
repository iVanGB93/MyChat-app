/** Ask known chat partners for changed avatars, including after local recovery.
 * One durable request per tick; never broadcasts to unrelated routing peers. */
export function createProfileRecovery(d:{owner():string|null;peers():Promise<string[]>;known(peer:string):Promise<string|null>;request(peer:string,id:string,known:string|null):Promise<void>;random():Promise<string>;now():number}){
 let owner:string|null=null,busy=false;const last=new Map<string,number>();
 return {async tick(){if(busy)return;busy=true;try{
  const account=d.owner();if(owner!==account){owner=account;last.clear();}if(!account)return;
  const peers=await d.peers();if(d.owner()!==account)return;
  for(const p of last.keys())if(!peers.includes(p))last.delete(p);
  const peer=peers.find(p=>d.now()-(last.get(p)??-Infinity)>=30*60*1000);if(!peer)return;
  const known=await d.known(peer),id=await d.random();if(d.owner()!==account)return;
  await d.request(peer,id,known);if(d.owner()===account)last.set(peer,d.now());
 }finally{busy=false;}}};
}
