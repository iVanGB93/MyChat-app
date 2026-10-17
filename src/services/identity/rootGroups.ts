import {validAccountId,accountId,verifyPublicSignature} from './identityProtocol.ts';
import {ed25519} from '@noble/curves/ed25519.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import type {RootChatState,RootChatMessage} from './rootChatTypes.ts';
import type {RootGroup,RootGroupContext,RootGroupMembership,RootGroupBackup} from './rootGroupTypes.ts';
export const ROOT_GROUP_MAX_MEMBERS=10;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const bytes=(v:string)=>new TextEncoder().encode(v).length;
/** The custody outbox keys by delivery ID, so every audience member needs its own stable ID. */
export const rootGroupDeliveryId=(logical:string,recipient:string,kind='message')=>bytesToHex(sha256(utf8ToBytes(JSON.stringify(['axonic-group-delivery-v1',kind,logical,recipient]))));
export function validGroupContext(v:unknown):v is RootGroupContext{const g=v as RootGroupContext;return !!g&&Object.keys(g).sort().join(',')==='id,messageId,revision'&&hex(g.id)&&hex(g.messageId)&&Number.isSafeInteger(g.revision)&&g.revision>=1&&g.revision<=1000000;}
export function validGroupMembership(v:unknown):v is RootGroupMembership{const g=v as RootGroupMembership;return !!g&&hex(g.id)&&validAccountId(g.admin)&&typeof g.name==='string'&&!!g.name.trim()&&bytes(g.name)<=80&&Number.isSafeInteger(g.revision)&&g.revision>=1&&g.revision<=1000000&&Array.isArray(g.members)&&g.members.length>=1&&g.members.length<=ROOT_GROUP_MAX_MEMBERS&&g.members.every(validAccountId)&&new Set(g.members).size===g.members.length&&g.members.includes(g.admin)&&(g.photo===undefined||g.photo===null||hex(g.photo));}
export function validGroupStorage(s:RootChatState,owner:string){return (s.groups===undefined||Array.isArray(s.groups)&&s.groups.length<=64&&s.groups.every(g=>validGroupMembership(g)&&typeof g.accepted==='boolean'&&typeof g.blocked==='boolean'&&(g.muted===undefined||typeof g.muted==='boolean'))&&new Set(s.groups.map(g=>g.id)).size===s.groups.length)&&(s.groupPackets===undefined||Array.isArray(s.groupPackets)&&s.groupPackets.length<=2000&&s.groupPackets.every(p=>!!p&&hex(p.id)&&validAccountId(p.peer)&&p.peer!==owner&&typeof p.raw==='string'&&bytes(p.raw)<=2048&&['pending','delivered'].includes(p.status)));}
const membership=(g:RootGroup):RootGroupMembership=>({id:g.id,admin:g.admin,name:g.name,revision:g.revision,members:[...g.members],...(g.photo!==undefined?{photo:g.photo}:{})});
const same=(a:RootGroupMembership,b:RootGroupMembership)=>JSON.stringify(membership(a as RootGroup))===JSON.stringify(membership(b as RootGroup));
const backupBody=(g:RootGroupMembership)=>utf8ToBytes(JSON.stringify(['axonic-group-backup-v1',g.id,g.admin,g.name,g.revision,g.members,g.photo??null]));
export function signRootGroupBackup(group:RootGroupMembership,rootSeed:Uint8Array):RootGroupBackup{
 const g=membership(group as RootGroup),root=bytesToHex(ed25519.getPublicKey(rootSeed));
 if(!validGroupMembership(g)||g.admin!==accountId(root))throw Error('Only the creator can sign group recovery');
 return {group:g,root,signature:bytesToHex(ed25519.sign(backupBody(g),rootSeed))};
}
export function validRootGroupBackup(value:unknown):value is RootGroupBackup{
 try{const b=value as RootGroupBackup;return !!b&&Object.keys(b).sort().join(',')==='group,root,signature'&&validGroupMembership(b.group)&&['admin,id,members,name,revision','admin,id,members,name,photo,revision'].includes(Object.keys(b.group).sort().join(','))&&hex(b.root)&&typeof b.signature==='string'&&/^[a-f0-9]{128}$/.test(b.signature)&&accountId(b.root)===b.group.admin&&verifyPublicSignature(hexToBytes(b.signature),backupBody(b.group),hexToBytes(b.root),{zip215:false});}catch{return false;}
}
export function queueRootGroupBackup(s:RootChatState,owner:string,g:RootGroup,id:string){
 if(!g.backup||!validRootGroupBackup(g.backup)||!same(g,g.backup.group))throw Error('Invalid group backup');
 queue(s,owner,id,g.members,'axonic-group-backup-v1',g.backup);
}
/** A connected member may have recovered their keys with an empty local chat store.
 * Members return a creator-signed backup, or ask the creator to resend metadata.
 * Unsigned creator recovery is an offer requiring explicit local confirmation.
 */
