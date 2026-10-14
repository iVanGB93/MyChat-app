import {rootMessageStatus} from './rootMessageStatus.ts';
import {profileAudience,syncProfileAudience,validProfileStorage,pendingProfiles} from './rootProfileSharing.ts';
import {validOwnProfile,validProfileManifest,profileOfferId,profileHash,profilePartId,profileCount,type OwnProfile,type ProfilePart,type ProfileManifest} from './rootProfileProtocol.ts';
import {validCreationTime} from './rootChatTypes.ts';
import {validGroupReply,groupReplyAvailable,validGroupAction,enqueueGroupAction,receiveGroupAction,encodeGroupAction,type RootGroupAction} from './rootGroupActions.ts';
import type {RootChatAction,RootActionKind} from './rootChatActionTypes.ts';
import {validRootAction,actionFamily,sameTarget,sameAction,encodeRootAction} from './rootChatActions.ts';
import { validAccountId } from './identityProtocol.ts';
import {validAttachmentDescriptor,attachmentDescriptorFingerprint,type AttachmentDescriptor} from './attachmentTransfer.ts';
import type {AttachmentReceipt} from './attachmentProtocol.ts';
import type {RootChatReply,RootChatMessage,RootChatContact,RootChatState} from './rootChatTypes.ts';
import {validRootGroupBackup,queueRootGroupBackup,recoverRootGroupsForPeer,changeRootGroup,receiveRootGroupControl,leaveRootGroup,validGroupContext,validGroupStorage,rootGroupAllowed,encodeRootGroupMessage,rootGroupDeliveryId} from './rootGroups.ts';
import type {RootGroupContext,RootGroupMembership,RootGroupBackup} from './rootGroupTypes.ts';
export type {RootChatReply,RootChatMessage,RootChatContact,RootChatState} from './rootChatTypes.ts';
const idValid=(id:string)=>/^[a-f0-9]{64}$/.test(id);
export const validRootReply=(r:unknown,owner:string,peer:string):r is RootChatReply=>{const v=r as RootChatReply;return !!v&&Object.keys(v).length===2&&idValid(v.id)&&(v.author===owner||v.author===peer);};
const sameReply=(a?:RootChatReply,b?:RootChatReply)=>a?.id===b?.id&&a?.author===b?.author;
const byteLength=(text:string)=>new TextEncoder().encode(text).length;
/** Private own history. Peer identity comes exclusively from the authenticated transport. */
export function createRootChatLedger(d:{owner:string;read():Promise<string|null>;write(raw:string):Promise<void>;current():boolean;now():number;
 queued?(peer:string,id:string):void;
 profileChanged?():void;
 receiveProfileOffer?(from:string,manifest:ProfileManifest):Promise<{known:string|null;needed:boolean}|null>;
 receiveProfile?(from:string,id:string,part:ProfilePart):Promise<boolean>;
 messageCommitted?(message:RootChatMessage,state:RootChatState):void;
 signGroup?(group:RootGroupMembership):RootGroupBackup;
 verifyAttachment?(descriptor:AttachmentDescriptor,direction:RootChatMessage['direction']):Promise<boolean>;
 verifyAttachmentReceipt?(descriptor:AttachmentDescriptor,receipt:AttachmentReceipt):Promise<boolean>;
}){
 if(!validAccountId(d.owner))throw Error('Invalid account');
 let knownMessages=new Set<string>(),profileState='';
 // Cache only successful validation of identical persisted bytes for this owner.
 // Every read still checks unlock state and returns a fresh mutable object.
 let validatedRaw:string|null=null;
 const messageKey=(m:RootChatMessage)=>m.direction+':'+m.peer+':'+m.id;
 let tail:Promise<unknown>=Promise.resolve();
 const run=<T>(work:()=>Promise<T>)=>{const p=tail.then(work);tail=p.catch(()=>{});return p;};
 const check=()=>{if(!d.current())throw Error('Unlock your account first');};
 const validPeer=(peer:string)=>validAccountId(peer)&&peer!==d.owner;
 const validChat=(key:string)=>typeof key==='string'&&(key.startsWith('group:')?idValid(key.slice(6)):validPeer(key));
 async function read():Promise<RootChatState>{
  check();const raw=await d.read();check();if(raw===null){knownMessages.clear();return {version:1,messages:[],contacts:[]};}
  const s=JSON.parse(raw) as RootChatState;
  if(raw!==validatedRaw){
  if(s.groupCustodyPeers!==undefined&&(!Array.isArray(s.groupCustodyPeers)||s.groupCustodyPeers.length>500||s.groupCustodyPeers.some(p=>!validPeer(p)))||!validProfileStorage(s,d.owner)||s.timestampPeers!==undefined&&(!Array.isArray(s.timestampPeers)||s.timestampPeers.length>500||s.timestampPeers.some(p=>!validPeer(p)))||s.version!==1||!Array.isArray(s.messages)||!Array.isArray(s.contacts)||s.messages.length>5000||s.contacts.length>500
   ||s.hiddenChats!==undefined&&(!Array.isArray(s.hiddenChats)||s.hiddenChats.length>564||s.hiddenChats.some(k=>!validChat(k)))
   ||s.removedMessages!==undefined&&(!Array.isArray(s.removedMessages)||s.removedMessages.length>20000||s.removedMessages.some(m=>!validPeer(m.peer)||!idValid(m.id)||!['incoming','outgoing'].includes(m.direction)))
   ||(s.imports!==undefined&&(!Array.isArray(s.imports)||s.imports.length>10||s.imports.some(v=>typeof v!=='string'||v.length>100)))
   ||s.messages.some(m=>[m.queuedAt,m.storedAt,m.deliveredAt,m.readAt,m.descriptorReceivedAt].some(v=>v!==undefined&&!validCreationTime(v)))
   ||s.messages.some(m=>[m.networkStoredUntil,m.attachmentStoredUntil].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||m.createdAt!==undefined&&(!validCreationTime(m.createdAt)||m.at!==m.createdAt)||!idValid(m.id)||!validPeer(m.peer)||!['incoming','outgoing'].includes(m.direction)||typeof m.text!=='string'||!m.text||byteLength(m.text)>1600||!Number.isSafeInteger(m.at)||!['pending','delivered'].includes(m.status)
    ||m.reply!==undefined&&(!(m.group?validGroupReply(m.reply):validRootReply(m.reply,d.owner,m.peer)))
    ||m.descriptorDelivered!==undefined&&typeof m.descriptorDelivered!=='boolean'
    ||m.attachment!==undefined&&(!validAttachmentDescriptor(m.attachment)||m.attachment.manifest.id!==m.id||m.text!==m.attachment.name
     ||m.attachment.manifest.sender!==(m.direction==='outgoing'?d.owner:m.peer)||m.attachment.manifest.recipient!==(m.direction==='incoming'?d.owner:m.peer)))
   ||(s.actions!==undefined&&(!Array.isArray(s.actions)||s.actions.length>10000||s.actions.some(a=>!validPeer(a.peer)||!validRootAction(a,d.owner,a.peer))))
   ||s.contacts.some(c=>!validPeer(c.account)||typeof c.alias!=='string'||c.alias.length>80||typeof c.blocked!=='boolean'||typeof c.accepted!=='boolean'||c.muted!==undefined&&typeof c.muted!=='boolean')
   ||(s.groups!==undefined||s.groupPackets!==undefined)&&!validGroupStorage(s,d.owner)
   ||s.messages.some(m=>[m.networkStoredUntil,m.attachmentStoredUntil].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||m.group!==undefined&&(!validGroupContext(m.group)||!s.groups?.some(g=>g.id===m.group!.id)))
   ||s.groupActions!==undefined&&(!Array.isArray(s.groupActions)||s.groupActions.length>10000||s.groupActions.some(a=>!validGroupAction(a,d.owner)||!s.groups?.some(g=>g.id===a.group.id)))
   ||s.groupSeen!==undefined&&(!Array.isArray(s.groupSeen)||s.groupSeen.length>2000||s.groupSeen.some(v=>!validPeer(v.peer)||!idValid(v.id)||typeof v.raw!=='string'||byteLength(v.raw)>2048)))throw Error('Chat storage needs recovery; it was not replaced');
  if(s.groups?.some(g=>g.recoveryPending!==undefined&&(g.recoveryPending!==true||g.admin!==d.owner||g.accepted)||g.backup!==undefined&&(!validRootGroupBackup(g.backup)||g.backup.group.id!==g.id||g.backup.group.admin!==g.admin)))throw Error('Group backup needs recovery; it was not replaced');
  validatedRaw=raw;
  }
  if(d.messageCommitted)knownMessages=new Set(s.messages.map(messageKey));
  return s;
 }
 async function save(s:RootChatState){check();const previousProfilePeers=new Set(s.profileDeliveries?.map(p=>p.peer)??[]);syncProfileAudience(s,d.owner);await d.write(JSON.stringify(s));check();const profileKey=JSON.stringify([s.ownProfile?.manifest??null,profileAudience(s,d.owner),s.profilePeers??[],s.profileOfferPeers??[]]);if(profileKey!==profileState){profileState=profileKey;d.profileChanged?.();}if(s.profileDeliveries?.some(p=>!previousProfilePeers.has(p.peer)))for(const p of pendingProfiles(s,d.owner))if(!previousProfilePeers.has(p.peer))d.queued?.(p.peer,p.id);if(d.messageCommitted)for(const m of s.messages){const key=messageKey(m);if(knownMessages.has(key))continue;knownMessages.add(key);try{d.messageCommitted(m,s);}catch{/* Feedback cannot invalidate durable delivery. */}}}
 function signGroups(s:RootChatState,id:string){
  if(!d.signGroup)return;
  for(const g of s.groups??[])if(g.admin===d.owner&&!g.blocked&&!g.recoveryPending&&(!g.backup||g.backup.group.revision!==g.revision)){
   g.backup=d.signGroup(g);queueRootGroupBackup(s,d.owner,g,rootGroupDeliveryId(id,g.id,'signed-group-backup'));
  }
 }
 function contact(s:RootChatState,peer:string){let c=s.contacts.find(c=>c.account===peer);if(!c){if(s.contacts.length>=500)throw Error('Contact storage is full');c={account:peer,alias:'',blocked:false,accepted:false};s.contacts.push(c);}return c;}
 function applyAction(s:RootChatState,peer:string,id:string,target:RootChatReply,kind:RootActionKind,text=''){
   if(!validPeer(peer))throw Error('Invalid identity');
   const c=contact(s,peer);if(c.blocked)throw Error('This identity is blocked');
   const m=s.messages.find(m=>m.peer===peer&&m.id===target.id&&(m.direction==='outgoing'?d.owner:peer)===target.author);
   if(!m)throw Error('Original message unavailable');
   if(m.group)throw Error('Group message actions are not available yet');
   const previous=(s.actions??[]).filter(a=>a.peer===peer&&a.direction==='outgoing'&&sameTarget(a.target,target)&&actionFamily(a.kind)===actionFamily(kind));
   const event:RootChatAction={id,peer,direction:'outgoing',target:{...target},kind,text,revision:kind==='read'?1:Math.max(0,...previous.map(a=>a.revision))+1,at:d.now(),status:'pending'};
   if(!validRootAction(event,d.owner,peer)||byteLength(encodeRootAction(event))>2048)throw Error('Invalid action or text too long');
   if(kind==='edit'&&m.attachment)throw Error('Only text messages can be edited');
   if(s.groupActions?.some(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id)||s.messages.some(m=>[m.networkStoredUntil,m.attachmentStoredUntil].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||m.peer===peer&&m.direction==='outgoing'&&m.id===id))throw Error('Message ID conflict');
   const retry=s.actions?.find(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id);
   if(retry){if(retry.kind!==kind||retry.text!==text||!sameTarget(retry.target,target))throw Error('Action ID conflict');return false;}
   if(s.actions?.some(a=>a.peer===peer&&sameTarget(a.target,target)&&a.kind==='delete')){
    // A deletion may arrive after the UI selected unread messages. Do not
    // acknowledge deleted content or prevent other messages being marked read.
    if(kind==='read'||kind==='delete')return false;
    throw Error('Message was deleted');
   }
   if(kind==='read'&&previous.length)return false;
   if((s.actions?.length??0)>=10000)throw Error('Action storage is full');
   (s.actions??=[]).push(event);return true;
 }
 type AttachmentInput={input:AttachmentDescriptor;reply?:RootChatReply;group?:RootGroupContext;selectedAt?:number};
 async function enqueueAttachments(items:AttachmentInput[]){
  if(!items.length||items.length>9)throw Error('Invalid attachment batch');
  const s=await read(),notices:{peer:string;id:string}[]=[];
  async function append({input,reply,group,selectedAt}:AttachmentInput){
   if(selectedAt!==undefined&&!validCreationTime(selectedAt))throw Error('Invalid creation time');check();if(!validAttachmentDescriptor(input))throw Error('Invalid attachment');const descriptor=JSON.parse(JSON.stringify(input)) as AttachmentDescriptor;
   const {id,recipient:peer,sender}=descriptor.manifest;
   if(group&&!validGroupContext(group))throw Error('Invalid group attachment');
   if(reply!==undefined&&!(group?validGroupReply(reply):validRootReply(reply,d.owner,peer)))throw Error('Invalid reply');
   if(reply)reply={...reply};
   if(sender!==d.owner||!validPeer(peer)||byteLength(group?encodeRootGroupMessage({id,peer,direction:'outgoing',text:descriptor.name,at:d.now(),status:'pending',attachment:descriptor,group,...(reply?{reply}:{})}):encodeRootAttachment(peer,id,descriptor,reply))+17>2048||!await d.verifyAttachment?.(descriptor,'outgoing'))throw Error('Attachment identity could not be verified');
   const c=group?(s.contacts.find(c=>c.account===peer)??{blocked:false,accepted:false}):contact(s,peer);if(c.blocked)throw Error('This identity is blocked');
   if(s.hiddenChats?.includes(group?'group:'+group.id:peer))throw Error('This conversation was deleted');
   if(group&&(!rootGroupAllowed(s,d.owner,peer,group)||!s.groups?.find(g=>g.id===group.id)?.accepted))throw Error('Group membership changed');
   if(reply&&!(group?groupReplyAvailable(s,d.owner,group.id,reply):s.messages.some(m=>!m.group&&m.peer===peer&&m.id===reply!.id&&(m.direction==='outgoing'?d.owner:peer)===reply!.author)))throw Error('Original message is no longer available');
   const old=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction==='outgoing');if(old){if(JSON.stringify(old.group)!==JSON.stringify(group)||!sameReply(old.reply,reply)||!old.attachment||attachmentDescriptorFingerprint(old.attachment)!==attachmentDescriptorFingerprint(descriptor))throw Error('Attachment ID conflict');return;}
   if(s.messages.length>=5000)throw Error('Chat storage is full');if(!group)c.accepted=true;
   const at=selectedAt??d.now();s.hiddenChats=s.hiddenChats?.filter(k=>k!==(typeof group!=='undefined'&&group?'group:'+group.id:peer));s.messages.push({id,peer,direction:'outgoing',text:descriptor.name,at,queuedAt:d.now(),...(s.timestampPeers?.includes(peer)?{createdAt:at}:{}),status:'pending',attachment:descriptor,descriptorDelivered:false,...(reply?{reply}: {}),...(group?{group:{...group}}:{})});notices.push({peer,id});

  }
  for(const item of items)await append(item);
  if(notices.length){await save(s);for(const {peer,id} of notices)d.queued?.(peer,id);}
 }
 return {
  snapshot:()=>run(read),
  rememberProfilePeers:(peers:string[])=>run(async()=>{if(!peers.length)return;const s=await read(),before=(s.profilePeers??[]).length,known=new Set(s.profilePeers??[]);for(const p of peers)if(validPeer(p)&&known.size<500)known.add(p);if(known.size!==before){s.profilePeers=[...known];await save(s);}}),
  rememberProfileOfferPeers:(peers:string[])=>run(async()=>{const s=await read(),known=new Set(s.profileOfferPeers??[]),before=known.size;for(const p of peers)if(validPeer(p)&&known.size<500)known.add(p);if(before!==known.size){s.profileOfferPeers=[...known];await save(s);}}),
  publishProfile:(profile:OwnProfile)=>run(async()=>{if(!validOwnProfile(profile,d.owner))throw Error('Invalid signed avatar');const s=await read();if(s.ownProfile&&profile.manifest.revision<=s.ownProfile.manifest.revision)throw Error('Avatar version must increase');s.ownProfile=profile;s.profileDeliveries=[];await save(s);for(const p of pendingProfiles(s,d.owner))d.queued?.(p.peer,p.id);}),
  requestProfile:(peer:string,id:string,known:string|null)=>run(async()=>{const s=await read();if(!idValid(id)||known!==null&&!idValid(known)||!profileAudience(s,d.owner).includes(peer)||!s.profilePeers?.includes(peer))return;if(s.profileRequests?.some(p=>p.peer===peer))return;(s.profileRequests??=[]).push({peer,id,known});await save(s);d.queued?.(peer,id);}),
  rememberTimestampPeers:(peers:string[])=>run(async()=>{if(!peers.length)return;const s=await read(),known=new Set(s.timestampPeers??[]);for(const p of peers)if(validPeer(p)&&known.size<500)known.add(p);if(known.size!==(s.timestampPeers?.length??0)){s.timestampPeers=[...known];await save(s);}}),
  rememberGroupCustodyPeers:(peers:string[])=>run(async()=>{if(!peers.length)return;const s=await read(),known=new Set(s.groupCustodyPeers??[]);for(const p of peers)if(validPeer(p)&&known.size<500)known.add(p);if(known.size!==(s.groupCustodyPeers?.length??0)){s.groupCustodyPeers=[...known];await save(s);}}),
  recoverGroupsForPeer:(peer:string,requestId:string)=>run(async()=>{const s=await read(),before=JSON.stringify(s);signGroups(s,requestId);recoverRootGroupsForPeer(s,d.owner,peer,requestId);if(JSON.stringify(s)!==before)await save(s);}),
  deleteChats:(keys:string[])=>run(async()=>{
   if(!Array.isArray(keys)||!keys.length||keys.some(k=>!validChat(k)))throw Error('Choose valid chats');
   const s=await read(),chosen=new Set(keys),matches=(m:RootChatMessage)=>chosen.has(m.group?'group:'+m.group.id:m.peer);
   const removed=s.messages.filter(matches),tombstones=[...(s.removedMessages??[])];
   for(const m of removed)if(!tombstones.some(t=>t.peer===m.peer&&t.id===m.id&&t.direction===m.direction))tombstones.push({peer:m.peer,id:m.id,direction:m.direction});
   if(tombstones.length>20000)throw Error('Deleted-message history is full');
   s.removedMessages=tombstones;s.messages=s.messages.filter(m=>!matches(m));
   s.actions=s.actions?.filter(a=>!chosen.has(a.peer));
   s.groupActions=s.groupActions?.filter(a=>!chosen.has('group:'+a.group.id));
   s.hiddenChats=[...new Set([...(s.hiddenChats??[]),...keys])];
   await save(s);return removed;
  }),
  createGroup:(id:string,packetId:string,name:string,members:string[])=>run(async()=>{const s=await read();if(s.groups?.some(g=>g.id===id))throw Error('Group already exists');changeRootGroup(s,d.owner,id,packetId,name,members);signGroups(s,packetId);await save(s);}),
  updateGroup:(id:string,packetId:string,name:string,members:string[],photo?:string|null)=>run(async()=>{const s=await read();if(!s.groups?.some(g=>g.id===id))throw Error('Group unavailable');changeRootGroup(s,d.owner,id,packetId,name,members,photo);signGroups(s,packetId);await save(s);}),
  configureGroup:(id:string,patch:{accepted?:boolean;blocked?:boolean;muted?:boolean})=>run(async()=>{if(!patch||Object.keys(patch).some(k=>!['accepted','blocked','muted'].includes(k))||patch.accepted!==undefined&&typeof patch.accepted!=='boolean'||patch.blocked!==undefined&&typeof patch.blocked!=='boolean'||patch.muted!==undefined&&typeof patch.muted!=='boolean')throw Error('Invalid group preferences');const s=await read(),g=s.groups?.find(g=>g.id===id);if(!g)throw Error('Group unavailable');if(patch.accepted===true&&g.recoveryPending){if(g.admin!==d.owner||!d.signGroup)throw Error('Group recovery signing unavailable');delete g.recoveryPending;g.accepted=true;signGroups(s,rootGroupDeliveryId(g.id,d.owner,'confirm-group-recovery'));}if(patch.accepted!==undefined)g.accepted=patch.accepted;if(patch.blocked!==undefined)g.blocked=patch.blocked;if(patch.muted!==undefined)g.muted=patch.muted;await save(s);}),
  markGroupRead:(id:string)=>run(async()=>{const s=await read();let changed=false;for(const m of s.messages)if(m.group?.id===id&&m.direction==='incoming'&&!m.read){const g=s.groups?.find(g=>g.id===id);if(g?.accepted&&!g.blocked&&g.members.includes(d.owner)&&g.members.includes(m.peer)&&!s.contacts.some(c=>c.account===m.peer&&c.blocked)&&!s.groupActions?.some(a=>a.group.id===id&&a.target.id===m.group!.messageId&&a.target.author===m.peer&&a.kind==='delete'))enqueueGroupAction(s,d.owner,id,rootGroupDeliveryId(m.group.messageId,d.owner,'read'),{id:m.group.messageId,author:m.peer},'read','',d.now());m.read=true;m.readAt??=d.now();changed=true;}if(changed)await save(s);}),
  leaveGroup:(id:string,packetId:string)=>run(async()=>{const s=await read();leaveRootGroup(s,d.owner,id,packetId);signGroups(s,packetId);await save(s);}),
  actGroup:(groupId:string,id:string,target:RootChatReply,kind:RootGroupAction['kind'],text='')=>run(async()=>{const s=await read();const applied=enqueueGroupAction(s,d.owner,groupId,id,target,kind,text,d.now());if(applied)await save(s);return applied;}),
  enqueueGroup:(groupId:string,id:string,text:string,reply?:RootChatReply)=>run(async()=>{
   const s=await read(),g=s.groups?.find(g=>g.id===groupId);if(!g||g.blocked||!g.accepted||!g.members.includes(d.owner)||!idValid(id)||!text.trim()||byteLength(text)>1600)throw Error('Accept an active group and enter a message up to 1,600 bytes');
   if(reply&&(!validGroupReply(reply)||!s.messages.some(m=>m.group?.id===groupId&&m.group.messageId===reply.id&&(m.direction==='outgoing'?d.owner:m.peer)===reply.author)))throw Error('Original group message unavailable');
   const recipients=g.members.filter(peer=>peer!==d.owner);if(!recipients.length)throw Error('Add another member first');
   if(s.messages.some(m=>m.direction==='outgoing'&&m.group?.messageId===id&&(m.group.id!==groupId||m.group.revision!==g.revision||m.text!==text||!!m.attachment||!sameReply(m.reply,reply))))throw Error('Message ID conflict');
   if(recipients.some(peer=>s.contacts.some(c=>c.account===peer&&c.blocked)))throw Error('Unblock group members before sending');
   const at=s.messages.find(m=>m.direction==='outgoing'&&m.group?.messageId===id)?.at??d.now();
   for(const peer of recipients){const deliveryId=rootGroupDeliveryId(id,peer),m:RootChatMessage={id:deliveryId,peer,direction:'outgoing',text,at,queuedAt:d.now(),...(s.timestampPeers?.includes(peer)?{createdAt:at}:{}),status:'pending',group:{id:groupId,revision:g.revision,messageId:id},...(reply?{reply:{...reply}}:{})};
    if(byteLength(encodeRootGroupMessage(m))>2048)throw Error('Message is too large for delivery');
    const old=s.messages.find(v=>v.peer===peer&&v.id===deliveryId&&v.direction==='outgoing');if(old){if(old.text!==text||old.group?.id!==groupId||old.attachment)throw Error('Message ID conflict');continue;}
    if(s.groupActions?.some(v=>v.peer===peer&&v.id===deliveryId&&v.direction==='outgoing')||s.actions?.some(v=>v.peer===peer&&v.id===deliveryId&&v.direction==='outgoing')||s.groupPackets?.some(v=>v.peer===peer&&v.id===deliveryId)||s.messages.length>=5000)throw Error('Message ID conflict or chat storage full');
    s.messages.push(m);
   }s.hiddenChats=s.hiddenChats?.filter(k=>k!=='group:'+groupId);await save(s);
  }),
  importRelationships:(source:string,contacts:RootChatContact[])=>run(async()=>{
   if(!source||source.length>100||contacts.some(c=>!validPeer(c.account)||typeof c.alias!=='string'||c.alias.length>80||typeof c.blocked!=='boolean'||typeof c.accepted!=='boolean'||c.muted!==undefined&&typeof c.muted!=='boolean'))throw Error('Invalid relationship migration');
   const s=await read();if(s.imports?.includes(source))return;
   if((s.imports?.length??0)>=10)throw Error('Relationship migration storage is full');
   for(const entry of contacts){const c=contact(s,entry.account);c.blocked ||= entry.blocked;c.accepted ||= entry.accepted;if(!c.alias)c.alias=entry.alias;}
   s.imports=[...(s.imports??[]),source];await save(s);
  }),
  configure:(peer:string,patch:Partial<Pick<RootChatContact,'alias'|'blocked'|'accepted'|'muted'>>)=>run(async()=>{if(!validPeer(peer))throw Error('Invalid identity code');const s=await read(),c=contact(s,peer);if(patch.alias!==undefined)c.alias=patch.alias.trim().slice(0,80);if(patch.blocked!==undefined)c.blocked=patch.blocked;if(patch.accepted!==undefined){c.accepted=patch.accepted;if(patch.accepted)s.hiddenChats=s.hiddenChats?.filter(k=>k!==peer);}if(patch.muted!==undefined){if(typeof patch.muted!=='boolean')throw Error('Invalid notification preference');c.muted=patch.muted;}await save(s);}),
  enqueue:(peer:string,id:string,text:string,reply?:RootChatReply)=>run(async()=>{
   if(!validPeer(peer)||!idValid(id)||!text.trim()||byteLength(text)>1600)throw Error('Enter a valid peer and a message up to 1,600 bytes');
   if(reply!==undefined&&!validRootReply(reply,d.owner,peer))throw Error('Invalid reply');
   if(reply)reply={...reply};
   if(byteLength(encodeRootChat(peer,id,text,reply))+17>2048)throw Error('Message is too large for delivery');
   const s=await read(),c=contact(s,peer);if(c.blocked)throw Error('This identity is blocked');
   if(s.groupActions?.some(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id)||s.actions?.some(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id))throw Error('Message ID conflict');
   const reference=reply;
   if(reference&&!s.messages.some(m=>m.peer===peer&&m.id===reference.id&&(m.direction==='outgoing'?d.owner:peer)===reference.author))throw Error('Original message is no longer available');
   const old=s.messages.find(m=>m.id===id&&m.peer===peer&&m.direction==='outgoing');if(old){if(old.text!==text||old.attachment||!sameReply(old.reply,reply))throw Error('Message ID conflict');return;}
   if(s.messages.length>=5000)throw Error('Chat storage is full');c.accepted=true;
   const at=d.now();s.hiddenChats=s.hiddenChats?.filter(k=>k!==peer);s.messages.push({id,peer,direction:'outgoing',text,at,queuedAt:d.now(),...(s.timestampPeers?.includes(peer)?{createdAt:at}:{}),status:'pending',...(reply?{reply:{...reply}}:{})});await save(s);d.queued?.(peer,id);
  }),

  act:(peer:string,id:string,target:RootChatReply,kind:RootActionKind,text='')=>run(async()=>{
   const s=await read(),applied=applyAction(s,peer,id,target,kind,text);if(applied)await save(s);return applied;
  }),
  readBatch:(peer:string,items:{id:string;target:RootChatReply}[])=>run(async()=>{
   if(items.length>20)throw Error('Read batch too large');
   const s=await read();let changed=false;
   for(const item of items)changed=applyAction(s,peer,item.id,item.target,'read')||changed;
   if(changed)await save(s);
  }),
  enqueueAttachment:(input:AttachmentDescriptor,reply?:RootChatReply,group?:RootGroupContext,selectedAt?:number)=>run(()=>enqueueAttachments([{input,reply,group,selectedAt}])),
  enqueueAttachments:(items:AttachmentInput[])=>run(()=>enqueueAttachments(items)),
  receive:(from:string,id:string,raw:string)=>run(async()=>{
   if(!validPeer(from)||!idValid(id)||byteLength(raw)>2048)return false;
   let a;try{a=JSON.parse(raw);}catch{return false;}
   if(!Array.isArray(a)||![4,5].includes(a.length)||a[1]!==d.owner||a[2]!==id)return false;
   const createdAt=a.length===5?a[4]:undefined;if(a.length===5&&(!validCreationTime(createdAt)||!['axonic-root-text-v1','axonic-root-reply-v1','axonic-root-attachment-v1','axonic-root-attachment-reply-v1','axonic-root-group-text-v1','axonic-root-group-attachment-v1'].includes(a[0])))return false;
   const prior=await read();
   if(a[0]==='axonic-avatar-offer-v1'){
    if(!profileAudience(prior,d.owner).includes(from)||id!==profileOfferId(from,d.owner,a[3]))return false;
    if(a[3]===null){d.profileChanged?.();return true;}
    if(!validProfileManifest(a[3],from)||a[3].revision>d.now()+300000)return false;
    const result=await d.receiveProfileOffer?.(from,a[3]);check();if(!result)return false;
    if(result.needed){
     const requestId=profileHash(new TextEncoder().encode(JSON.stringify(['axonic-avatar-fetch-v1',from,d.owner,id,result.known])));
     const requests=(prior.profileRequests??[]).filter(p=>p.peer!==from);
     requests.push({peer:from,id:requestId,known:result.known,target:{revision:a[3].revision,hash:a[3].hash}});prior.profileRequests=requests;
     if(!prior.profilePeers?.includes(from))(prior.profilePeers??=[]).push(from);
     await save(prior);d.queued?.(from,requestId);
    }
    d.profileChanged?.();return true;
   }
   if(a[0]==='axonic-avatar-part-v1'){
    if(!profileAudience(prior,d.owner).includes(from))return false;
    return await d.receiveProfile?.(from,id,a[3])??false;
   }
   if(a[0]==='axonic-avatar-fetch-v1'){
    const target=a[3];if(!target||Object.keys(target).sort().join(',')!=='hash,known,revision'||!idValid(target.hash)||!Number.isSafeInteger(target.revision)||target.revision<1||target.known!==null&&!idValid(target.known)||!profileAudience(prior,d.owner).includes(from))return false;
    if(!prior.ownProfile||prior.ownProfile.manifest.revision!==target.revision||prior.ownProfile.manifest.hash!==target.hash)return true;
    a[0]='axonic-avatar-request-v1';a[3]=target.known;
   }
   if(a[0]==='axonic-avatar-request-v1'){
    if(a[3]!==null&&!idValid(a[3])||!profileAudience(prior,d.owner).includes(from))return false;
    if(prior.ownProfile&&a[3]!==prior.ownProfile.manifest.hash){
     if(!prior.profilePeers?.includes(from))(prior.profilePeers??=[]).push(from);
     syncProfileAudience(prior,d.owner);const row=prior.profileDeliveries?.find(p=>p.peer===from);
     if(row){row.requested=true;row.acked=[];await save(prior);for(const packet of pendingProfiles(prior,d.owner).filter(p=>p.peer===from))d.queued?.(packet.peer,packet.id);}
    }
    return true;
   }
   if(prior.removedMessages?.some(m=>m.peer===from&&m.id===id&&m.direction==='incoming'))return true;
   if(a[0]==='axonic-root-group-action-v1'){const s=await read();if(!receiveGroupAction(s,d.owner,from,id,a[3],d.now()))return false;await save(s);return true;}
   if(a[0]==='axonic-group-members-v1'||a[0]==='axonic-group-leave-v1'||a[0]==='axonic-group-recover-v1'||a[0]==='axonic-group-backup-v1'||a[0]==='axonic-group-recovery-offer-v1'){
    const s=await read(),old=s.groupSeen?.find(v=>v.peer===from&&v.id===id);if(old)return old.raw===raw;
    if(s.groupActions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming'))return false;
    if((s.groupSeen?.length??0)>=2000||s.messages.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming')||s.actions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming'))return false;
    if(!receiveRootGroupControl(s,d.owner,from,id,a[0],a[3]))return false;
    signGroups(s,id);(s.groupSeen??=[]).push({peer:from,id,raw});await save(s);return true;
   }
   let group:RootGroupContext|undefined,groupReply:RootChatReply|undefined;
   if(a[0]==='axonic-root-group-text-v1'||a[0]==='axonic-root-group-attachment-v1'){
    const body=a[3],isAttachment=a[0]==='axonic-root-group-attachment-v1';
    if(!body||!(isAttachment?['descriptor,group','descriptor,group,reply'].includes(Object.keys(body).sort().join(',')):['group,text','group,reply,text'].includes(Object.keys(body).sort().join(',')))||!validGroupContext(body.group))return false;
    if(body.reply!==undefined&&!validGroupReply(body.reply))return false;groupReply=body.reply?{...body.reply}:undefined;
    const s=await read();if(!rootGroupAllowed(s,d.owner,from,body.group))return false;
    if(!isAttachment&&rootGroupDeliveryId(body.group.messageId,d.owner)!==id||s.messages.some(m=>[m.networkStoredUntil,m.attachmentStoredUntil].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||m.direction==='incoming'&&m.peer===from&&m.group?.id===body.group.id&&m.group?.messageId===body.group.messageId&&m.id!==id))return false;
    group={...body.group};a[0]=isAttachment?'axonic-root-attachment-v1':'axonic-root-text-v1';a[3]=isAttachment?body.descriptor:body.text;
   }

   if(a[0]==='axonic-root-action-v1'){
    const body=a[3];if(!body||Object.keys(body).sort().join(',')!=='kind,revision,target,text')return false;
    const event:RootChatAction={...body,id,peer:from,direction:'incoming',at:d.now(),status:'delivered'};
    if(!validRootAction(event,d.owner,from))return false;
    const s=await read(),c=contact(s,from);if(c.blocked)return false;
    if(s.groupActions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming')||s.messages.some(m=>[m.networkStoredUntil,m.attachmentStoredUntil].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||m.peer===from&&m.direction==='incoming'&&m.id===id))return false;
    const old=s.actions?.find(a=>a.peer===from&&a.direction==='incoming'&&a.id===id);
    if(old)return sameAction(old,event);
    const conflict=s.actions?.find(a=>a.peer===from&&a.direction==='incoming'&&sameTarget(a.target,event.target)&&actionFamily(a.kind)===actionFamily(event.kind)&&a.revision===event.revision);
    if(conflict)return sameAction(conflict,event);
    const m=s.messages.find(m=>m.peer===from&&m.id===event.target.id&&(m.direction==='outgoing'?d.owner:from)===event.target.author);
    if(m?.attachment&&event.kind==='edit')return false;
    if(m?.group)return false;
    if((s.actions?.length??0)>=10000)return false;
    (s.actions??=[]).push(event);await save(s);return true;
   }
   let attachment:AttachmentDescriptor|undefined,text:string,reply:RootChatReply|undefined=groupReply;
   if(a[0]==='axonic-root-attachment-reply-v1'){
    if(!a[3]||Object.keys(a[3]).sort().join(',')!=='descriptor,reply'||!validRootReply(a[3].reply,d.owner,from))return false;
    reply={...a[3].reply};a[3]=a[3].descriptor;
   }
   if(a[0]==='axonic-root-attachment-v1'||a[0]==='axonic-root-attachment-reply-v1'){
    if(!validAttachmentDescriptor(a[3])||a[3].manifest.sender!==from||a[3].manifest.recipient!==d.owner||a[3].manifest.id!==id
     ||!await d.verifyAttachment?.(a[3],'incoming'))return false;attachment=a[3];text=attachment.name;
   }else if(a[0]==='axonic-root-reply-v1'){
    const body=a[3];if(!body||Object.keys(body).length!==2||typeof body.text!=='string'||!body.text.trim()||byteLength(body.text)>1600||!validRootReply(body.reply,d.owner,from))return false;
    text=body.text;reply={...body.reply};
   }else{if(a[0]!=='axonic-root-text-v1'||typeof a[3]!=='string'||!a[3].trim()||byteLength(a[3])>1600)return false;text=a[3];}
   const s=await read(),c=group?(s.contacts.find(c=>c.account===from)??{blocked:false}):contact(s,from);if(c.blocked)return false;
   if(s.groupActions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming'))return false;
   if(s.groupSeen?.some(v=>v.peer===from&&v.id===id)||s.actions?.some(a=>a.peer===from&&a.direction==='incoming'&&a.id===id))return false;
   const old=s.messages.find(m=>m.id===id&&m.peer===from&&m.direction==='incoming');if(old)return old.createdAt===createdAt&&JSON.stringify(old.group)===JSON.stringify(group)&&old.text===text&&sameReply(old.reply,reply)&&(!old.attachment&&!attachment||!!old.attachment&&!!attachment&&attachmentDescriptorFingerprint(old.attachment)===attachmentDescriptorFingerprint(attachment));
   if(s.messages.length>=5000)return false;if(createdAt!==undefined&&!(s.timestampPeers??=[]).includes(from)&&s.timestampPeers.length<500)s.timestampPeers.push(from);s.messages.push({id,peer:from,direction:'incoming',text,at:createdAt??d.now(),...(createdAt!==undefined?{createdAt}:{}),status:attachment?'pending':'delivered',...(attachment?{attachment,descriptorReceivedAt:d.now()}:{deliveredAt:d.now()}),...(reply?{reply}: {}),...(group?{group}: {})});s.hiddenChats=s.hiddenChats?.filter(k=>k!==(group?'group:'+group.id:from));await save(s);return true;
  }),
  networkStoredGroup:(grants:{recipient:string;id:string;expires:number}[])=>run(async()=>{
   const s=await read();let changed=false;
   for(const e of grants){if(!Number.isSafeInteger(e.expires)||e.expires<=d.now())continue;
    const m=s.messages.find(m=>m.direction==='outgoing'&&m.peer===e.recipient&&m.id===e.id);
    if(m&&m.status!=='delivered'&&(m.networkStoredUntil??0)<e.expires){m.networkStoredUntil=e.expires;if(rootMessageStatus(m,d.now())==='stored')m.storedAt??=d.now();changed=true;}
   }if(changed)await save(s);
  }),
  networkStored:(peer:string,id:string,until:number,attachment=false)=>run(async()=>{
   if(!Number.isSafeInteger(until)||until<=d.now())return;
   const s=await read(),m=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction==='outgoing');
   if(!m||m.status==='delivered'||attachment&&!m.attachment)return;
   const field=attachment?'attachmentStoredUntil':'networkStoredUntil';
   if((m[field]??0)>=until)return;m[field]=until;if(rootMessageStatus(m,d.now())==='stored')m.storedAt??=d.now();await save(s);
  }),
  delivered:(peer:string,id:string)=>run(async()=>{const s=await read();const request=s.profileRequests?.find(p=>p.peer===peer&&p.id===id);if(request){s.profileRequests=s.profileRequests!.filter(p=>p!==request);await save(s);return;}
   const profile=s.ownProfile,delivery=s.profileDeliveries?.find(p=>p.peer===peer);if(profile&&delivery){for(let i=0;i<profileCount(profile.manifest);i++)if(profilePartId(d.owner,peer,profile.manifest,i)===id){if(delivery.acked.includes(i))return;delivery.acked.push(i);await save(s);const next=pendingProfiles(s,d.owner).find(p=>p.peer===peer);if(next)d.queued?.(peer,next.id);return;}}
   const groupAction=s.groupActions?.find(a=>a.id===id&&a.peer===peer&&a.direction==='outgoing');if(groupAction){if(groupAction.status==='delivered')return;groupAction.status='delivered';await save(s);return;}const packet=s.groupPackets?.find(v=>v.peer===peer&&v.id===id);if(packet){if(packet.status==='delivered')return;packet.status='delivered';await save(s);return;}const m=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction==='outgoing');if(m){if(m.attachment?m.descriptorDelivered:m.status==='delivered')return;if(m.attachment){m.descriptorDelivered=true;m.descriptorReceivedAt??=d.now();if(rootMessageStatus(m,d.now())==='stored')m.storedAt??=d.now();}else{m.status='delivered';m.deliveredAt??=d.now();}await save(s);}else{const a=s.actions?.find(a=>a.peer===peer&&a.id===id&&a.direction==='outgoing');if(a){if(a.status==='delivered')return;a.status='delivered';await save(s);}}}),
  attachmentComplete:(peer:string,id:string,direction:RootChatMessage['direction'],receipt:AttachmentReceipt)=>run(async()=>{
   const s=await read(),m=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction===direction);if(!m?.attachment||!await d.verifyAttachmentReceipt?.(m.attachment,receipt))return false;
   check();if(m.status==='delivered')return true;m.status='delivered';m.deliveredAt??=d.now();if(direction==='outgoing')m.descriptorDelivered=true;await save(s);return true;
  }),
 };
}
export const encodeRootChat=(recipient:string,id:string,text:string,reply?:RootChatReply)=>JSON.stringify(reply?['axonic-root-reply-v1',recipient,id,{text,reply}]:['axonic-root-text-v1',recipient,id,text]);
export const encodeRootAttachment=(recipient:string,id:string,descriptor:AttachmentDescriptor,reply?:RootChatReply)=>JSON.stringify(reply?['axonic-root-attachment-reply-v1',recipient,id,{descriptor,reply}]:['axonic-root-attachment-v1',recipient,id,descriptor]);
export const encodeRootMessage=(m:RootChatMessage)=>{const raw=m.group?encodeRootGroupMessage(m):m.attachment?encodeRootAttachment(m.peer,m.id,m.attachment,m.reply):encodeRootChat(m.peer,m.id,m.text,m.reply);if(m.group||m.createdAt===undefined)return raw;const a=JSON.parse(raw);a.push(m.createdAt);return JSON.stringify(a);};

