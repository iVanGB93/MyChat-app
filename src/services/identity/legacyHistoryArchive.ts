import {validAccountId} from './identityProtocol';
import type {ChatRoom} from '../../types';
import type {LocalMessage} from '../localMessageStore';

export type ArchivedRoom = {room:ChatRoom; peer:string|null; messages:LocalMessage[]};
export type LegacyHistoryArchive = {version:1; owner:number; account:string; rooms:ArchivedRoom[]};

/** A separate, read-only archive: imported pending rows never become network outbox entries. */
export async function prepareLegacyHistoryArchive(d:{
 owner:number; account:string; current():boolean;
 rooms():Promise<ChatRoom[]>; messages(room:string):Promise<LocalMessage[]>;
 pin(peer:number):Promise<string|null>;
}):Promise<LegacyHistoryArchive>{
 if(!Number.isSafeInteger(d.owner)||d.owner<1||!validAccountId(d.account))throw Error('Invalid history owner');
 const check=()=>{if(!d.current())throw Error('History migration interrupted; the original history is unchanged');};
 check();const rooms=await d.rooms();check();
 const result:LegacyHistoryArchive={version:1,owner:d.owner,account:d.account,rooms:[]};
 const seen=new Set<string>();
 for(const room of rooms){
  // Cached names and is_mine are presentation hints, never ownership evidence.
  if(!room.id||seen.has(room.id)||!Array.isArray(room.members)||!room.members.includes(d.owner)
   ||room.members.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(room.members).size!==room.members.length)
   throw Error('An existing chat needs recovery before history can be migrated');
  seen.add(room.id);
  const other=room.room_type==='direct'&&room.members.length===2?room.members.find(id=>id!==d.owner):undefined;
  const peer=other===undefined?null:await d.pin(other);check();
  if(peer!==null&&(!validAccountId(peer)||peer===d.account))throw Error('Invalid saved peer binding');
  const messages=await d.messages(room.id);check();
  if(messages.some(m=>m.room_id!==room.id||!room.members.includes(m.sender_id)))
   throw Error('Existing message ownership could not be verified');
  result.rooms.push({room,peer,messages:messages.map(m=>({...m,is_mine:m.sender_id===d.owner}))});
 }
 return result;
}
