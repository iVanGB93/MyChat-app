import AsyncStorage from '@react-native-async-storage/async-storage';
import Native from '../../../modules/axonic-nearby';
import {attachmentChanged} from './attachmentChanges';
import {publishRootMessageFeedback} from './rootMessageFeedback';
import {groupReplyAvailable,validGroupReply} from './rootGroupActions';
import {validRootReply,type RootChatReply} from './rootChatLedger';
import {validGroupContext} from './rootGroups';
import type {RootGroupContext} from './rootGroupTypes';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {validAccountId} from './identityProtocol';
import {createMobileAttachmentJobs} from './mobileAttachmentJobs';
import {stageRootAttachmentSource,removeRootAttachmentSource} from './rootAttachmentFiles';
/** Mobile durable selection queue. Transfer execution belongs to rootAttachmentRuntime. */
type SharedSelection={id:string;count:number;slot:number};
type Selection={createdAt?:number;shared?:SharedSelection;id:string;peer:string;name:string;mime:string;caption?:string;failed:boolean;reply?:RootChatReply;group?:RootGroupContext};
// Preparation is independent of current connectivity; transport checks capability on reconnect.
function canShare(peers:string[]){return peers.length>1;}
let selectionsTail:Promise<unknown>=Promise.resolve();
const selectionListeners=new Set<(owner:string)=>void>();
export function subscribeAttachmentSelections(listener:(owner:string)=>void){selectionListeners.add(listener);return()=>{selectionListeners.delete(listener);};}
const key=(owner:string)=>'@axonic_attachment_selections_v1:'+owner;
export async function selections(owner:string):Promise<Selection[]>{const raw=await AsyncStorage.getItem(key(owner)),rows=raw?JSON.parse(raw):[];
 if(!Array.isArray(rows)||rows.length>64||rows.some(r=>r.createdAt!==undefined&&(!Number.isSafeInteger(r.createdAt)||r.createdAt<0||r.createdAt>8640000000000000)||r.shared!==undefined&&(!/^[a-f0-9]{64}$/.test(r.shared.id)||!Number.isSafeInteger(r.shared.count)||r.shared.count<2||r.shared.count>9||!Number.isSafeInteger(r.shared.slot)||r.shared.slot<0||r.shared.slot>=r.shared.count)||!/^[a-f0-9]{64}$/.test(r.id)||!validAccountId(r.peer)||typeof r.name!=='string'||r.name.length>120||typeof r.mime!=='string'||r.mime.length>100||typeof r.failed!=='boolean'||r.caption!==undefined&&(typeof r.caption!=='string'||new TextEncoder().encode(r.caption).length>1600)||r.reply!==undefined&&!(r.group?validGroupReply(r.reply):validRootReply(r.reply,owner,r.peer))||r.group!==undefined&&!validGroupContext(r.group)))throw Error('Invalid attachment selections');return rows;}
