import {publishRootMessageFeedback} from './rootMessageFeedback';
import {createRootAttachmentStreams,type AttachmentStreams} from './rootAttachmentStreams';
import {ownChatRevision} from '../../modules/storage/chatStore';
import {groupReplyAvailable,validGroupReply} from './rootGroupActions';
import {startRootMediaExport} from './rootMediaExport';
import {indexAttachmentPolicy,createAttachmentSnapshot} from './attachmentPolicy';
import {createAttachmentTiming} from './attachmentTiming';
import {validRootReply,type RootChatReply} from './rootChatLedger';
import {validGroupContext,rootGroupAllowed} from './rootGroups';
import type {RootGroupContext} from './rootGroupTypes';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {validAccountId,verifyRecord} from './identityProtocol';
import {createAttachmentTransfer,type AttachmentJob} from './attachmentTransfer';
import {createMobileAttachmentJobs} from './mobileAttachmentJobs';
import {stageRootAttachmentSource,prepareRootAttachment,readRootAttachmentChunk,readRootAttachmentChunks,writeRootAttachmentChunk,commitRootAttachmentFile,rootAttachmentFile,removeRootAttachmentSource} from './rootAttachmentFiles';
type SharedSelection={id:string;count:number;slot:number};
type Selection={createdAt?:number;shared?:SharedSelection;id:string;peer:string;name:string;mime:string;caption?:string;failed:boolean;reply?:RootChatReply;group?:RootGroupContext};
let activeSharedPeers:(()=>string[])|null=null;
function canShare(peers:string[]){const capable=activeSharedPeers?.()??[];return peers.length>1&&peers.every(p=>capable.includes(p))&&capable.some(p=>!peers.includes(p));}
let activeTimings:(()=>{startedAt:number;observedAt:number;stages:ReturnType<ReturnType<typeof createAttachmentTiming>['snapshot']>})|null=null;
/** Local aggregate diagnostics; no identities, paths or payloads. */
export const rootAttachmentTimings=()=>localAccount.status().state==='unlocked'?activeTimings?.()??null:null;
let activeControls:{cancel(digest:string):Promise<void>;retry(digest:string):Promise<void>}|null=null;
export async function controlRootAttachment(digest:string,action:'pause'|'retry'){
 if(!activeControls||localAccount.status().state!=='unlocked')throw Error('Unlock your account and wait for the network');
 await (action==='pause'?activeControls.cancel(digest):activeControls.retry(digest));
}
let selectionsTail:Promise<unknown>=Promise.resolve();
const key=(owner:string)=>'@axonic_attachment_selections_v1:'+owner;
async function selections(owner:string):Promise<Selection[]>{const raw=await AsyncStorage.getItem(key(owner)),rows=raw?JSON.parse(raw):[];
 if(!Array.isArray(rows)||rows.length>64||rows.some(r=>r.createdAt!==undefined&&(!Number.isSafeInteger(r.createdAt)||r.createdAt<0||r.createdAt>8640000000000000)||r.shared!==undefined&&(!/^[a-f0-9]{64}$/.test(r.shared.id)||!Number.isSafeInteger(r.shared.count)||r.shared.count<2||r.shared.count>9||!Number.isSafeInteger(r.shared.slot)||r.shared.slot<0||r.shared.slot>=r.shared.count)||!/^[a-f0-9]{64}$/.test(r.id)||!validAccountId(r.peer)||typeof r.name!=='string'||r.name.length>120||typeof r.mime!=='string'||r.mime.length>100||typeof r.failed!=='boolean'||r.caption!==undefined&&(typeof r.caption!=='string'||new TextEncoder().encode(r.caption).length>1600)||r.reply!==undefined&&!(r.group?validGroupReply(r.reply):validRootReply(r.reply,owner,r.peer))||r.group!==undefined&&!validGroupContext(r.group)))throw Error('Invalid attachment selections');return rows;}
