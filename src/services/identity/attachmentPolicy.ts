import {attachmentDigest} from './attachmentProtocol.ts';
import {rootGroupAllowed} from './rootGroups.ts';
import type {RootChatState} from './rootChatTypes.ts';
/** Runtime-local metadata only. A write or account transition invalidates reuse. */
export function createAttachmentSnapshot(d:{owner():string|null;revision(owner:string):number;read():Promise<RootChatState>}){
 let epoch=0,cached:{owner:string;revision:number;state:RootChatState}|undefined;
 return {
  clear(){epoch++;cached=undefined;},
  async read(){
   const owner=d.owner();if(!owner){cached=undefined;return null;}
   const revision=d.revision(owner),generation=epoch;
   if(cached?.owner===owner&&cached.revision===revision)return cached;
   const state=await d.read();
   if(generation!==epoch||d.owner()!==owner||d.revision(owner)!==revision)return null;
   return cached={owner,revision,state};
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
