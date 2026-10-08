import {validRootReply,type RootChatReply} from './rootChatLedger';
import {validGroupContext,rootGroupAllowed} from './rootGroups';
import type {RootGroupContext} from './rootGroupTypes';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {validAccountId,verifyRecord} from './identityProtocol';
import {attachmentDigest} from './attachmentProtocol';
import {createAttachmentTransfer,type AttachmentJob} from './attachmentTransfer';
import {createMobileAttachmentJobs} from './mobileAttachmentJobs';
import {stageRootAttachmentSource,prepareRootAttachment,readRootAttachmentChunk,writeRootAttachmentChunk,commitRootAttachmentFile,rootAttachmentFile,removeRootAttachmentSource} from './rootAttachmentFiles';
type Selection={id:string;peer:string;name:string;mime:string;failed:boolean;reply?:RootChatReply;group?:RootGroupContext};
let activeControls:{cancel(digest:string):Promise<void>;retry(digest:string):Promise<void>}|null=null;
export async function controlRootAttachment(digest:string,action:'pause'|'retry'){
 if(!activeControls||localAccount.status().state!=='unlocked')throw Error('Unlock your account and wait for the network');
 await (action==='pause'?activeControls.cancel(digest):activeControls.retry(digest));
}
let selectionsTail:Promise<unknown>=Promise.resolve();
const key=(owner:string)=>'@axonic_attachment_selections_v1:'+owner;
async function selections(owner:string):Promise<Selection[]>{const raw=await AsyncStorage.getItem(key(owner)),rows=raw?JSON.parse(raw):[];
 if(!Array.isArray(rows)||rows.length>16||rows.some(r=>!/^[a-f0-9]{64}$/.test(r.id)||!validAccountId(r.peer)||typeof r.name!=='string'||r.name.length>120||typeof r.mime!=='string'||r.mime.length>100||typeof r.failed!=='boolean'||r.reply!==undefined&&!validRootReply(r.reply,owner,r.peer)||r.group!==undefined&&(!validGroupContext(r.group)||r.reply)))throw Error('Invalid attachment selections');return rows;}