function changeSelections(owner:string,change:(rows:Selection[])=>void){const work=selectionsTail.then(async()=>{const rows=await selections(owner);change(rows);await AsyncStorage.setItem(key(owner),JSON.stringify(rows));});selectionsTail=work.catch(()=>{});return work;}
export async function queueRootAttachmentSource(peer:string,uri:string,name:string,mime='application/octet-stream',expectedOwner?:string,reply?:RootChatReply,caption?:string){
 const owner=localAccount.status().account;if(!owner||expectedOwner&&owner!==expectedOwner||!validAccountId(peer)||peer===owner)throw Error('Choose a valid peer identity');
 if(reply!==undefined&&!validRootReply(reply,owner,peer))throw Error('Invalid reply');
 if(caption!==undefined&&(typeof caption!=='string'||new TextEncoder().encode(caption).length>1600))throw Error('Comment is too long');
 const safeName=name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment';
 const safeMime=/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime.toLowerCase())?mime.toLowerCase():'application/octet-stream';
 const id=await Native!.identityRandomBytes!(32);if(localAccount.status().account!==owner)throw Error('Account changed');
 try{await changeSelections(owner,rows=>{if(localAccount.status().account!==owner)throw Error('Account changed');if(rows.length>=4)throw Error('Finish or remove a pending attachment first');stageRootAttachmentSource(owner,id,uri);rows.push({createdAt:Date.now(),id,peer,name:safeName,mime:safeMime,failed:false,...(caption?{caption}:{}),...(reply?{reply:{...reply}}: {})});});}
 catch(error){removeRootAttachmentSource(owner,id);throw error;}publishRootMessageFeedback({owner,peer,id,direction:'outgoing'});return id;
}
/** Snapshot the audience before opening a native picker. Keep per-recipient transfer IDs; compatible groups share one content key/ciphertext. */
export async function rootGroupAttachmentAudience(groupId:string,reply?:RootChatReply){const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');const s=await localRootChat().snapshot(),g=s.groups?.find(g=>g.id===groupId);if(!g||g.blocked||!g.accepted||!g.members.includes(owner))throw Error('Accept an active group first');if(reply&&!groupReplyAvailable(s,owner,groupId,reply))throw Error('Original group message unavailable');const peers=g.members.filter(p=>p!==owner);if(!peers.length||peers.some(p=>s.contacts.some(c=>c.account===p&&c.blocked)))throw Error('Choose an active group without blocked members');return {owner,peers,group:{id:groupId,revision:g.revision,messageId:await Native!.identityRandomBytes!(32)},...(reply?{reply:{...reply}}:{})};}
export async function queueRootGroupAttachmentSource(audience:Awaited<ReturnType<typeof rootGroupAttachmentAudience>>,uri:string,name:string,mime='application/octet-stream',caption?:string){
 if(caption!==undefined&&(typeof caption!=='string'||new TextEncoder().encode(caption).length>1600))throw Error('Comment is too long');
 const {owner,peers,group,reply}=audience;if(localAccount.status().account!==owner)throw Error('Account changed');
 if(reply&&!groupReplyAvailable(await localRootChat().snapshot(),owner,group.id,reply))throw Error('Original group message unavailable');
 const sharedId=canShare(peers)?await Native!.identityRandomBytes!(32):null;
 const createdAt=Date.now();const rows:Selection[]=[];for(const peer of peers)rows.push({createdAt,... (sharedId?{shared:{id:sharedId,count:peers.length,slot:rows.length}}:{}),id:await Native!.identityRandomBytes!(32),peer,name:name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment',mime:/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime.toLowerCase())?mime.toLowerCase():'application/octet-stream',failed:false,...(caption?{caption}:{}),group:{...group},...(reply?{reply:{...reply}}:{})});
 try{await changeSelections(owner,current=>{if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner||current.length+rows.length>64)throw Error('Finish pending attachments first');for(const row of rows)stageRootAttachmentSource(owner,row.id,uri);current.push(...rows);});}catch(e){for(const row of rows)removeRootAttachmentSource(owner,row.id);throw e;}publishRootMessageFeedback({owner,peer:peers[0],id:group.messageId,group:group.id,direction:'outgoing'});return group.messageId;
}

/** Stage a reviewed batch atomically: a later copy failure cannot send only its first items. */
export async function queueRootAttachmentBatch(input:{peer:string;owner:string;reply?:RootChatReply;audience?:Awaited<ReturnType<typeof rootGroupAttachmentAudience>>;items:{uri:string;name:string;mime:string;caption?:string}[]}){
 const {owner,audience,items}=input,reply=input.reply??audience?.reply;
 const peers=audience?.peers??[input.peer];
 if(!items.length||items.length>4||!peers.length||peers.length>9||localAccount.status().state!=='unlocked'||localAccount.status().account!==owner||audience&&audience.owner!==owner||peers.some(p=>!validAccountId(p)||p===owner))throw Error('Choose up to four attachments and a valid conversation');
 if(reply&&!(audience?validGroupReply(reply):validRootReply(reply,owner,input.peer)))throw Error('Invalid reply');
 if(reply&&audience&&!groupReplyAvailable(await localRootChat().snapshot(),owner,audience.group.id,reply))throw Error('Original group message unavailable');
 if(audience?.reply&&input.reply&&JSON.stringify(input.reply)!==JSON.stringify(audience.reply))throw Error('Reply changed');
 const createdAt=Date.now();const rows:Selection[]=[],sources=new Map<string,string>();
 for(const item of items){
  if(item.caption!==undefined&&(typeof item.caption!=='string'||new TextEncoder().encode(item.caption).length>1600))throw Error('Comment is too long');
  const group=audience?{...audience.group,messageId:await Native!.identityRandomBytes!(32)}:undefined;
  const sharedId=group&&canShare(peers)?await Native!.identityRandomBytes!(32):null;
  for(const peer of peers){
   const id=await Native!.identityRandomBytes!(32);sources.set(id,item.uri);
   rows.push({createdAt,...(sharedId?{shared:{id:sharedId,count:peers.length,slot:peers.indexOf(peer)}}:{}),id,peer,name:item.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment',mime:/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(item.mime.toLowerCase())?item.mime.toLowerCase():'application/octet-stream',failed:false,...(item.caption?{caption:item.caption}:{}),...(group?{group}:{}),...(reply?{reply:{...reply}}:{})});
  }
 }
 try{await changeSelections(owner,current=>{
  if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner||current.length+rows.length>64)throw Error('Finish pending attachments first');
  for(const row of rows)stageRootAttachmentSource(owner,row.id,sources.get(row.id)!);
  current.push(...rows);
 });}catch(error){for(const row of rows)removeRootAttachmentSource(owner,row.id);throw error;}
 const first=rows[0];publishRootMessageFeedback({owner,peer:first.peer,id:first.group?.messageId??first.id,...(first.group?{group:first.group.id}:{}),direction:'outgoing'});
 return first.id;
}

export async function rootAttachmentProgress(){const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')return {jobs:[],selections:[]};
 const jobs=await createMobileAttachmentJobs().list(owner);return {jobs:jobs.map(j=>({id:j.descriptor.manifest.id,phase:j.phase,cursor:j.cursor,bytes:j.descriptor.manifest.bytes,failures:j.failures,digest:j.digest,canPause:!j.receipt&&!['complete','cancelled','expired'].includes(j.phase)})),selections:await selections(owner)};}
export async function retryRootAttachmentSelection(id:string){const owner=localAccount.status().account;if(owner&&localAccount.status().state==='unlocked')await changeSelections(owner,rows=>{const row=rows.find(r=>r.id===id);if(row)row.failed=false;});}
export async function removeRootAttachmentSelection(id:string){const owner=localAccount.status().account;if(owner&&localAccount.status().state==='unlocked')await changeSelections(owner,rows=>{const i=rows.findIndex(r=>r.id===id&&r.failed);if(i>=0){removeRootAttachmentSource(owner,id);rows.splice(i,1);}});}
/** Own transfer jobs are separate from the temporary ciphertext this device holds for other people. */
export function startRootAttachmentRuntime(network:{streams?:AttachmentStreams;sharedPeers?():string[];peers():string[];request(peer:string,raw:string):Promise<string|null>;bulkPeers?():string[];batchChunks?(peer:string):number;batchWindow?(peer:string):number;bulkRequest?(peer:string,raw:string):Promise<string|null>;lookup?(peer:string):Promise<unknown>}){
 activeSharedPeers=network.sharedPeers??null;
 const timingEnabled=(typeof __DEV__!=='undefined'&&__DEV__)||process.env.EXPO_PUBLIC_ATTACHMENT_TIMING==='1',timing=createAttachmentTiming(timingEnabled);
 const timingStarted=Date.now(),snapshotTimings=()=>({startedAt:timingStarted,observedAt:Date.now(),stages:timing.snapshot()});
 if(timingEnabled)activeTimings=snapshotTimings;
 const records=createMobileIdentityRecordStore(Date.now),journal=createMobileAttachmentJobs();
 const store={...journal,save:(...args:Parameters<typeof journal.save>)=>timing.measure('checkpoint',()=>journal.save(...args))};let stopped=false,busy=false,epoch=0,selectionCursor=0;
 const accepted=new Set<string>();const owner=()=>!stopped&&localAccount.status().state==='unlocked'&&!localAccount.status().busy?localAccount.status().account:null;
 let allowedJob:(job:AttachmentJob)=>boolean=()=>false;
 const snapshots=createAttachmentSnapshot({owner,revision:ownChatRevision,read:()=>localRootChat().snapshot()});
 let policyRevision=-1;
 function applyPolicy(snapshot:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>,account:string,revision:number){
  allowedJob=indexAttachmentPolicy(snapshot,account);accepted.clear();for(const c of snapshot.contacts)if(c.accepted&&!c.blocked)accepted.add(c.account);
  for(const g of snapshot.groups??[])if(g.accepted&&!g.blocked&&g.members.includes(account))for(const peer of g.members)if(!snapshot.contacts.some(c=>c.account===peer&&c.blocked))accepted.add(peer);
  policyRevision=revision;
 }
 const streamLease=(job:AttachmentJob,live:()=>Promise<boolean>)=>async()=>{
  if(owner()!==job.owner)return false;const revision=ownChatRevision(job.owner);
  if(revision!==policyRevision){const snapshot=await snapshots.read();if(!snapshot||owner()!==job.owner)return false;applyPolicy(snapshot.state,job.owner,snapshot.revision);}
  return allowedJob(job)&&accepted.has(job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient)&&await live();
 };
 const streams=network.streams?createRootAttachmentStreams(network.streams,network.request):undefined;
 // Updated peers pipeline the bounded window; older peers serialize it safely.
 const worker=createAttachmentTransfer({sharedPeers:network.sharedPeers,downloadWindow:4,uploadWindow:4,owner,device:()=>localAccount.callDevice(),now:Date.now,store,
  directStream:streams?(job,live)=>streams.pull(job,streamLease(job,live)):undefined,
  serveStream:streams?(job,live)=>streams.serve(job,streamLease(job,live)):undefined,
  hashLeaf:Native?.attachmentSha256?value=>Native!.attachmentSha256!(value):undefined,
  bulkPeers:network.bulkPeers,batchChunks:network.batchChunks,batchWindow:network.batchWindow,bulkRequest:network.bulkRequest?(...args)=>timing.measure('network',()=>network.bulkRequest!(...args)):undefined,
  record:async account=>account===owner()?localAccount.publicRecord():records.read(account),peers:network.peers,request:(...args)=>timing.measure('network',()=>network.request(...args)),allowed:peer=>accepted.has(peer),
  allowedJob:job=>allowedJob(job),
  readChunk:(...args)=>timing.measure('readFile',()=>readRootAttachmentChunk(...args)),
  readChunks:(...args)=>timing.measure('readFile',()=>readRootAttachmentChunks(...args)),
  writeChunk:(...args)=>timing.measure('writeFile',()=>writeRootAttachmentChunk(...args)),
  commitFile:(...args)=>timing.measure('verifyFile',()=>commitRootAttachmentFile(...args)),
  signReceipt:async manifest=>timing.measure('receipt',async()=>localAccount.signAttachmentReceipt(manifest)),
  stored:async(job,current)=>{if(current())await localRootChat().networkStored(job.descriptor.manifest.recipient,job.descriptor.manifest.id,job.descriptor.manifest.expires,true);},
  completed:async(job:AttachmentJob,current)=>{if(!current())throw Error('Account locked');
   if(!rootAttachmentFile(job.owner,job.digest).exists)throw Error('Own attachment unavailable');
   const peer=job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient;
   if(!job.receipt||!await timing.measure('chat',()=>localRootChat().attachmentComplete(peer,job.descriptor.manifest.id,job.direction,job.receipt!)))throw Error('Attachment chat receipt unavailable');
   mediaExport.wake();
   if(timingEnabled)console.info('[Axonic attachment timing]',JSON.stringify({direction:job.direction,bytes:job.descriptor.manifest.bytes,stages:timing.snapshot()}));},
 });
 const mediaExport=startRootMediaExport();
 activeControls=worker;
 const unsubscribe=localAccount.subscribe(()=>{epoch++;snapshots.clear();worker.invalidate();accepted.clear();allowedJob=()=>false;policyRevision=-1;});
 let preparing=false;
 const lookupAfter=new Map<string,number>();
 async function prepareSelection(account:string,snapshot:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>,current:()=>boolean){
   const ledger=localRootChat();
   const queued=await selections(account);if(!current())return;const removed=queued.filter(s=>snapshot.hiddenChats?.includes(s.group?'group:'+s.group.id:s.peer));
   if(removed.length){await changeSelections(account,rows=>{for(let i=rows.length-1;i>=0;i--)if(removed.some(r=>r.id===rows[i].id))rows.splice(i,1);});for(const row of removed)removeRootAttachmentSource(account,row.id);}
   for(const peer of lookupAfter.keys())if(!queued.some(s=>s.peer===peer))lookupAfter.delete(peer);
   const eligible=queued.filter(s=>!removed.includes(s)&&!s.failed&&!snapshot.contacts.find(c=>c.account===s.peer)?.blocked);
   const pending=eligible.length?eligible[selectionCursor++%eligible.length]:null;
   if(pending){const record=await records.read(pending.peer);if(!current())return;if(!record||!verifyRecord(record,Date.now())){
     if((lookupAfter.get(pending.peer)??0)<=Date.now()){
      lookupAfter.set(pending.peer,Date.now()+5000);
      try{await network.lookup?.(pending.peer);}finally{if(current())lookupAfter.set(pending.peer,Date.now()+5000);}
     }return;}if(!current())return;
    if(pending.group&&(!rootGroupAllowed(snapshot,account,pending.peer,pending.group)||!snapshot.groups?.find(g=>g.id===pending.group!.id)?.accepted)){await changeSelections(account,rows=>{const row=rows.find(r=>r.id===pending.id);if(row)row.failed=true;});return;}
    try{const descriptor=await timing.measure('prepare',()=>prepareRootAttachment({...pending,recipient:record,current}));if(!current())return;
     await ledger.enqueueAttachment(descriptor,pending.reply,pending.group,pending.createdAt);await worker.enqueue(descriptor,'outgoing');if(!current())return;
     await changeSelections(account,rows=>{const i=rows.findIndex(r=>r.id===pending.id);if(i>=0)rows.splice(i,1);});removeRootAttachmentSource(account,pending.id);
     if(pending.shared&&!(await selections(account)).some(s=>s.shared?.id===pending.shared!.id))removeRootAttachmentSource(account,pending.shared.id);
     return true;
    }catch{if(current())await changeSelections(account,rows=>{const row=rows.find(r=>r.id===pending.id);if(row)row.failed=true;});}return;
   }
 }
 async function tick(){const account=owner(),generation=epoch;if(!account||busy)return;busy=true;
  const current=()=>!stopped&&epoch===generation&&owner()===account;
  try{
   await store.retire?.(account,current);if(!current())return;
   const cached=await snapshots.read();if(!cached||!current())return;const snapshot=cached.state;if(policyRevision!==cached.revision)applyPolicy(snapshot,account,cached.revision);
   // Preparation/identity lookup has its own single flight. Slow remote lookups
   // and local encryption must not hold the download/receipt worker hostage.
   if(!preparing){preparing=true;void prepareSelection(account,snapshot,current)
    .catch(()=>{/* Durable selections remain retryable. */}).finally(()=>{preparing=false;});}
   for(const message of snapshot.messages){if(!current())return;if(message.attachment&&message.status==='pending'&&accepted.has(message.peer)&&(!message.group||rootGroupAllowed(snapshot,account,message.peer,message.group))){
    const m=message.attachment.manifest;if(m.expires>Date.now())await worker.enqueue(message.attachment,message.direction);
   }}
   if(current())return await worker.tick({maxSteps:32,maxMilliseconds:50});
  }catch{/* Retain selections and job checkpoints on unavailable storage or a locked account. */}finally{busy=false;}
 }
 // Yield to React/native events between bursts, but do not throttle every 4-KiB chunk
 // behind a 200-ms polling interval. Idle/error paths retain the low-frequency poll.
 let timer:ReturnType<typeof setTimeout>;
 async function pump(){let progressed=false;try{progressed=!!await tick();}finally{if(!stopped)timer=setTimeout(()=>void pump(),progressed?0:200);}}
 timer=setTimeout(()=>void pump(),0);
 return {receive:(...args:Parameters<typeof worker.receive>)=>timing.measure('serve',()=>worker.receive(...args)),stop(){if(activeSharedPeers===network.sharedPeers)activeSharedPeers=null;if(activeTimings===snapshotTimings)activeTimings=null;if(activeControls===worker)activeControls=null;stopped=true;snapshots.clear();streams?.stop();mediaExport.stop();epoch++;clearTimeout(timer);unsubscribe();worker.stop();},cancel:(digest:string)=>worker.cancel(digest)};
}

