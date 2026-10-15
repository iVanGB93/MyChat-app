import {validAccountId} from './identityProtocol.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {groupCustodyDigest,validGroupCustodyPayload,matchesGroupGrant,verifyGroupCustodyJob,type GroupCustodyJob,type GroupCustodyPayload} from './groupCustodyProtocol.ts';
import {parseCustody,verifyCustody,custodyDigest,type CustodyEnvelope,type CustodyReceipt} from './custodyProtocol.ts';
import {splitGroupCustodyMessage} from './groupCustodyMessages.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';
import type {sealGroupCustody} from './groupCustodyProtocol.ts';
import type {OwnCustodyStore} from './normalChatContracts.ts';
export interface GroupOutboxEntry {job:GroupCustodyJob;relay:string|null;consumed:string[]}
export interface GroupOutboxStore {read(owner:string):Promise<GroupOutboxEntry[]>;write(owner:string,rows:GroupOutboxEntry[]):Promise<void>}
export function validateGroupOutbox(rows:GroupOutboxEntry[],owner:string){
 if(!Array.isArray(rows)||rows.length>128||JSON.stringify(rows).length>8*1024*1024)throw Error('Invalid shared outbox');
 const ids=new Set<string>();
 for(const r of rows){
  const p=r?.job?.payload;
  if(!p||p.sender!==owner||!validGroupCustodyPayload(p,p.expires-1)||ids.has(p.id)||r.relay!==null&&!validAccountId(r.relay)||!Array.isArray(r.job.grants)||r.job.grants.length!==p.recipients.length||new Set(r.job.grants.map(e=>e.id)).size!==r.job.grants.length||r.job.grants.some(e=>!parseCustody(JSON.stringify(e),p.expires-1)||!matchesGroupGrant(p,e))||!Array.isArray(r.consumed)||new Set(r.consumed).size!==r.consumed.length||r.consumed.some(id=>!r.job.grants.some(e=>e.id===id)))throw Error('Invalid shared outbox job');
  ids.add(p.id);
 }
}
/** One durable ciphertext per logical group message. Normal ledger IDs remain
 * per recipient, preserving deduplication and the existing receipt UI. */