export const pendingRootChat=(s:RootChatState,owner?:string)=>[
 ...(s.groupPackets??[]).filter(p=>p.status==='pending').map(p=>({peer:p.peer,id:p.id,raw:p.raw})),
 ...s.messages.filter(m=>m.direction==='outgoing'&&m.status==='pending'&&!(m.attachment&&m.descriptorDelivered)&&(!m.group||!!owner&&rootGroupAllowed(s,owner,m.peer,m.group)&&s.groups?.find(g=>g.id===m.group!.id)?.accepted)).map(m=>({peer:m.peer,id:m.id,raw:encodeRootMessage(m)})),
 ...(s.groupActions??[]).filter(a=>a.direction==='outgoing'&&a.status==='pending'&&!!owner&&rootGroupAllowed(s,owner,a.peer,a.group)&&s.groups?.find(g=>g.id===a.group.id)?.accepted).map(a=>({peer:a.peer,id:a.id,raw:encodeGroupAction(a)})),
 ...(s.actions??[]).filter(a=>a.direction==='outgoing'&&a.status==='pending').map(a=>({peer:a.peer,id:a.id,raw:encodeRootAction(a)}))
 ,...(owner?pendingProfiles(s,owner):[])
].filter(m=>!s.contacts.find(c=>c.account===m.peer)?.blocked);


