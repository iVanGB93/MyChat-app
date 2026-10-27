import {attachmentDigest} from './attachmentProtocol.ts';
import {rootGroupAllowed} from './rootGroups.ts';
import type {RootChatState} from './rootChatTypes.ts';
/** Retry one invalidated admission read against the new ledger revision. */
export async function readAttachmentAdmissionSnapshot<T>(read:()=>Promise<T|null|undefined>,current:()=>boolean):Promise<T|null>{
 for(let attempt=0;attempt<2&&current();attempt++){
  const value=await read();if(!current())return null;if(value)return value;
 }
 return null;
}
/** Runtime-local metadata only. A write or account transition invalidates reuse. */
export function createAttachmentSnapshot(d:{owner():string|null;revision(owner:string):number;read():Promise<RootChatState>;
 readVersioned?():Promise<{state:RootChatState;revision:number}|null>}){
 let epoch=0,cached:{owner:string;revision:number;state:RootChatState}|undefined;
 let flight:{owner:string;revision:number;generation:number;promise:Promise<typeof cached|null>}|undefined;
 return {
  clear(){epoch++;cached=undefined;flight=undefined;},
  // Only the ledger's durable-commit event may supply this read-only state.
  // Any later write or account change invalidates it through the normal checks.
  committed(owner:string,revision:number,state:RootChatState){
   if(d.owner()!==owner||d.revision(owner)!==revision)return false;
   cached={owner,revision,state};return true;
  },
  async read(){
   const owner=d.owner();if(!owner){cached=undefined;return null;}
   const revision=d.revision(owner),generation=epoch;
   if(cached?.owner===owner&&cached.revision===revision)return cached;
   if(flight?.owner===owner&&flight.revision===revision&&flight.generation===generation)return flight.promise;
   const promise=(async()=>{
    const value=d.readVersioned?await d.readVersioned():{state:await d.read(),revision};
    if(!value||generation!==epoch||d.owner()!==owner||d.revision(owner)!==value.revision)return null;
    return cached={owner,revision:value.revision,state:value.state};
   })();
   const entry={owner,revision,generation,promise};flight=entry;
   try{return await promise;}finally{if(flight===entry)flight=undefined;}
  },
 };
}
/** One immutable policy index per ledger snapshot, not a history scan per chunk guard. */
export function indexAttachmentPolicy(snapshot:RootChatState,owner:string){
 const seen=new Set<string>(),allowed=new Set<string>();
 for(const message of snapshot.messages){
  if(!message.attachment||('networkCancelledAt' in message&&message.networkCancelledAt!==undefined))continue;
  const digest=attachmentDigest(message.attachment.manifest);
  // Match the prior Array.find behavior if duplicate references exist.
  if(seen.has(digest))continue;seen.add(digest);
  if(!message.group||rootGroupAllowed(snapshot,owner,message.peer,message.group)&&snapshot.groups?.find(g=>g.id===message.group!.id)?.accepted)allowed.add(digest);
 }
 return (job:{owner:string;digest:string})=>job.owner===owner&&allowed.has(job.digest);
}