function changeSelections(owner:string,change:(rows:Selection[])=>void){const work=selectionsTail.then(async()=>{const rows=await selections(owner);change(rows);await AsyncStorage.setItem(key(owner),JSON.stringify(rows));});selectionsTail=work.catch(()=>{});return work;}
export async function queueRootAttachmentSource(peer:string,uri:string,name:string,mime='application/octet-stream',expectedOwner?:string,reply?:RootChatReply){
 const owner=localAccount.status().account;if(!owner||expectedOwner&&owner!==expectedOwner||!validAccountId(peer)||peer===owner)throw Error('Choose a valid peer identity');
 if(reply!==undefined&&!validRootReply(reply,owner,peer))throw Error('Invalid reply');
 const safeName=name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment';
 const safeMime=/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime.toLowerCase())?mime.toLowerCase():'application/octet-stream';
 const id=await Native!.identityRandomBytes!(32);if(localAccount.status().account!==owner)throw Error('Account changed');
 try{await changeSelections(owner,rows=>{if(localAccount.status().account!==owner)throw Error('Account changed');if(rows.length>=4)throw Error('Finish or remove a pending attachment first');stageRootAttachmentSource(owner,id,uri);rows.push({id,peer,name:safeName,mime:safeMime,failed:false,...(reply?{reply:{...reply}}: {})});});}
 catch(error){removeRootAttachmentSource(owner,id);throw error;}return id;
}
/** Snapshot the audience before opening a native picker. Stage each recipient with an independent transfer ID/key. */
export async function rootGroupAttachmentAudience(groupId:string){const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');const s=await localRootChat().snapshot(),g=s.groups?.find(g=>g.id===groupId);if(!g||g.blocked||!g.accepted||!g.members.includes(owner))throw Error('Accept an active group first');const peers=g.members.filter(p=>p!==owner);if(!peers.length||peers.some(p=>s.contacts.some(c=>c.account===p&&c.blocked)))throw Error('Choose an active group without blocked members');return {owner,peers,group:{id:groupId,revision:g.revision,messageId:await Native!.identityRandomBytes!(32)}};}
export async function queueRootGroupAttachmentSource(audience:Awaited<ReturnType<typeof rootGroupAttachmentAudience>>,uri:string,name:string,mime='application/octet-stream'){
 const {owner,peers,group}=audience;if(localAccount.status().account!==owner)throw Error('Account changed');
 const rows:Selection[]=[];for(const peer of peers)rows.push({id:await Native!.identityRandomBytes!(32),peer,name:name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment',mime:/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime.toLowerCase())?mime.toLowerCase():'application/octet-stream',failed:false,group:{...group}});
 try{await changeSelections(owner,current=>{if(localAccount.status().account!==owner||current.length+rows.length>16)throw Error('Finish pending attachments first');for(const row of rows)stageRootAttachmentSource(owner,row.id,uri);current.push(...rows);});}catch(e){for(const row of rows)removeRootAttachmentSource(owner,row.id);throw e;}return group.messageId;
}

export async function rootAttachmentProgress(){const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')return {jobs:[],selections:[]};
 const jobs=await createMobileAttachmentJobs().list(owner);return {jobs:jobs.map(j=>({id:j.descriptor.manifest.id,phase:j.phase,cursor:j.cursor,bytes:j.descriptor.manifest.bytes,failures:j.failures,digest:j.digest,canPause:!j.receipt&&!['complete','cancelled','expired'].includes(j.phase)})),selections:await selections(owner)};}
export async function retryRootAttachmentSelection(id:string){const owner=localAccount.status().account;if(owner&&localAccount.status().state==='unlocked')await changeSelections(owner,rows=>{const row=rows.find(r=>r.id===id);if(row)row.failed=false;});}
export async function removeRootAttachmentSelection(id:string){const owner=localAccount.status().account;if(owner&&localAccount.status().state==='unlocked')await changeSelections(owner,rows=>{const i=rows.findIndex(r=>r.id===id&&r.failed);if(i>=0){removeRootAttachmentSource(owner,id);rows.splice(i,1);}});}
/** Own transfer jobs are separate from the temporary ciphertext this device holds for other people. */
export function startRootAttachmentRuntime(network:{peers():string[];request(peer:string,raw:string):Promise<string|null>;lookup?(peer:string):Promise<unknown>}){
 const records=createMobileIdentityRecordStore(Date.now),store=createMobileAttachmentJobs();let stopped=false,busy=false,epoch=0,selectionCursor=0;
 const accepted=new Set<string>();const owner=()=>!stopped&&localAccount.status().state==='unlocked'&&!localAccount.status().busy?localAccount.status().account:null;
 let policy:Awaited<ReturnType<ReturnType<typeof localRootChat>['snapshot']>>|null=null;
 const worker=createAttachmentTransfer({owner,device:()=>localAccount.callDevice(),now:Date.now,store,
  record:async account=>account===owner()?localAccount.publicRecord():records.read(account),peers:network.peers,request:network.request,allowed:peer=>accepted.has(peer),
  allowedJob:job=>{const m=policy?.messages.find(m=>m.attachment&&attachmentDigest(m.attachment.manifest)===job.digest);return !!m&&(!m.group||!!policy&&rootGroupAllowed(policy,job.owner,m.peer,m.group)&&!!policy.groups?.find(g=>g.id===m.group!.id)?.accepted);},
  readChunk:readRootAttachmentChunk,writeChunk:writeRootAttachmentChunk,commitFile:commitRootAttachmentFile,
  signReceipt:async manifest=>localAccount.signAttachmentReceipt(manifest),
  stored:async(job,current)=>{if(current())await localRootChat().networkStored(job.descriptor.manifest.recipient,job.descriptor.manifest.id,job.descriptor.manifest.expires,true);},
  completed:async(job:AttachmentJob,current)=>{if(!current())throw Error('Account locked');
   if(!rootAttachmentFile(job.owner,job.digest).exists)throw Error('Own attachment unavailable');
   const peer=job.direction==='incoming'?job.descriptor.manifest.sender:job.descriptor.manifest.recipient;
   if(!job.receipt||!await localRootChat().attachmentComplete(peer,job.descriptor.manifest.id,job.direction,job.receipt))throw Error('Attachment chat receipt unavailable');},
 });
 activeControls=worker;
 const unsubscribe=localAccount.subscribe(()=>{epoch++;worker.invalidate();accepted.clear();policy=null;});
 async function tick(){const account=owner(),generation=epoch;if(!account||busy)return;busy=true;
  const current=()=>!stopped&&epoch===generation&&owner()===account;
  try{
   await store.retire?.(account,current);if(!current())return;
   const ledger=localRootChat(),snapshot=await ledger.snapshot();if(!current())return;policy=snapshot;accepted.clear();for(const c of snapshot.contacts)if(c.accepted&&!c.blocked)accepted.add(c.account);
   for(const g of snapshot.groups??[])if(g.accepted&&!g.blocked&&g.members.includes(account))for(const peer of g.members)if(!snapshot.contacts.some(c=>c.account===peer&&c.blocked))accepted.add(peer);
   const queued=await selections(account),removed=queued.filter(s=>snapshot.hiddenChats?.includes(s.group?'group:'+s.group.id:s.peer));
   if(removed.length){await changeSelections(account,rows=>{for(let i=rows.length-1;i>=0;i--)if(removed.some(r=>r.id===rows[i].id))rows.splice(i,1);});for(const row of removed)removeRootAttachmentSource(account,row.id);}
   const eligible=queued.filter(s=>!removed.includes(s)&&!s.failed&&!snapshot.contacts.find(c=>c.account===s.peer)?.blocked);
   const pending=eligible.length?eligible[selectionCursor++%eligible.length]:null;
   if(pending){const record=await records.read(pending.peer);if(!record||!verifyRecord(record,Date.now())){await network.lookup?.(pending.peer);return;}if(!current())return;
    if(pending.group&&(!rootGroupAllowed(snapshot,account,pending.peer,pending.group)||!snapshot.groups?.find(g=>g.id===pending.group!.id)?.accepted)){await changeSelections(account,rows=>{const row=rows.find(r=>r.id===pending.id);if(row)row.failed=true;});return;}
    try{const descriptor=await prepareRootAttachment({...pending,recipient:record,current});if(!current())return;
     await ledger.enqueueAttachment(descriptor,pending.reply,pending.group);await worker.enqueue(descriptor,'outgoing');if(!current())return;
     await changeSelections(account,rows=>{const i=rows.findIndex(r=>r.id===pending.id);if(i>=0)rows.splice(i,1);});removeRootAttachmentSource(account,pending.id);
    }catch{if(current())await changeSelections(account,rows=>{const row=rows.find(r=>r.id===pending.id);if(row)row.failed=true;});}return;
   }
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
 return {receive:worker.receive,stop(){if(activeControls===worker)activeControls=null;stopped=true;epoch++;clearTimeout(timer);unsubscribe();worker.stop();},cancel:(digest:string)=>worker.cancel(digest)};
}
