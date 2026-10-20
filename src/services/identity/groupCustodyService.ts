import {custodyDigest,parseCustody,verifyCustody,type CustodyEnvelope,type CustodyReceipt} from './custodyProtocol.ts';
import {groupCustodyDigest,matchesGroupGrant,validGroupCustodyPayload,verifyGroupCustodyPayload,type GroupCustodyPayload} from './groupCustodyProtocol.ts';
import {validAccountId} from './identityProtocol.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';
export interface GroupCustodyRow {
 sender:string;id:string;digest:string;expires:number;accepted:boolean;stagedUntil:number;source?:string;replicated?:string;
 payload:GroupCustodyPayload|null;
 recipients:{id:string;recipient:string;recipientDevice:string;digest:string;grant:CustodyEnvelope|null;receipt:CustodyReceipt|null;consumed:boolean}[];
}
export interface GroupCustodyStore {revision?():number|string;transaction<T>(change:(rows:GroupCustodyRow[])=>T):Promise<T>}
export const GROUP_CUSTODY_LIMITS={jobs:128,perSender:16,perRecipient:64,bytes:4*1024*1024};
/** Limits are charged before accepting responsibility. An incomplete staged job
 * is never reported held; recipient grants are committed as one delivery job. */
export function validateGroupCustodyRows(rows:GroupCustodyRow[]){
 if(!Array.isArray(rows)||rows.length>GROUP_CUSTODY_LIMITS.jobs||JSON.stringify(rows).length>GROUP_CUSTODY_LIMITS.bytes)throw Error('Invalid group custody capacity');
 const keys=new Set<string>();
 for(const r of rows){
  if(!r||!validAccountId(r.sender)||!/^[a-f0-9]{64}$/.test(r.id)||!/^[a-f0-9]{64}$/.test(r.digest)||!Number.isSafeInteger(r.expires)||!Number.isSafeInteger(r.stagedUntil)||typeof r.accepted!=='boolean'||keys.has(r.sender+r.id)||!Array.isArray(r.recipients)||r.recipients.length<2||r.recipients.length>9)throw Error('Invalid group custody row');
  keys.add(r.sender+r.id);
  if(r.source!==undefined&&!validAccountId(r.source)||r.replicated!==undefined&&!validAccountId(r.replicated))throw Error('Invalid group replica');
  if(r.payload&&(!validGroupCustodyPayload(r.payload,r.expires-1)||r.payload.id!==r.id||r.payload.sender!==r.sender||r.payload.expires!==r.expires||groupCustodyDigest(r.payload)!==r.digest))throw Error('Invalid shared payload');
  if(!r.payload&&(!r.accepted||r.recipients.some(v=>!v.receipt&&!v.consumed)))throw Error('Missing live group payload');
  if(new Set(r.recipients.map(v=>v.id)).size!==r.recipients.length||new Set(r.recipients.map(v=>v.recipient)).size!==r.recipients.length)throw Error('Duplicate group recipient');
  for(const v of r.recipients){
   if(!validAccountId(v.recipient)||v.recipient===r.sender||!/^[a-f0-9]{64}$/.test(v.id)||!/^[a-f0-9]{64}$/.test(v.recipientDevice)||!/^[a-f0-9]{64}$/.test(v.digest)||typeof v.consumed!=='boolean')throw Error('Invalid recipient binding');
   if(r.source!==undefined&&!validAccountId(r.source)||r.replicated!==undefined&&!validAccountId(r.replicated))throw Error('Invalid group replica');
  if(r.payload&&!r.payload.recipients.some(p=>p.id===v.id&&p.recipient===v.recipient&&p.recipientDevice===v.recipientDevice&&p.digest===v.digest))throw Error('Changed group audience');
   if(v.grant&&(!r.payload||!parseCustody(JSON.stringify(v.grant),r.expires-1)||!matchesGroupGrant(r.payload,v.grant)||v.grant.id!==v.id))throw Error('Invalid group grant');
   if(v.receipt&&(!parseCustody(JSON.stringify(v.receipt),r.expires-1)||v.receipt.kind!=='receipt'||v.receipt.sender!==r.sender||v.receipt.id!==v.id||v.receipt.recipient!==v.recipient||v.receipt.recipientDevice!==v.recipientDevice||v.receipt.digest!==v.digest||v.receipt.expires!==r.expires))throw Error('Invalid group receipt');
   if(r.accepted&&!v.grant&&!v.receipt&&!v.consumed)throw Error('Incomplete accepted group');
   if(v.consumed&&v.receipt)throw Error('Invalid consumed group receipt');
  }
 }
}
export function createGroupCustodyService(d:{owner:string;store:GroupCustodyStore;records:IdentityRecordStore;now():number;current():boolean;stored?(grant:CustodyEnvelope):Promise<void>;
 receiveOwn?(grant:CustodyEnvelope,payload:GroupCustodyPayload,relay:string):Promise<CustodyReceipt|null>;
 changed?(peer:string):void;
}){
 let queued=0,replicating=false,nextReplica=0;
 const reply=(status:string,extra:object={})=>JSON.stringify({status,...extra});
 const sweep=(rows:GroupCustodyRow[])=>{for(let i=rows.length-1;i>=0;i--)if(rows[i].expires<=d.now()||rows[i].accepted&&rows[i].recipients.every(v=>v.consumed)||!rows[i].accepted&&rows[i].stagedUntil<=d.now())rows.splice(i,1);};
 async function handle(peer:string,raw:string){
  const q=JSON.parse(raw);let payload:GroupCustodyPayload|undefined,packet:CustodyEnvelope|CustodyReceipt|undefined;
  if(q.operation==='group-deliver'){
   const grant=parseCustody(JSON.stringify(q.packet),d.now());
   if(!grant||grant.kind!=='envelope'||grant.recipient!==d.owner||!d.receiveOwn
    ||!await verifyGroupCustodyPayload(q.payload,d.records,d.now())||!matchesGroupGrant(q.payload,grant)
    ||!await verifyCustody(grant,d.records,d.now())||!d.current())return reply('rejected');
   const receipt=await d.receiveOwn(grant,q.payload,peer);
   return receipt&&d.current()?reply('delivered',{packet:receipt}):reply('rejected');
  }
  if(q.operation==='group-begin'){
   if(!validGroupCustodyPayload(q.payload,d.now()))return reply('rejected');
   // A replica may not yet know the original sender. Admit its root-signed
   // public record only after it also verifies this exact signed payload;
   // never replace an existing admission pin through this shortcut.
   if(q.record&&q.record.account===q.payload.sender&&!await d.records.read(q.payload.sender)){
    const candidate={...d.records,read:async(account:string)=>account===q.payload.sender?q.record:d.records.read(account)};
    if(!await verifyGroupCustodyPayload(q.payload,candidate,d.now())||!d.current())return reply('rejected');
    await d.records.compareAndSet(q.payload.sender,null,q.record);
   }
   if(!await verifyGroupCustodyPayload(q.payload,d.records,d.now())||!d.current())return reply('rejected');payload=q.payload;
  }else if(q.operation==='group-grant'||q.operation==='group-receipt'){
   const p=parseCustody(JSON.stringify(q.packet),d.now());if(!p||p.kind!==(q.operation==='group-grant'?'envelope':'receipt')||p.kind==='receipt'&&p.recipient!==peer||!await verifyCustody(p,d.records,d.now())||!d.current())return reply('rejected');packet=p;
  }
  const wakes:CustodyEnvelope[]=[],changed=new Set<string>();
  const result=await d.store.transaction(rows=>{
   validateGroupCustodyRows(rows);sweep(rows);if(!d.current())return reply('rejected');
   if(payload){
    if(payload.expires<=d.now()||payload.sender===d.owner||payload.recipients.some(r=>r.recipient===d.owner))return reply('rejected');
    const digest=groupCustodyDigest(payload),old=rows.find(r=>r.sender===payload!.sender&&r.id===payload!.id);
    if(old){if(peer===old.sender&&old.digest===digest)old.source=peer;return reply(old.digest!==digest?'conflict':old.accepted?'held':'staged');}
    if(rows.length>=GROUP_CUSTODY_LIMITS.jobs||rows.filter(r=>r.sender===payload!.sender).length>=GROUP_CUSTODY_LIMITS.perSender||payload.recipients.some(p=>rows.filter(r=>r.recipients.some(v=>v.recipient===p.recipient&&!v.consumed)).length>=GROUP_CUSTODY_LIMITS.perRecipient))return reply('full');
    const row:GroupCustodyRow={source:peer,sender:payload.sender,id:payload.id,digest,expires:payload.expires,accepted:false,stagedUntil:Math.min(payload.expires,d.now()+300000),payload,recipients:payload.recipients.map(v=>({...v,grant:null,receipt:null,consumed:false}))};
    // Reserve room for the largest permitted grant per recipient up front.
    if(JSON.stringify(rows).length+rows.reduce((n,r)=>n+r.recipients.filter(v=>!v.grant&&!r.accepted).length*7000,0)+JSON.stringify(row).length+7000*payload.recipients.length>GROUP_CUSTODY_LIMITS.bytes)return reply('full');
    rows.push(row);return reply('staged');
   }
   if(q.operation==='group-poll'){
    if(!Array.isArray(q.exclude)||q.exclude.length>128||q.exclude.some((v:unknown)=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))return reply('rejected');
    for(const r of rows.filter(r=>r.accepted))for(const v of r.recipients){if(q.exclude.includes(v.id)||v.consumed)continue;
     if(v.recipient===peer&&!v.receipt&&v.grant&&r.payload)return reply('ok',{job:r.id,packet:v.grant,payload:r.payload});
     if(r.sender===peer&&v.receipt)return reply('ok',{job:r.id,packet:v.receipt});
    }return reply('ok',{packet:null});
   }
   const row=rows.find(r=>r.id===q.id&&r.sender===(packet?.sender??q.sender));if(!row)return reply('missing');
   if(q.operation==='group-status'){if(peer!==row.sender||q.digest!==row.digest)return reply('rejected');return reply(row.accepted?'held':'staged');}
   if(q.operation==='group-grant'&&packet?.kind==='envelope'){
    const v=row.recipients.find(v=>v.id===packet!.id);if(!v||!row.payload||!matchesGroupGrant(row.payload,packet))return reply('rejected');
    if(!v.receipt&&!v.consumed)v.grant=packet;return reply(row.accepted?'held':'staged');
   }
   if(q.operation==='group-commit'){
    // A relay may replicate the signed job. It cannot alter the audience or
    // manufacture missing grants; all recipients must have validated proofs.
    if(row.digest!==q.digest)return reply('rejected');if(row.accepted)return reply('held');
    if(row.recipients.some(v=>!v.grant))return reply('incomplete');row.accepted=true;
    for(const v of row.recipients){wakes.push(v.grant!);changed.add(v.recipient);}return reply('held');
   }
   if(q.operation==='group-receipt'&&packet?.kind==='receipt'&&row.accepted){
    const v=row.recipients.find(v=>v.id===packet!.id);if(!v||packet.expires!==row.expires||packet.digest!==v.digest||packet.recipient!==v.recipient||packet.recipientDevice!==v.recipientDevice)return reply('rejected');
    if(!v.consumed){if(!v.receipt)changed.add(row.sender);v.receipt=packet;}
    if(row.recipients.every(v=>v.receipt||v.consumed)){row.payload=null;for(const recipient of row.recipients)recipient.grant=null;}
    return reply('accepted');
   }
   if(q.operation==='group-consume'&&peer===row.sender&&row.accepted){const v=row.recipients.find(v=>v.id===q.messageId&&v.digest===q.digest);if(!v||!v.receipt&&!v.consumed)return reply('rejected');v.receipt=null;v.consumed=true;return reply('accepted');}
   return reply('rejected');
  });
  // Never notify or report held before the transaction successfully commits.
  if(d.current())for(const grant of wakes)void Promise.resolve().then(()=>d.stored?.(grant)).catch(()=>{});
  if(d.current())for(const peer of changed)try{d.changed?.(peer);}catch{/* Retain committed work. */}
  return result;
 }
 return {async receive(peer:string,raw:string){if(!d.current()||!validAccountId(peer)||peer===d.owner||typeof raw!=='string'||raw.length>16000||queued>=4)return reply('rejected');queued++;try{return await handle(peer,raw);}catch{return reply('rejected');}finally{queued--;}},
 async payloadFor(grant:CustodyEnvelope){
  return d.store.transaction(rows=>{validateGroupCustodyRows(rows);return structuredClone(rows.find(r=>r.accepted&&r.expires>d.now()&&r.sender===grant.sender&&r.recipients.some(v=>v.id===grant.id&&v.digest===custodyDigest(grant)))?.payload??null);});
 },
 async deliverDirect(grant:CustodyEnvelope,request:(peer:string,raw:string)=>Promise<string|null>){
  try{
   const row=await d.store.transaction(rows=>{validateGroupCustodyRows(rows);return structuredClone(rows.find(r=>r.accepted&&r.sender===grant.sender&&r.payload&&r.recipients.some(v=>v.id===grant.id&&v.grant&&!v.receipt&&!v.consumed))??null);});
   if(!row||!d.current()||row.expires<=d.now())return false;
   const response=JSON.parse(await request(grant.recipient,JSON.stringify({operation:'group-deliver',packet:grant,payload:row.payload}))??'{}');
   if(response.status!=='delivered'||response.packet?.id!==grant.id||response.packet?.digest!==custodyDigest(grant))return false;
   return JSON.parse(await handle(grant.recipient,JSON.stringify({operation:'group-receipt',id:row.id,packet:response.packet}))).status==='accepted';
  }catch{return false;}
 },
 async replicate(peers:string[],request:(peer:string,raw:string)=>Promise<string|null>){
  if(replicating||!d.current()||d.now()<nextReplica)return;replicating=true;nextReplica=d.now()+30000;
  try{
   const row=await d.store.transaction(rows=>structuredClone(rows.find(r=>r.accepted&&r.source===r.sender&&r.payload&&r.expires>d.now()&&!r.replicated&&r.recipients.every(v=>v.grant))??null));
   if(!row||!d.current())return;const peer=peers.find(p=>p!==d.owner&&p!==row.sender&&!row.recipients.some(v=>v.recipient===p));if(!peer)return;
   const send=async(body:unknown)=>{if(!d.current())return null;try{return JSON.parse(await request(peer,JSON.stringify(body))??'null');}catch{return null;}};
   const record=await d.records.read(row.sender);if(!d.current())return;
   const begin=await send({operation:'group-begin',payload:row.payload,...(record?{record}:{})});let held=begin?.status==='held';
   if(begin?.status==='staged'){for(const v of row.recipients){const r=await send({operation:'group-grant',id:row.id,packet:v.grant});if(!['staged','held'].includes(r?.status))return;}held=(await send({operation:'group-commit',sender:row.sender,id:row.id,digest:row.digest}))?.status==='held';}
   if(held&&d.current())await d.store.transaction(rows=>{if(!d.current())return;const current=rows.find(r=>r.sender===row.sender&&r.id===row.id&&r.digest===row.digest);if(current)current.replicated=peer;});
  }finally{replicating=false;}
 },
 sweep:()=>d.store.transaction(rows=>{validateGroupCustodyRows(rows);sweep(rows);})};
}

/** Read-only view for the existing signed push-wake retry worker. */
export function groupCustodyWakeStore(store:GroupCustodyStore){return {revision:store.revision?()=>store.revision!():undefined,transaction<T>(read:(rows:import('./custodyService.ts').CustodyRow[])=>T){return store.transaction(rows=>read(rows.filter(r=>r.accepted).flatMap(r=>r.recipients.filter(v=>v.grant&&!v.receipt&&!v.consumed).map(v=>({sender:r.sender,recipient:v.recipient,id:v.id,recipientDevice:v.recipientDevice,expires:r.expires,digest:custodyDigest(v.grant!),packet:v.grant})))));}};}