export function createGroupCustodyCourier(d:{owner():string|null;now():number;records:IdentityRecordStore;own:OwnCustodyStore;store:GroupOutboxStore;
 compatible(peer:string):Promise<boolean>;relays():string[];request(peer:string,raw:string):Promise<string|null>;allowed(peer:string):boolean;
 seal(id:string,text:string,recipients:Parameters<typeof sealGroupCustody>[0]['recipients']):Promise<GroupCustodyJob>;
 receive(e:CustodyEnvelope,p:GroupCustodyPayload,relay:string):Promise<CustodyReceipt|null>;held(e:CustodyEnvelope):Promise<void>;heldGroup?(envelopes:CustodyEnvelope[]):Promise<void>;confirm(r:CustodyReceipt,current:()=>boolean,relay:string):Promise<boolean>}){
 let epoch=0,stopped=false,depositing=false,polling=false,nextPoll=0,pollCursor=0;let writes:Promise<unknown>=Promise.resolve();
 const lease=()=>{const owner=d.owner(),version=epoch;return {owner,current:()=>!!owner&&!stopped&&epoch===version&&d.owner()===owner};};
 const change=<T>(owner:string,current:()=>boolean,fn:(rows:GroupOutboxEntry[])=>Promise<T>|T)=>{
  const work=writes.then(async()=>{if(!current())return;const stored=await d.store.read(owner);validateGroupOutbox(stored,owner);const before=JSON.stringify(stored),rows=stored.filter(r=>r.job.payload.expires>d.now());if(!current())return;const result=await fn(rows);validateGroupOutbox(rows,owner);if(current()&&JSON.stringify(rows)!==before)await d.store.write(owner,rows);return current()?result:undefined;});writes=work.catch(()=>{});return work;
 };
 async function request(peer:string,body:unknown){const raw=await d.request(peer,JSON.stringify(body));if(!raw||raw.length>16000)return null;try{return JSON.parse(raw);}catch{return null;}}
 const rejected=new Map<string,{until:number;attempts:number}>(),acknowledged=new Set<string>(),drained=new Set<string>();
 return {
  recoveryComplete(sender:string,id:string){return !polling&&!depositing&&acknowledged.has(sender+':'+id)&&d.relays().length>0&&d.relays().every(p=>drained.has(p));},
  async deposit(messages:{peer:string;id:string;raw:string}[],selected:{peer:string;id:string;raw:string}):Promise<boolean|undefined>{
   const common=splitGroupCustodyMessage(selected.raw);if(!common)return undefined;
   const l=lease();if(!l.current()||depositing)return false;
   const matching=messages.filter(m=>{const part=splitGroupCustodyMessage(m.raw);return part?.text===common.text&&part?.group===common.group;});
   const id=bytesToHex(sha256(utf8ToBytes(JSON.stringify(['axonic-group-job-v1',l.owner,common.group,common.text]))));
   depositing=true;
   try{
    const entry=await change(l.owner!,l.current,async rows=>{
     const old=rows.find(r=>r.job.payload.id===id);if(old)return old;
     if(!d.relays().some(p=>p!==l.owner&&!matching.some(m=>m.peer===p)))return 'legacy' as const;
     for(const m of matching)if(!await d.compatible(m.peer))return 'legacy' as const;
     if(matching.length<2||matching.length>9||new TextEncoder().encode(common.text).length>2048)return 'legacy' as const;
     if(rows.length>=128)return null;
     // Never mix an already-sealed legacy delivery with a shared grant under the same ID.
     for(const m of matching)if(await d.own.get(l.owner!,m.id))return 'legacy' as const;
     const recipients:Parameters<typeof sealGroupCustody>[0]['recipients']=[];
     for(const m of matching){if(!l.current()||!d.allowed(m.peer))return null;const record=await d.records.read(m.peer);if(!record)return null;recipients.push({record,device:record.devices[0].id,id:m.id,metadata:splitGroupCustodyMessage(m.raw)!.metadata});}
     if(!l.current())return null;const job=await d.seal(id,common.text,recipients);if(!l.current())return null;
     const result={job,relay:null,consumed:[]};rows.push(result);return result;
    });
    if(entry==='legacy')return undefined;
    if(!entry||!l.current())return false;
    const candidates=d.relays().filter(p=>p!==l.owner&&!entry.job.grants.some(e=>e.recipient===p)).slice(0,3);
    if(!candidates.length)return false;
    if(!await verifyGroupCustodyJob(entry.job,d.records,d.now())||entry.job.payload.sender!==l.owner||!l.current())return false;
    // Freeze the audience before handoff. Revoked recipients prevent a new
    // deposit; already accepted relay traffic follows ordinary expiry semantics.
    if(entry.job.grants.some(e=>!d.allowed(e.recipient)))return false;
    for(const e of entry.job.grants){const saved=await d.own.get(l.owner!,e.id)??await d.own.save(l.owner!,e,l.current);if(!saved||custodyDigest(saved.envelope)!==custodyDigest(e)||!l.current())return false;}
    // Recheck responsibility on retry; a cached relay name is not proof that
    // its durable job still exists. A replacement receives the exact same job.
    const ordered=entry.relay&&candidates.includes(entry.relay)?[entry.relay,...candidates.filter(p=>p!==entry.relay)]:candidates;
    for(const peer of ordered){
     if(!l.current())return false;
     let begin=entry.relay===peer?await request(peer,{operation:'group-status',sender:l.owner,id,digest:groupCustodyDigest(entry.job.payload)}):null;
     if(!l.current())return false;
     if(begin?.status!=='held')begin=await request(peer,{operation:'group-begin',payload:entry.job.payload});if(!l.current())return false;
     let held=begin?.status==='held';
     if(begin?.status==='staged'){
      let complete=true;for(const packet of entry.job.grants){if(!l.current())return false;const r=await request(peer,{operation:'group-grant',id,packet});if(!['staged','held'].includes(r?.status)){complete=false;break;}}
      if(complete&&l.current()&&entry.job.grants.every(e=>d.allowed(e.recipient)))held=(await request(peer,{operation:'group-commit',sender:l.owner,id,digest:groupCustodyDigest(entry.job.payload)}))?.status==='held';
     }
     if(held&&l.current()){
      await change(l.owner!,l.current,rows=>{const r=rows.find(r=>r.job.payload.id===id);if(r)r.relay=peer;});
      if(d.heldGroup)await d.heldGroup(entry.job.grants);else for(const e of entry.job.grants)if(l.current())await d.held(e);return l.current();
     }
    }return false;
   }finally{depositing=false;}
  },
  async tick(){const l=lease();if(!l.current()||polling||d.now()<nextPoll)return;polling=true;nextPoll=d.now()+5000;
   // Bound each pass without permanently ignoring the fourth and later peers.
   const peers=[...new Set(d.relays())],start=peers.length?pollCursor%peers.length:0;
   const batch=Array.from({length:Math.min(3,peers.length)},(_,i)=>peers[(start+i)%peers.length]);
   pollCursor=peers.length?(start+batch.length)%peers.length:0;
   try{for(const relay of batch){
    const exclude:string[]=[];for(const [id,value] of rejected){if(value.until>d.now()&&id.startsWith(relay+":"))exclude.push(id.slice(relay.length+1));}
    for(let i=0;i<4&&l.current();i++){
     const response=await request(relay,{operation:'group-poll',exclude:exclude.slice(-128)});if(response?.status!=='ok'||!l.current()){if(response?.status==='retry'&&Number.isFinite(response.retryAfterMs))nextPoll=Math.max(nextPoll,d.now()+Math.min(60000,Math.max(1000,response.retryAfterMs)));break;}if(!response.packet){if(!rejected.size)drained.add(relay);break;}drained.delete(relay);
     const packet=parseCustody(JSON.stringify(response.packet),d.now());if(!packet||exclude.includes(packet.id))break;exclude.push(packet.id);let accepted=false;
     if(packet.kind==='envelope'&&packet.recipient===l.owner&&d.allowed(packet.sender)){
      let receipt:CustodyReceipt|null=null;try{receipt=await d.receive(packet,response.payload,relay);}catch{}
      if(receipt&&l.current())accepted=(await request(relay,{operation:'group-receipt',id:response.job,packet:receipt}))?.status==='accepted';
     }else if(packet.kind==='receipt'&&packet.sender===l.owner&&await verifyCustody(packet,d.records,d.now())&&l.current()){
      const saved=await d.own.get(l.owner!,packet.id),e=saved?.envelope;
      if(e&&custodyDigest(e)===packet.digest&&e.recipient===packet.recipient&&e.recipientDevice===packet.recipientDevice&&e.expires===packet.expires&&l.current()&&await d.confirm(packet,l.current,relay)&&l.current()){
       accepted=(await request(relay,{operation:'group-consume',sender:l.owner,id:response.job,messageId:packet.id,digest:packet.digest}))?.status==='accepted';
       // Keep the small encrypted grant until expiry for receipts from a backup.
       if(accepted&&l.current())await change(l.owner!,l.current,rows=>{const r=rows.find(r=>r.job.payload.id===response.job);if(r&&!r.consumed.includes(packet.id))r.consumed.push(packet.id);for(let n=rows.length-1;n>=0;n--)if(rows[n].consumed.length===rows[n].job.grants.length)rows.splice(n,1);});
      }
     }
     if(accepted&&packet.kind==='envelope'&&l.current()){if(acknowledged.size>=256)acknowledged.delete(acknowledged.values().next().value!);acknowledged.add(packet.sender+':'+packet.id);}
     const key=relay+":"+packet.id;if(accepted)rejected.delete(key);else {const attempts=(rejected.get(key)?.attempts??0)+1;if(!rejected.has(key)&&rejected.size>=1240)rejected.delete(rejected.keys().next().value!);rejected.set(key,{attempts,until:d.now()+Math.min(300000,15000*2**Math.min(attempts-1,5))});}
    }
   }}catch{/* Durable job and recipient receipts remain retryable. */}finally{polling=false;nextPoll=Math.max(nextPoll,d.now()+5000);}
  },
  resume(){nextPoll=0;acknowledged.clear();drained.clear();},invalidate(){epoch++;rejected.clear();acknowledged.clear();drained.clear();nextPoll=0;},stop(){stopped=true;epoch++;rejected.clear();}
 };
}
