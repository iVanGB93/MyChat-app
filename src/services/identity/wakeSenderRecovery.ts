import {validAccountId,recordDigest} from './identityProtocol';
import {verifyCustodyWake,CUSTODY_TTL,CUSTODY_WAKE_DATA_BYTES} from './custodyProtocol';
import {pinIdentityRecord,type IdentityRecordStore} from './identityAdmission';
import type {DirectoryLookupResult} from './identityDirectoryLookup';

/** Untrusted hints may request public identity lookup, never unlock or inbox admission. */
export function validWakeLookup(data:unknown,owner:{account:string;device:string},now:number){
 const d=data as {type?:string;event?:string;record?:string};
 if(d?.type!=='neuron_message'||typeof d.event!=='string'||d.event.length>2048)return false;
 try{if(new TextEncoder().encode(JSON.stringify(data)).length>CUSTODY_WAKE_DATA_BYTES)return false;
  const e=JSON.parse(d.event);return e.version===1&&validAccountId(e.sender)&&e.sender!==owner.account&&e.recipient===owner.account&&e.recipientDevice===owner.device&&
  [e.id,e.senderDevice,e.recipientDevice,e.digest,d.record].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))&&
  typeof e.signature==='string'&&/^[a-f0-9]{128}$/.test(e.signature)&&Number.isSafeInteger(e.expires)&&e.expires>now&&e.expires<=now+CUSTODY_TTL&&
  (e.wakeMode===undefined||e.wakeMode==='silent');}catch{return false;}
}
export function createWakeSenderRecovery(d:{store:IdentityRecordStore;now():number;lookup(sender:string):Promise<DirectoryLookupResult>;current(owner:{account:string;device:string},sender:string):Promise<boolean>}){
 let busy=false,next=0;
 return async(data:unknown,owner:{account:string;device:string}):Promise<'recovered'|'invalid'|'deferred'|'unavailable'|'changed'|'verification_failed'|'pin_rejected'>=>{
  if(!validWakeLookup(data,owner,d.now()))return 'invalid';
  if(busy||d.now()<next)return 'deferred';
  busy=true;next=d.now()+30000;
  try{
   const sender=JSON.parse((data as {event:string}).event).sender;
   if(!await d.current(owner,sender))return 'changed';
   const result=await d.lookup(sender);
   if(!await d.current(owner,sender))return 'changed';
   if(result.status!=='found'||!result.packet||result.packet.record.account!==sender)return 'unavailable';
   const {record,history}=result.packet;
   // Authenticate the exact wake before persisting an unfamiliar sender's pin.
   if(!verifyCustodyWake(data,record,owner.account,owner.device,d.now()))return 'verification_failed';
   const previous=await d.store.read(sender);
   if(!await d.current(owner,sender))return 'changed';
   if(previous&&recordDigest(previous)===recordDigest(record))return 'recovered';
   return await pinIdentityRecord(d.store,previous,record,history)?'recovered':'pin_rejected';
  }catch{return 'unavailable';}finally{busy=false;}
 };
}
