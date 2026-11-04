import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {validAccountId} from './identityProtocol.ts';

export const MAX_GROUP_CALL_PARTICIPANTS=4;

/** Each signed invitation keeps its audience. Ad-hoc rooms may grow through
 * authenticated, creator-originated negotiation on their existing media legs. */
export interface GroupCallRoom {
 id:string; group:string; revision:number; creator:string; creatorDevice:string; members:string[]; adHoc?:true;
}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validGroupCallRoom(value:unknown):value is GroupCallRoom {
 const r=value as GroupCallRoom;
 return !!r&&Object.keys(r).sort().join(',')===(r.adHoc===true?'adHoc,creator,creatorDevice,group,id,members,revision':'creator,creatorDevice,group,id,members,revision')
  &&(r.adHoc===undefined||r.adHoc===true&&r.group===r.id&&r.revision===1)
  &&hex(r.id)&&hex(r.group)&&hex(r.creatorDevice)&&validAccountId(r.creator)
  &&Number.isSafeInteger(r.revision)&&r.revision>0&&Array.isArray(r.members)
  &&r.members.length>=2&&r.members.length<=MAX_GROUP_CALL_PARTICIPANTS&&r.members.every(validAccountId)
  &&r.members.includes(r.creator)&&r.members.every((p,i)=>i===0||r.members[i-1]<p);
}
export const groupCallRoomKey=(r:GroupCallRoom)=>JSON.stringify([r.id,r.group,r.revision,r.creator,r.creatorDevice,r.members,...(r.adHoc?[true]:[])]);
export function groupCallExpansionMatches(previous:GroupCallRoom,next:GroupCallRoom){
 return validGroupCallRoom(next)&&previous.adHoc===true&&next.adHoc===true
  &&previous.id===next.id&&previous.group===next.group&&previous.revision===next.revision
  &&previous.creator===next.creator&&previous.creatorDevice===next.creatorDevice
  &&next.members.length>=previous.members.length&&previous.members.every(p=>next.members.includes(p));
}
export const groupCallLegId=(room:GroupCallRoom,a:string,b:string,attempt?:string)=>bytesToHex(sha256(utf8ToBytes(JSON.stringify(['axonic-group-call-leg-v1',groupCallRoomKey(room),...[a,b].sort(),...(attempt?[attempt]:[])]))));
export const groupCallOfferer=(room:GroupCallRoom,a:string,b:string)=>[a,b].includes(room.creator)?room.creator:[a,b].sort()[0];
export function groupCallMembershipMatches(room:GroupCallRoom,group:{id:string;revision:number;members:string[];accepted:boolean;blocked:boolean;recoveryPending?:boolean}|null|undefined,owner:string) {
 return validGroupCallRoom(room)&&!room.adHoc&&!!group&&group.accepted&&!group.blocked&&!group.recoveryPending
  &&group.id===room.group&&group.revision===room.revision&&room.members.includes(owner)
  &&room.members.every(member=>group.members.includes(member));
}
