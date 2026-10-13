/** Cache only derived UI state, never the durable ledger or its mutable objects. */
export function createChatSnapshotCache<T>(d:{revision(owner:string):number;read(owner:string):Promise<T>;current(owner:string):boolean}){
 let cached:{owner:string;revision:number;value:T}|undefined;
 let flight:{owner:string;promise:Promise<T|undefined>}|undefined;
 let epoch=0;
 return {
  clear(){epoch++;cached=undefined;flight=undefined;},
  peek(owner:string){return d.current(owner)&&cached?.owner===owner&&cached.revision===d.revision(owner)?cached.value:undefined;},
  read(owner:string):Promise<T|undefined>{
   if(!d.current(owner)){cached=undefined;return Promise.resolve(undefined);}
   if(cached?.owner===owner&&cached.revision===d.revision(owner))return Promise.resolve(cached.value);
   if(flight?.owner===owner)return flight.promise;
   const started=epoch;
   const promise=(async()=>{
    const revision=d.revision(owner),value=await d.read(owner);
    if(started!==epoch||!d.current(owner))return undefined;
    // A racing write must cause another read, never label older data with its revision.
    if(revision===d.revision(owner))cached={owner,revision,value};
    return value;
   })();
   flight={owner,promise};
   void promise.finally(()=>{if(flight?.promise===promise)flight=undefined;}).catch(()=>{});
   return promise;
  },
 };
}