export function recoverRootGroupsForPeer(s:RootChatState,owner:string,peer:string,requestId:string){
 if(!validAccountId(peer)||peer===owner||!hex(requestId))throw Error('Invalid group recovery request');
 if(s.contacts.some(c=>c.account===peer&&c.blocked))return false;
 let changed=false;
 for(const g of s.groups??[]){
  if(g.recoveryPending||g.blocked||!g.members.includes(owner)||!g.members.includes(peer)||s.contacts.some(c=>c.account===g.admin&&c.blocked))continue;
  const id=rootGroupDeliveryId(requestId,g.id,'group-recovery');
  if(g.backup&&validRootGroupBackup(g.backup)&&same(g,g.backup.group))queue(s,owner,id,[peer],'axonic-group-backup-v1',g.backup);
  else if(g.admin===owner)queue(s,owner,id,[peer],'axonic-group-members-v1',membership(g));
  else if(g.admin===peer)queue(s,owner,id,[peer],'axonic-group-recovery-offer-v1',membership(g));
  else if(g.admin!==peer)queue(s,owner,id,[g.admin],'axonic-group-recover-v1',{group:g.id,member:peer});
  else continue;
  changed=true;
 }
 return changed;
}
function queue(s:RootChatState,owner:string,id:string,recipients:string[],tag:string,body:unknown){
 const packets=recipients.filter(p=>p!==owner).map(peer=>{const deliveryId=rootGroupDeliveryId(id,peer,tag);return {peer,id:deliveryId,raw:JSON.stringify([tag,peer,deliveryId,body]),status:'pending' as const};});
 if(!hex(id)||packets.some(p=>bytes(p.raw)>2048)||(s.groupPackets?.length??0)+packets.length>2000)throw Error('Group outbox is full or membership is too large');
 for(const p of packets){const old=s.groupPackets?.find(v=>v.id===p.id&&v.peer===p.peer);if(old&&old.raw!==p.raw||s.messages.some(m=>m.id===p.id&&m.peer===p.peer&&m.direction==='outgoing')||s.actions?.some(a=>a.id===p.id&&a.peer===p.peer&&a.direction==='outgoing'))throw Error('Group packet ID conflict');}
 for(const p of packets)if(!s.groupPackets?.some(v=>v.id===p.id&&v.peer===p.peer))(s.groupPackets??=[]).push(p);
}
export function changeRootGroup(s:RootChatState,owner:string,id:string,packetId:string,name:string,members:string[],photo?:string|null){
 const old=s.groups?.find(g=>g.id===id);if(old?.recoveryPending)throw Error('Confirm recovered group details first');if(old&&old.admin!==owner)throw Error('Only the group creator can change membership');
 const next:RootGroup={id,admin:owner,name:name.trim(),revision:(old?.revision??0)+1,members:[...new Set([owner,...members])].sort(),accepted:true,blocked:old?.blocked??false,...(photo!==undefined?{photo}:old?.photo!==undefined?{photo:old.photo}:{})};
 if(old&&old.name===next.name&&JSON.stringify(old.members)===JSON.stringify(next.members)&&old.photo===next.photo)return old;
 if(!validGroupMembership(next)||!old&&next.members.length<2)throw Error('Choose a name and 2–10 unique group members');
 if(!old&&(s.groups?.length??0)>=64)throw Error('Group storage is full');
 if(photo&& !s.messages.some(m=>m.direction==='outgoing'&&m.group?.id===id&&m.group.messageId===photo&&m.attachment?.mime.startsWith('image/')&&!m.deleted&&!s.groupActions?.some(a=>a.group.id===id&&a.target.id===photo&&a.target.author===owner&&a.kind==='delete')))throw Error('Share the group image before selecting it');
 queue(s,owner,packetId,[...new Set([...(old?.members??[]),...next.members])],'axonic-group-members-v1',membership(next));
 if(old)Object.assign(old,next);else(s.groups??=[]).push(next);return next;
}
/** Sender is supplied by the existing encrypted, authenticated direct/custody transport. */
export function receiveRootGroupControl(s:RootChatState,owner:string,from:string,id:string,tag:string,body:unknown):boolean|null{
 if(tag==='axonic-group-recovery-offer-v1'){
  const g=body as RootGroupMembership;
  if(!validGroupMembership(g)||!['admin,id,members,name,revision','admin,id,members,name,photo,revision'].includes(Object.keys(g).sort().join(','))||g.admin!==owner||!g.members.includes(from)||s.contacts.some(c=>c.account===from&&c.blocked))return false;
  if(s.groups?.some(v=>v.id===g.id))return true;
  if((s.groups?.length??0)>=64)return false;
  (s.groups??=[]).push({...g,accepted:false,blocked:false,recoveryPending:true});return true;
 }
 if(tag==='axonic-group-backup-v1'){
  if(!validRootGroupBackup(body))return false;const g=body.group,old=s.groups?.find(v=>v.id===g.id);
  if(!g.members.includes(from)||!g.members.includes(owner)||s.contacts.some(c=>(c.account===from||c.account===g.admin)&&c.blocked))return false;
  if(old){if(old.admin!==g.admin)return false;if(old.recoveryPending){Object.assign(old,g,{backup:body,accepted:g.admin===owner});delete old.recoveryPending;return true;}if(g.revision<old.revision)return true;if(g.revision===old.revision&&!same(old,g))return false;Object.assign(old,g,{backup:body});return true;}
  if((s.groups?.length??0)>=64)return false;
  (s.groups??=[]).push({...g,accepted:g.admin===owner,blocked:false,backup:body});return true;
 }
 if(tag==='axonic-group-recover-v1'){
  const v=body as {group:string;member:string};
  if(!v||Object.keys(v).sort().join(',')!=='group,member'||!hex(v.group)||!validAccountId(v.member)||v.member===owner)return false;
  const g=s.groups?.find(g=>g.id===v.group);
  if(!g||g.recoveryPending||g.admin!==owner||g.blocked||!g.members.includes(from)||!g.members.includes(v.member)||s.contacts.some(c=>(c.account===from||c.account===v.member)&&c.blocked))return false;
  queue(s,owner,rootGroupDeliveryId(id,g.id,'group-recovery-response'),[v.member],'axonic-group-members-v1',membership(g));
  return true;
 }
 if(tag==='axonic-group-members-v1'){
  const g=body as RootGroupMembership;if(!validGroupMembership(g)||!['admin,id,members,name,revision','admin,id,members,name,photo,revision'].includes(Object.keys(g).sort().join(','))||g.admin!==from||s.contacts.some(c=>c.account===from&&c.blocked))return false;
  const old=s.groups?.find(v=>v.id===g.id);
  if(old){if(old.admin!==from)return false;if(g.revision<old.revision)return true;if(g.revision===old.revision)return same(old,g);delete old.backup;Object.assign(old,g);return true;}
  if(!g.members.includes(owner)||(s.groups?.length??0)>=64)return false;
  (s.groups??=[]).push({...g,accepted:false,blocked:false});return true;
 }
 if(tag==='axonic-group-leave-v1'){
  const v=body as {id:string};if(!v||Object.keys(v).length!==1||!hex(v.id))return false;
  const g=s.groups?.find(g=>g.id===v.id);if(!g||g.admin!==owner||from===owner)return false;
  if(!g.members.includes(from))return true;
  changeRootGroup(s,owner,g.id,id,g.name,g.members.filter(m=>m!==from));return true;
 }
 return null;
}
export function leaveRootGroup(s:RootChatState,owner:string,id:string,packetId:string){const g=s.groups?.find(g=>g.id===id);if(!g)throw Error('Group unavailable');if(g.admin===owner)changeRootGroup(s,owner,id,packetId,g.name,[owner]);else queue(s,owner,packetId,[g.admin],'axonic-group-leave-v1',{id});g.blocked=true;}
export function rootGroupAllowed(s:RootChatState,owner:string,peer:string,context:RootGroupContext){const g=s.groups?.find(g=>g.id===context.id);return !!g&&!g.recoveryPending&&!g.blocked&&g.members.includes(owner)&&g.members.includes(peer)&&g.revision>=context.revision&&!s.contacts.some(c=>c.account===peer&&c.blocked);}
export function encodeRootGroupMessage(m:RootChatMessage){return JSON.stringify([m.attachment?'axonic-root-group-attachment-v1':'axonic-root-group-text-v1',m.peer,m.id,{group:m.group,...(m.attachment?{descriptor:m.attachment}:{text:m.text}),...(m.reply?{reply:m.reply}:{})},...(m.createdAt===undefined?[]:[m.createdAt])]);}
/** Collapse per-recipient own copies for presentation; delivery remains tracked separately. */
export function rootGroupMessages(s:RootChatState,id:string){const rows=new Map<string,RootChatMessage>();for(const m of s.messages.filter(m=>m.group?.id===id)){const key=(m.direction==='outgoing'?'own':m.peer)+':'+m.group!.messageId,old=rows.get(key);if(!old)rows.set(key,{...m});else {if(m.networkCancelledAt!==undefined)old.networkCancelledAt??=m.networkCancelledAt;const description=(v:RootChatMessage)=>v.status==='delivered'||v.descriptorDelivered?Number.MAX_SAFE_INTEGER:v.networkStoredUntil??0;const file=(v:RootChatMessage)=>v.status==='delivered'?Number.MAX_SAFE_INTEGER:v.attachmentStoredUntil??0;old.networkStoredUntil=Math.min(description(old),description(m));old.attachmentStoredUntil=Math.min(file(old),file(m));old.descriptorDelivered=!!old.descriptorDelivered&&!!m.descriptorDelivered;old.read=!!old.read&&!!m.read;if(m.status==='pending')old.status='pending';}}return [...rows.values()];}

/** Resolves only an authenticated group attachment; never an external image URL.
 * Late/new members show a placeholder until the creator shares the photo to them.
 * Local attachment cleanup or deletion returns null rather than retaining a duplicate file.
 */
export function rootGroupPhoto(s:RootChatState,id:string,owner:string){
 const g=s.groups?.find(g=>g.id===id);if(!g?.photo||g.blocked||!g.accepted)return null;
 return s.messages.find(m=>m.group?.id===id&&m.group.messageId===g.photo&&(m.direction==='outgoing'?owner:m.peer)===g.admin&&m.attachment?.mime.startsWith('image/')&&!m.deleted)??null;
}
