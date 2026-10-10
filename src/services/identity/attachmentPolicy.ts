import {attachmentDigest} from './attachmentProtocol.ts';
import {rootGroupAllowed} from './rootGroups.ts';
import type {RootChatState} from './rootChatTypes.ts';
/** One immutable policy index per ledger snapshot, not a history scan per chunk guard. */
export function indexAttachmentPolicy(snapshot:RootChatState,owner:string){
 const seen=new Set<string>(),allowed=new Set<string>();
 for(const message of snapshot.messages){
  if(!message.attachment)continue;
  const digest=attachmentDigest(message.attachment.manifest);
  // Match the prior Array.find behavior if duplicate references exist.
  if(seen.has(digest))continue;seen.add(digest);
  if(!message.group||rootGroupAllowed(snapshot,owner,message.peer,message.group)&&snapshot.groups?.find(g=>g.id===message.group!.id)?.accepted)allowed.add(digest);
 }
 return (job:{owner:string;digest:string})=>job.owner===owner&&allowed.has(job.digest);
}
