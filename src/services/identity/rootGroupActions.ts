import {validAccountId} from './identityProtocol.ts';
import {validGroupContext,rootGroupAllowed,rootGroupDeliveryId} from './rootGroups.ts';
import type {RootChatReply,RootChatState} from './rootChatTypes.ts';
import type {RootGroupAction} from './rootGroupTypes.ts';
export type {RootGroupAction} from './rootGroupTypes.ts';
const reactions=['👍','❤️','😂','😮','😢','🙏'];
export const validGroupReply=(v:unknown):v is RootChatReply=>{const r=v as RootChatReply;return !!r&&Object.keys(r).sort().join(',')==='author,id'&&/^[a-f0-9]{64}$/.test(r.id)&&validAccountId(r.author);};
const family=(kind:string)=>kind==='reaction'?'reaction':'content';
export const groupActionBody=(a:RootGroupAction)=>({group:a.group,target:a.target,kind:a.kind,revision:a.revision,text:a.text});
export const sameGroupAction=(a:RootGroupAction,b:RootGroupAction)=>JSON.stringify(groupActionBody(a))===JSON.stringify(groupActionBody(b));
export function validGroupAction(a:RootGroupAction,owner:string){const actor=a?.direction==='outgoing'?owner:a?.peer;return !!a&&/^[a-f0-9]{64}$/.test(a.id)&&validAccountId(a.peer)&&a.peer!==owner&&['incoming','outgoing'].includes(a.direction)&&validGroupContext(a.group)&&a.id===rootGroupDeliveryId(a.group.messageId,a.direction==='outgoing'?a.peer:owner,'action')&&validGroupReply(a.target)&&['edit','delete','reaction'].includes(a.kind)&&Number.isSafeInteger(a.revision)&&a.revision>=1&&a.revision<=1000000&&typeof a.text==='string'&&Number.isSafeInteger(a.at)&&['pending','delivered'].includes(a.status)&&(a.kind==='edit'?a.target.author===actor&&!!a.text.trim()&&new TextEncoder().encode(a.text).length<=1600:a.kind==='delete'?a.target.author===actor&&a.text==='':a.text===''||reactions.includes(a.text));}
export const encodeGroupAction=(a:RootGroupAction)=>JSON.stringify(['axonic-root-group-action-v1',a.peer,a.id,groupActionBody(a)]);
const targets=(a:RootGroupAction,group:string,target:RootChatReply)=>a.group.id===group&&a.target.id===target.id&&a.target.author===target.author;
export function enqueueGroupAction(s:RootChatState,owner:string,groupId:string,logicalId:string,target:RootChatReply,kind:RootGroupAction['kind'],text:string,now:number){
 const g=s.groups?.find(g=>g.id===groupId);if(!g||!g.accepted||g.blocked||!g.members.includes(owner)||!validGroupReply(target))throw Error('Accept an active group first');
 const m=s.messages.find(m=>m.group?.id===groupId&&m.group.messageId===target.id&&(m.direction==='outgoing'?owner:m.peer)===target.author);if(!m)throw Error('Original group message unavailable');
 const prior=(s.groupActions??[]).filter(a=>targets(a,groupId,target)&&a.direction==='outgoing'&&family(a.kind)===family(kind));
 const retry=(s.groupActions??[]).filter(a=>a.direction==='outgoing'&&a.group.messageId===logicalId);
 if(retry.length){if(retry.some(a=>!targets(a,groupId,target)||a.kind!==kind||a.text!==text))throw Error('Group action ID conflict');return;}
 if((s.groupActions??[]).some(a=>targets(a,groupId,target)&&a.kind==='delete'))throw Error('Message was deleted');
 const peers=g.members.filter(p=>p!==owner);if(!peers.length)throw Error('Add another member first');
 const revision=Math.max(0,...prior.map(a=>a.revision))+1;
 const rows:RootGroupAction[]=peers.map(peer=>({id:rootGroupDeliveryId(logicalId,peer,'action'),peer,direction:'outgoing',group:{id:groupId,revision:g.revision,messageId:logicalId},target:{...target},kind,text,revision,at:now,status:'pending'}));
 if(rows.some(a=>!validGroupAction(a,owner)||!rootGroupAllowed(s,owner,a.peer,a.group)||new TextEncoder().encode(encodeGroupAction(a)).length>2048)||kind==='edit'&&m.attachment)throw Error('Invalid group action');
 if((s.groupActions?.length??0)+rows.length>10000)throw Error('Group action storage is full');
 if(rows.some(a=>s.messages.some(m=>m.id===a.id&&m.peer===a.peer&&m.direction==='outgoing')||s.groupPackets?.some(p=>p.id===a.id)||s.actions?.some(v=>v.id===a.id&&v.peer===a.peer&&v.direction==='outgoing')))throw Error('Group action ID conflict');
 (s.groupActions??=[]).push(...rows);
}
export function receiveGroupAction(s:RootChatState,owner:string,from:string,id:string,body:unknown,now:number){
 const b=body as ReturnType<typeof groupActionBody>;if(!b||Object.keys(b).sort().join(',')!=='group,kind,revision,target,text')return false;
 const a:RootGroupAction={...b,id,peer:from,direction:'incoming',at:now,status:'delivered'};
 if(!validGroupAction(a,owner)||rootGroupDeliveryId(a.group.messageId,owner,'action')!==id||!rootGroupAllowed(s,owner,from,a.group))return false;
 if(s.messages.some(m=>m.id===id&&m.peer===from&&m.direction==='incoming')||s.groupSeen?.some(p=>p.peer===from&&p.id===id)||s.actions?.some(v=>v.peer===from&&v.direction==='incoming'&&v.id===id))return false;
 const old=s.groupActions?.find(v=>v.peer===from&&v.direction==='incoming'&&v.id===id);if(old)return sameGroupAction(old,a);
 const conflict=s.groupActions?.find(v=>v.peer===from&&v.direction==='incoming'&&targets(v,a.group.id,a.target)&&family(v.kind)===family(a.kind)&&v.revision===a.revision);if(conflict)return sameGroupAction(conflict,a);
 const m=s.messages.find(m=>m.group?.id===a.group.id&&m.group.messageId===a.target.id&&(m.direction==='outgoing'?owner:m.peer)===a.target.author);if(m?.attachment&&a.kind==='edit')return false;
 if((s.groupActions?.length??0)>=10000)return false;(s.groupActions??=[]).push(a);return true;
}
