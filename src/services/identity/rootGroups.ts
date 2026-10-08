import {validAccountId} from './identityProtocol.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import type {RootChatState,RootChatMessage} from './rootChatTypes.ts';
import type {RootGroup,RootGroupContext,RootGroupMembership} from './rootGroupTypes.ts';
export const ROOT_GROUP_MAX_MEMBERS=10;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const bytes=(v:string)=>new TextEncoder().encode(v).length;
/** The custody outbox keys by delivery ID, so every audience member needs its own stable ID. */
export const rootGroupDeliveryId=(logical:string,recipient:string,kind='message')=>bytesToHex(sha256(utf8ToBytes(JSON.stringify(['axonic-group-delivery-v1',kind,logical,recipient]))));
export function validGroupContext(v:unknown):v is RootGroupContext{const g=v as RootGroupContext;return !!g&&Object.keys(g).sort().join(',')==='id,messageId,revision'&&hex(g.id)&&hex(g.messageId)&&Number.isSafeInteger(g.revision)&&g.revision>=1&&g.revision<=1000000;}
export function validGroupMembership(v:unknown):v is RootGroupMembership{const g=v as RootGroupMembership;return !!g&&hex(g.id)&&validAccountId(g.admin)&&typeof g.name==='string'&&!!g.name.trim()&&bytes(g.name)<=80&&Number.isSafeInteger(g.revision)&&g.revision>=1&&g.revision<=1000000&&Array.isArray(g.members)&&g.members.length>=1&&g.members.length<=ROOT_GROUP_MAX_MEMBERS&&g.members.every(validAccountId)&&new Set(g.members).size===g.members.length&&g.members.includes(g.admin);}
export function validGroupStorage(s:RootChatState,owner:string){return (s.groups===undefined||Array.isArray(s.groups)&&s.groups.length<=64&&s.groups.every(g=>validGroupMembership(g)&&typeof g.accepted==='boolean'&&typeof g.blocked==='boolean')&&new Set(s.groups.map(g=>g.id)).size===s.groups.length)&&(s.groupPackets===undefined||Array.isArray(s.groupPackets)&&s.groupPackets.length<=2000&&s.groupPackets.every(p=>!!p&&hex(p.id)&&validAccountId(p.peer)&&p.peer!==owner&&typeof p.raw==='string'&&bytes(p.raw)<=2048&&['pending','delivered'].includes(p.status)));}
const membership=(g:RootGroup):RootGroupMembership=>({id:g.id,admin:g.admin,name:g.name,revision:g.revision,members:[...g.members]});
const same=(a:RootGroupMembership,b:RootGroupMembership)=>JSON.stringify(membership(a as RootGroup))===JSON.stringify(membership(b as RootGroup));
function queue(s:RootChatState,owner:string,id:string,recipients:string[],tag:string,body:unknown){
 const packets=recipients.filter(p=>p!==owner).map(peer=>{const deliveryId=rootGroupDeliveryId(id,peer,tag);return {peer,id:deliveryId,raw:JSON.stringify([tag,peer,deliveryId,body]),status:'pending' as const};});
 if(!hex(id)||packets.some(p=>bytes(p.raw)>2048)||(s.groupPackets?.length??0)+packets.length>2000)throw Error('Group outbox is full or membership is too large');
 for(const p of packets){const old=s.groupPackets?.find(v=>v.id===p.id&&v.peer===p.peer);if(old&&old.raw!==p.raw||s.messages.some(m=>m.id===p.id&&m.peer===p.peer&&m.direction==='outgoing')||s.actions?.some(a=>a.id===p.id&&a.peer===p.peer&&a.direction==='outgoing'))throw Error('Group packet ID conflict');}
 for(const p of packets)if(!s.groupPackets?.some(v=>v.id===p.id&&v.peer===p.peer))(s.groupPackets??=[]).push(p);
}
export function changeRootGroup(s:RootChatState,owner:string,id:string,packetId:string,name:string,members:string[]){
 const old=s.groups?.find(g=>g.id===id);if(old&&old.admin!==owner)throw Error('Only the group creator can change membership');
 const next:RootGroup={id,admin:owner,name:name.trim(),revision:(old?.revision??0)+1,members:[...new Set([owner,...members])].sort(),accepted:true,blocked:old?.blocked??false};
 if(old&&old.name===next.name&&JSON.stringify(old.members)===JSON.stringify(next.members))return old;
 if(!validGroupMembership(next)||!old&&next.members.length<2)throw Error('Choose a name and 2–10 unique group members');
 if(!old&&(s.groups?.length??0)>=64)throw Error('Group storage is full');
 queue(s,owner,packetId,[...new Set([...(old?.members??[]),...next.members])],'axonic-group-members-v1',membership(next));
 if(old)Object.assign(old,next);else(s.groups??=[]).push(next);return next;
}
/** Sender is supplied by the existing encrypted, authenticated direct/custody transport. */
export function receiveRootGroupControl(s:RootChatState,owner:string,from:string,id:string,tag:string,body:unknown):boolean|null{
 if(tag==='axonic-group-members-v1'){
  const g=body as RootGroupMembership;if(!validGroupMembership(g)||Object.keys(g).sort().join(',')!=='admin,id,members,name,revision'||g.admin!==from||s.contacts.some(c=>c.account===from&&c.blocked))return false;
  const old=s.groups?.find(v=>v.id===g.id);
  if(old){if(old.admin!==from)return false;if(g.revision<old.revision)return true;if(g.revision===old.revision)return same(old,g);Object.assign(old,g);return true;}
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
export function rootGroupAllowed(s:RootChatState,owner:string,peer:string,context:RootGroupContext){const g=s.groups?.find(g=>g.id===context.id);return !!g&&!g.blocked&&g.members.includes(owner)&&g.members.includes(peer)&&g.revision>=context.revision&&!s.contacts.some(c=>c.account===peer&&c.blocked);}
export function encodeRootGroupMessage(m:RootChatMessage){return JSON.stringify([m.attachment?'axonic-root-group-attachment-v1':'axonic-root-group-text-v1',m.peer,m.id,{group:m.group,...(m.attachment?{descriptor:m.attachment}:{text:m.text,...(m.reply?{reply:m.reply}:{})})}]);}
/** Collapse per-recipient own copies for presentation; delivery remains tracked separately. */
export function rootGroupMessages(s:RootChatState,id:string){const rows=new Map<string,RootChatMessage>();for(const m of s.messages.filter(m=>m.group?.id===id)){const key=(m.direction==='outgoing'?'own':m.peer)+':'+m.group!.messageId,old=rows.get(key);if(!old)rows.set(key,{...m});else if(m.status==='pending')old.status='pending';}return [...rows.values()];}
