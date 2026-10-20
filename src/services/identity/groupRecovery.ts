/** Reintroduce group metadata when a member reconnects, including through another
 * group member. Rate-limit flapping peers; failed durable queue writes retry.
 */
export function createGroupRecovery(d:{owner():string|null;peers():string[];now():number;random():Promise<string>;recover(peer:string,id:string):Promise<void>}){
 let owner:string|null=null,busy=false;
 const seen=new Set<string>(),last=new Map<string,number>();
 return {
 connected(peer:string){seen.delete(peer);},
 nextDeadline(){
  if(!d.owner())return Infinity;
  return Math.min(Infinity,...d.peers().filter(p=>p!==d.owner()&&!seen.has(p)).map(p=>Math.max(d.now(),(last.get(p)??-Infinity)+60000)));
 },
 async tick(){
  if(busy)return;busy=true;
  try{
   const account=d.owner();if(account!==owner){owner=account;seen.clear();last.clear();}if(!account)return;
   const peers=new Set(d.peers().filter(p=>p!==account));
   for(const peer of seen)if(!peers.has(peer))seen.delete(peer);
   for(const peer of peers){
    if(seen.has(peer)||d.now()-(last.get(peer)??-Infinity)<60_000)continue;
    const id=await d.random();if(d.owner()!==account)return;
    await d.recover(peer,id);if(d.owner()!==account)return;
    seen.add(peer);last.set(peer,d.now());
    if(last.size>256)last.delete(last.keys().next().value!);
   }
  }finally{busy=false;}
 }};
}
