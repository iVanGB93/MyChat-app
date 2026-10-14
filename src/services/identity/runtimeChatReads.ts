import type {RootChatState} from './rootChatTypes.ts';
/** Shared read-only view for runtime consumers. Never used by ledger mutations. */
export function createRuntimeChatReads(d:{owner():string|null;revision(owner:string):number;read():Promise<RootChatState>}){
 let epoch=0,cached:{owner:string;revision:number;state:RootChatState}|undefined;
 let flight:{owner:string;revision:number;promise:Promise<RootChatState>}|undefined;
 return {
  clear(){epoch++;cached=undefined;flight=undefined;},
  read():Promise<RootChatState>{
   const owner=d.owner();if(!owner)return Promise.reject(Error('Account unavailable'));
   const revision=d.revision(owner),generation=epoch;
   if(cached?.owner===owner&&cached.revision===revision)return Promise.resolve(cached.state);
   if(flight?.owner===owner&&flight.revision===revision)return flight.promise;
   const promise=d.read().then(state=>{
    if(generation!==epoch||d.owner()!==owner)throw Error('Account changed');
    if(d.revision(owner)===revision)cached={owner,revision,state};
    return state;
   });
   flight={owner,revision,promise};void promise.then(()=>{if(flight?.promise===promise)flight=undefined;},()=>{if(flight?.promise===promise)flight=undefined;});return promise;
  },
 };
}

/** Successful capability persistence is repeated only when owner/peer sets change. */
export function createPeerCapabilityWriter(d:{owner():string|null;write(profile:string[],timestamp:string[],group:string[]):Promise<void>}){
 let saved='',busy=false,epoch=0;
 return {clear(){epoch++;saved='';},async update(profile:string[],timestamp:string[],group:string[]=[]){
  const owner=d.owner();if(!owner||busy)return;
  const p=[...new Set(profile)].sort(),t=[...new Set(timestamp)].sort(),g=[...new Set(group)].sort(),key=JSON.stringify([owner,p,t,g]);
  if(saved===key)return;busy=true;const generation=epoch;
  try{await d.write(p,t,g);if(generation===epoch&&d.owner()===owner)saved=key;}finally{busy=false;}
 }};
}