export function changeSelections(owner:string,change:(rows:Selection[])=>void|Promise<void>){const work=selectionsTail.then(async()=>{const rows=await selections(owner);await change(rows);await AsyncStorage.setItem(key(owner),JSON.stringify(rows));attachmentChanged();for(const listener of selectionListeners)listener(owner);});selectionsTail=work.catch(()=>{});return work;}
export async function queueRootAttachmentSource(peer:string,uri:string,name:string,mime='application/octet-stream',expectedOwner?:string,reply?:RootChatReply,caption?:string,diagnosticId?:string){
 const owner=localAccount.status().account;if(!owner||expectedOwner&&owner!==expectedOwner||!validAccountId(peer)||peer===owner)throw Error('Choose a valid peer identity');
 if(reply!==undefined&&!validRootReply(reply,owner,peer))throw Error('Invalid reply');
 if(caption!==undefined&&(typeof caption!=='string'||new TextEncoder().encode(caption).length>1600))throw Error('Comment is too long');
 const safeName=name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment';
 const safeMime=/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime.toLowerCase())?mime.toLowerCase():'application/octet-stream';
 if(diagnosticId!==undefined&&(!/^[a-f0-9]{64}$/.test(diagnosticId)||mime!=='application/json'||name!==`axonic-diagnostic-v1-${diagnosticId}.json`))throw Error('Invalid diagnostic attachment');
 const id=diagnosticId??await Native!.identityRandomBytes!(32);if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Account changed');
 let staged=false;
 try{await changeSelections(owner,async rows=>{if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Account changed');
  if(diagnosticId){const old=rows.find(r=>r.id===id);if(old){if(old.peer!==peer||old.name!==safeName||old.mime!==safeMime||old.caption!==caption)throw Error('Diagnostic ID conflict');return;}
   const state=await localRootChat().snapshot();
   if(state.removedMessages?.some(m=>m.direction==='outgoing'&&m.id===id&&m.peer===peer)||state.actions?.some(a=>a.kind==='delete'&&a.target.id===id&&a.target.author===owner&&a.peer===peer))throw Error('This report was deleted. Capture a new report');
   const sent=state.messages.find(m=>m.direction==='outgoing'&&m.id===id);if(sent){if(sent.peer!==peer||sent.attachment?.name!==safeName||sent.attachment?.mime!==safeMime)throw Error('Diagnostic ID conflict');return;}}
  if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Account changed');if(rows.length>=4)throw Error('Finish or remove a pending attachment first');staged=true;stageRootAttachmentSource(owner,id,uri);rows.push({createdAt:Date.now(),id,peer,name:safeName,mime:safeMime,failed:false,...(caption?{caption}:{}),...(reply?{reply:{...reply}}: {})});});}
 catch(error){if(staged){
  // A storage error can have an uncertain commit outcome. Never remove a
  // diagnostic payload that a durable selection may already reference.
  const retained=diagnosticId?await selections(owner).then(rows=>rows.some(r=>r.id===id)).catch(()=>true):false;
  if(!retained)removeRootAttachmentSource(owner,id);
 }throw error;}publishRootMessageFeedback({owner,peer,id,direction:'outgoing'});return id;
}
/** Snapshot the audience before opening a native picker. Keep per-recipient transfer IDs; groups share one content key/ciphertext. */
export async function rootGroupAttachmentAudience(groupId:string,reply?:RootChatReply){const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');const s=await localRootChat().snapshot(),g=s.groups?.find(g=>g.id===groupId);if(!g||g.blocked||!g.accepted||!g.members.includes(owner))throw Error('Accept an active group first');if(reply&&!groupReplyAvailable(s,owner,groupId,reply))throw Error('Original group message unavailable');const peers=g.members.filter(p=>p!==owner);if(!peers.length||peers.some(p=>s.contacts.some(c=>c.account===p&&c.blocked)))throw Error('Choose an active group without blocked members');return {owner,peers,group:{id:groupId,revision:g.revision,messageId:await Native!.identityRandomBytes!(32)},...(reply?{reply:{...reply}}:{})};}
export async function queueRootGroupAttachmentSource(audience:Awaited<ReturnType<typeof rootGroupAttachmentAudience>>,uri:string,name:string,mime='application/octet-stream',caption?:string){
 if(caption!==undefined&&(typeof caption!=='string'||new TextEncoder().encode(caption).length>1600))throw Error('Comment is too long');
 const {owner,peers,group,reply}=audience;if(localAccount.status().account!==owner)throw Error('Account changed');
 if(reply&&!groupReplyAvailable(await localRootChat().snapshot(),owner,group.id,reply))throw Error('Original group message unavailable');
 const sharedId=canShare(peers)?await Native!.identityRandomBytes!(32):null;
 const createdAt=Date.now();const rows:Selection[]=[];for(const peer of peers)rows.push({createdAt,... (sharedId?{shared:{id:sharedId,count:peers.length,slot:rows.length}}:{}),id:await Native!.identityRandomBytes!(32),peer,name:name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,120)||'Attachment',mime:/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime.toLowerCase())?mime.toLowerCase():'application/octet-stream',failed:false,...(caption?{caption}:{}),group:{...group},...(reply?{reply:{...reply}}:{})});
 try{await changeSelections(owner,current=>{if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner||current.length+rows.length>64)throw Error('Finish pending attachments first');for(const row of rows)stageRootAttachmentSource(owner,row.id,uri,row.shared?.id);current.push(...rows);});}catch(e){for(const row of rows)removeRootAttachmentSource(owner,row.id);for(const id of new Set(rows.map(r=>r.shared?.id).filter((id):id is string=>!!id)))removeRootAttachmentSource(owner,id);throw e;}publishRootMessageFeedback({owner,peer:peers[0],id:group.messageId,group:group.id,direction:'outgoing'});return group.messageId;
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
  for(const row of rows)stageRootAttachmentSource(owner,row.id,sources.get(row.id)!,row.shared?.id);
  current.push(...rows);
 });}catch(error){for(const row of rows)removeRootAttachmentSource(owner,row.id);for(const id of new Set(rows.map(r=>r.shared?.id).filter((id):id is string=>!!id)))removeRootAttachmentSource(owner,id);throw error;}
 const first=rows[0];publishRootMessageFeedback({owner,peer:first.peer,id:first.group?.messageId??first.id,...(first.group?{group:first.group.id}:{}),direction:'outgoing'});
 return first.id;
}

/** One visible preparation row per group photo; underlying grants remain independent. */
export function groupAttachmentSelections(rows:Selection[]){
 const result:Selection[]=[];
 for(const row of rows){const prior=row.group?result.find(s=>s.group?.id===row.group!.id&&s.group?.messageId===row.group!.messageId):undefined;
  if(prior)prior.failed=prior.failed||row.failed;else result.push({...row});}
 return result;
}
function sameSelection(a:Selection,b:Selection){return a.id===b.id||!!a.group&&a.group.id===b.group?.id&&a.group.messageId===b.group.messageId;}
export async function rootAttachmentProgress(){const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')return {jobs:[],selections:[]};
 const jobs=await createMobileAttachmentJobs().list(owner);return {jobs:jobs.map(j=>({id:j.descriptor.manifest.id,phase:j.phase,cursor:j.cursor,bytes:j.descriptor.manifest.bytes,failures:j.failures,digest:j.digest,canPause:!j.receipt&&['queued','uploading','downloading'].includes(j.phase)})),selections:groupAttachmentSelections(await selections(owner))};}
export async function retryRootAttachmentSelection(id:string){const owner=localAccount.status().account;if(owner&&localAccount.status().state==='unlocked')await changeSelections(owner,rows=>{const row=rows.find(r=>r.id===id);if(row)for(const item of rows)if(sameSelection(row,item))item.failed=false;});}
export async function removeRootAttachmentSelection(id:string){const owner=localAccount.status().account;if(owner&&localAccount.status().state==='unlocked')await changeSelections(owner,rows=>{
 const selected=rows.find(r=>r.id===id);if(!selected)return;
 const batch=rows.filter(r=>sameSelection(selected,r));if(!batch.some(r=>r.failed))return;
 for(const row of batch){removeRootAttachmentSource(owner,row.id);rows.splice(rows.indexOf(row),1);}
 for(const shared of new Set(batch.map(r=>r.shared?.id)))if(shared&&!rows.some(r=>r.shared?.id===shared))removeRootAttachmentSource(owner,shared);
});}
