import type {CustodyRow} from './custodyService.ts';
import type {GroupCustodyRow} from './groupCustodyService.ts';
import type {AttachmentCustodyRow} from './attachmentCustody.ts';
import {attachmentContentDigest} from './attachmentProtocol.ts';

export type RelayPacketMetadata={key:string;kind:string;state:string;storage:'disk'|'memory';id:string;digest?:string;sender?:string;recipient?:string;createdAt?:number;expiresAt?:number;source?:string;replicatedTo?:string;declaredBytes?:number;checkpointChunks?:number;chunkCount?:number;firstChunk?:number;lastChunk?:number;storedBytes?:number};
export type RelayChunkMetadata={digest:string;chunkCount:number;firstChunk:number;lastChunk:number;storedBytes:number};
export type RelayInventory={observedAt:number;rows:RelayPacketMetadata[]};
/** Allowlisted projection only. Never spread stored records into diagnostics.
 * Expired records remain visible until normal protocol maintenance removes them. */
export function relayInventory(owner:string,now:number,custody:readonly CustodyRow[],groups:readonly GroupCustodyRow[],media:readonly AttachmentCustodyRow[],chunks:readonly RelayChunkMetadata[],calls:readonly RelayPacketMetadata[]=[]):RelayInventory{
 const rows:RelayPacketMetadata[]=[],foreign=(sender:string,recipient:string)=>sender!==owner&&recipient!==owner;
 const add=(row:RelayPacketMetadata)=>rows.push({...row,state:row.expiresAt!==undefined&&row.expiresAt<=now?'expired · '+row.state:row.state});
 for(const r of custody)if(foreign(r.sender,r.recipient))add({key:'message:'+r.sender+':'+r.id,kind:r.packet?.kind==='envelope'?'message envelope':r.packet?'message receipt':'message cleanup marker',state:r.packet?.kind==='envelope'?'held':r.packet?'receipt held':'consumed (no payload)',storage:'disk',id:r.id,digest:r.digest,sender:r.sender,recipient:r.recipient,expiresAt:r.expires,...(r.packet?.kind==='envelope'?{createdAt:r.packet.created}: {})});
 for(const r of groups){
  const recipients=r.recipients.filter(v=>foreign(r.sender,v.recipient));if(!recipients.length)continue;
  if(r.payload)add({key:'group:'+r.digest,kind:'group shared payload',state:r.accepted?'held':'staged (not accepted)',storage:'disk',id:r.id,digest:r.digest,sender:r.sender,expiresAt:r.expires,source:r.source,replicatedTo:r.replicated});
  for(const v of recipients)add({key:'grant:'+r.digest+':'+v.id,kind:v.receipt?'group receipt':v.grant?'group grant':'group cleanup marker',state:v.consumed?'consumed (no payload)':v.receipt?'receipt held':v.grant?'held':'awaiting grant',storage:'disk',id:v.id,digest:v.digest,sender:r.sender,recipient:v.recipient,expiresAt:r.expires,source:r.source,replicatedTo:r.replicated});
 }
 const ownContent=new Set<string>(),foreignContent=new Map<string,AttachmentCustodyRow>();
 for(const r of media){const m=r.manifest,content=attachmentContentDigest(m);if(!foreign(m.sender,m.recipient)){ownContent.add(content);continue;}foreignContent.set(content,r);
  add({key:'media:'+r.digest,kind:r.receipt?'media receipt / manifest':'media manifest',state:r.receipt?'receipt held':'held / receiving',storage:'disk',id:m.id,digest:r.digest,sender:m.sender,recipient:m.recipient,createdAt:m.created,expiresAt:m.expires,declaredBytes:m.bytes,checkpointChunks:r.received});
 }
 for(const c of chunks){const r=foreignContent.get(c.digest);if(!r&&ownContent.has(c.digest))continue;
  add({key:'chunks:'+c.digest,kind:'encrypted media chunks',state:r?'stored (shared bytes counted once)':'unlinked stored chunks',storage:'disk',id:c.digest,digest:c.digest,...(r?{sender:r.manifest.sender}:{}),chunkCount:c.chunkCount,firstChunk:c.firstChunk,lastChunk:c.lastChunk,storedBytes:c.storedBytes});
 }
 for(const r of calls)if(r.sender&&r.recipient&&foreign(r.sender,r.recipient))add({key:r.key,kind:r.kind,state:r.state,storage:'memory',id:r.id,sender:r.sender,recipient:r.recipient,expiresAt:r.expiresAt});
 rows.sort((a,b)=>a.key.localeCompare(b.key));return {observedAt:now,rows};
}
export function relayInventoryPage(snapshot:RelayInventory,offset=0,limit=50){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid inventory page');
 return {observedAt:snapshot.observedAt,total:snapshot.rows.length,offset,rows:snapshot.rows.slice(offset,offset+limit),next:offset+limit<snapshot.rows.length?offset+limit:null};
}
export function relayPacketDetails(r:RelayPacketMetadata){
 return [['Packet ID',r.id],['Digest',r.digest],['Sender',r.sender],['Recipient',r.recipient],['Created',r.createdAt===undefined?undefined:new Date(r.createdAt).toLocaleString()],['Expires',r.expiresAt===undefined?undefined:new Date(r.expiresAt).toLocaleString()],['Received from relay',r.source],['Replicated to',r.replicatedTo],['Declared file bytes',r.declaredBytes],['Checkpoint chunks (not current storage)',r.checkpointChunks],['Chunks currently stored',r.chunkCount],['First / last chunk index',r.firstChunk===undefined?undefined:r.firstChunk+' / '+r.lastChunk],['Stored serialized chunk bytes',r.storedBytes]].filter(([,value])=>value!==undefined).map(([label,value])=>({label:String(label),value:String(value)}));
}

export const relayCategories = [
 {id:'content',label:'Held content',description:'Encrypted envelopes, group grants and media. A stored copy alone does not prove the recipient is still waiting.'},
 {id:'receipts',label:'Delivery receipts',description:'Delivery confirmations waiting to be collected; these are not unread messages.'},
 {id:'cleanup',label:'Cleanup markers',description:'No message content. Temporary records prevent completed packets from being deposited again.'},
 {id:'expired',label:'Expired records',description:'Past retention time and awaiting normal storage maintenance.'},
 {id:'temporary',label:'Temporary controls',description:'Short-lived call-control records in memory.'},
] as const;
export type RelayCategory=typeof relayCategories[number]['id'];
export function relayPacketCategory(row:RelayPacketMetadata,now:number):RelayCategory{
 if(row.expiresAt!==undefined&&row.expiresAt<=now)return 'expired';
 if(row.storage==='memory')return 'temporary';
 if(row.kind.includes('cleanup marker'))return 'cleanup';
 if(row.kind.includes('receipt'))return 'receipts';
 return 'content';
}
