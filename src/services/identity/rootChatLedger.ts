import {validGroupReply,validGroupAction,enqueueGroupAction,receiveGroupAction,encodeGroupAction,type RootGroupAction} from './rootGroupActions.ts';
import type {RootChatAction,RootActionKind} from './rootChatActionTypes.ts';
import {validRootAction,actionFamily,sameTarget,sameAction,encodeRootAction} from './rootChatActions.ts';
import { validAccountId } from './identityProtocol.ts';
import {validAttachmentDescriptor,attachmentDescriptorFingerprint,type AttachmentDescriptor} from './attachmentTransfer.ts';
import type {AttachmentReceipt} from './attachmentProtocol.ts';
import type {RootChatReply,RootChatMessage,RootChatContact,RootChatState} from './rootChatTypes.ts';
import {changeRootGroup,receiveRootGroupControl,leaveRootGroup,validGroupContext,validGroupStorage,rootGroupAllowed,encodeRootGroupMessage,rootGroupDeliveryId} from './rootGroups.ts';
import type {RootGroupContext} from './rootGroupTypes.ts';
export type {RootChatReply,RootChatMessage,RootChatContact,RootChatState} from './rootChatTypes.ts';
const idValid=(id:string)=>/^[a-f0-9]{64}$/.test(id);
export const validRootReply=(r:unknown,owner:string,peer:string):r is RootChatReply=>{const v=r as RootChatReply;return !!v&&Object.keys(v).length===2&&idValid(v.id)&&(v.author===owner||v.author===peer);};
const sameReply=(a?:RootChatReply,b?:RootChatReply)=>a?.id===b?.id&&a?.author===b?.author;
const byteLength=(text:string)=>new TextEncoder().encode(text).length;
/** Private own history. Peer identity comes exclusively from the authenticated transport. */
export function createRootChatLedger(d:{owner:string;read():Promise<string|null>;write(raw:string):Promise<void>;current():boolean;now():number;
 verifyAttachment?(descriptor:AttachmentDescriptor,direction:RootChatMessage['direction']):Promise<boolean>;
 verifyAttachmentReceipt?(descriptor:AttachmentDescriptor,receipt:AttachmentReceipt):Promise<boolean>;
}){
 if(!validAccountId(d.owner))throw Error('Invalid account');
 let tail:Promise<unknown>=Promise.resolve();
 const run=<T>(work:()=>Promise<T>)=>{const p=tail.then(work);tail=p.catch(()=>{});return p;};
 const check=()=>{if(!d.current())throw Error('Unlock your account first');};
 const validPeer=(peer:string)=>validAccountId(peer)&&peer!==d.owner;
 const validChat=(key:string)=>typeof key==='string'&&(key.startsWith('group:')?idValid(key.slice(6)):validPeer(key));
 async function read():Promise<RootChatState>{
  check();const raw=await d.read();check();if(raw===null)return {version:1,messages:[],contacts:[]};
  const s=JSON.parse(raw) as RootChatState;
  if(s.version!==1||!Array.isArray(s.messages)||!Array.isArray(s.contacts)||s.messages.length>5000||s.contacts.length>500
   ||s.hiddenChats!==undefined&&(!Array.isArray(s.hiddenChats)||s.hiddenChats.length>564||s.hiddenChats.some(k=>!validChat(k)))
   ||s.removedMessages!==undefined&&(!Array.isArray(s.removedMessages)||s.removedMessages.length>20000||s.removedMessages.some(m=>!validPeer(m.peer)||!idValid(m.id)||!['incoming','outgoing'].includes(m.direction)))
   ||(s.imports!==undefined&&(!Array.isArray(s.imports)||s.imports.length>10||s.imports.some(v=>typeof v!=='string'||v.length>100)))
   ||s.messages.some(m=>!idValid(m.id)||!validPeer(m.peer)||!['incoming','outgoing'].includes(m.direction)||typeof m.text!=='string'||!m.text||byteLength(m.text)>1600||!Number.isSafeInteger(m.at)||!['pending','delivered'].includes(m.status)
    ||m.reply!==undefined&&(!(m.group?validGroupReply(m.reply):validRootReply(m.reply,d.owner,m.peer)))
    ||m.descriptorDelivered!==undefined&&typeof m.descriptorDelivered!=='boolean'
    ||m.attachment!==undefined&&(!validAttachmentDescriptor(m.attachment)||m.attachment.manifest.id!==m.id||m.text!==m.attachment.name
     ||m.attachment.manifest.sender!==(m.direction==='outgoing'?d.owner:m.peer)||m.attachment.manifest.recipient!==(m.direction==='incoming'?d.owner:m.peer)))
   ||(s.actions!==undefined&&(!Array.isArray(s.actions)||s.actions.length>10000||s.actions.some(a=>!validPeer(a.peer)||!validRootAction(a,d.owner,a.peer))))
   ||s.contacts.some(c=>!validPeer(c.account)||typeof c.alias!=='string'||c.alias.length>80||typeof c.blocked!=='boolean'||typeof c.accepted!=='boolean'||c.muted!==undefined&&typeof c.muted!=='boolean')
   ||(s.groups!==undefined||s.groupPackets!==undefined)&&!validGroupStorage(s,d.owner)
   ||s.messages.some(m=>m.group!==undefined&&(!validGroupContext(m.group)||!s.groups?.some(g=>g.id===m.group!.id)))
   ||s.groupActions!==undefined&&(!Array.isArray(s.groupActions)||s.groupActions.length>10000||s.groupActions.some(a=>!validGroupAction(a,d.owner)||!s.groups?.some(g=>g.id===a.group.id)))
   ||s.groupSeen!==undefined&&(!Array.isArray(s.groupSeen)||s.groupSeen.length>2000||s.groupSeen.some(v=>!validPeer(v.peer)||!idValid(v.id)||typeof v.raw!=='string'||byteLength(v.raw)>2048)))throw Error('Chat storage needs recovery; it was not replaced');
  return s;
 }
 async function save(s:RootChatState){check();await d.write(JSON.stringify(s));check();}
 function contact(s:RootChatState,peer:string){let c=s.contacts.find(c=>c.account===peer);if(!c){if(s.contacts.length>=500)throw Error('Contact storage is full');c={account:peer,alias:'',blocked:false,accepted:false};s.contacts.push(c);}return c;}
 return {
  snapshot:()=>run(read),
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
  createGroup:(id:string,packetId:string,name:string,members:string[])=>run(async()=>{const s=await read();if(s.groups?.some(g=>g.id===id))throw Error('Group already exists');changeRootGroup(s,d.owner,id,packetId,name,members);await save(s);}),
  updateGroup:(id:string,packetId:string,name:string,members:string[])=>run(async()=>{const s=await read();if(!s.groups?.some(g=>g.id===id))throw Error('Group unavailable');changeRootGroup(s,d.owner,id,packetId,name,members);await save(s);}),
  configureGroup:(id:string,patch:{accepted?:boolean;blocked?:boolean})=>run(async()=>{if(!patch||Object.keys(patch).some(k=>!['accepted','blocked'].includes(k))||patch.accepted!==undefined&&typeof patch.accepted!=='boolean'||patch.blocked!==undefined&&typeof patch.blocked!=='boolean')throw Error('Invalid group preferences');const s=await read(),g=s.groups?.find(g=>g.id===id);if(!g)throw Error('Group unavailable');if(patch.accepted!==undefined)g.accepted=patch.accepted;if(patch.blocked!==undefined)g.blocked=patch.blocked;await save(s);}),
  markGroupRead:(id:string)=>run(async()=>{const s=await read();let changed=false;for(const m of s.messages)if(m.group?.id===id&&m.direction==='incoming'&&!m.read){m.read=true;changed=true;}if(changed)await save(s);}),
  leaveGroup:(id:string,packetId:string)=>run(async()=>{const s=await read();leaveRootGroup(s,d.owner,id,packetId);await save(s);}),
  actGroup:(groupId:string,id:string,target:RootChatReply,kind:RootGroupAction['kind'],text='')=>run(async()=>{const s=await read();enqueueGroupAction(s,d.owner,groupId,id,target,kind,text,d.now());await save(s);}),
  enqueueGroup:(groupId:string,id:string,text:string,reply?:RootChatReply)=>run(async()=>{
   const s=await read(),g=s.groups?.find(g=>g.id===groupId);if(!g||g.blocked||!g.accepted||!g.members.includes(d.owner)||!idValid(id)||!text.trim()||byteLength(text)>1600)throw Error('Accept an active group and enter a message up to 1,600 bytes');
   if(reply&&(!validGroupReply(reply)||!s.messages.some(m=>m.group?.id===groupId&&m.group.messageId===reply.id&&(m.direction==='outgoing'?d.owner:m.peer)===reply.author)))throw Error('Original group message unavailable');
   const recipients=g.members.filter(peer=>peer!==d.owner);if(!recipients.length)throw Error('Add another member first');
   if(s.messages.some(m=>m.direction==='outgoing'&&m.group?.messageId===id&&(m.group.id!==groupId||m.group.revision!==g.revision||m.text!==text||!!m.attachment||!sameReply(m.reply,reply))))throw Error('Message ID conflict');
   if(recipients.some(peer=>s.contacts.some(c=>c.account===peer&&c.blocked)))throw Error('Unblock group members before sending');
   for(const peer of recipients){const deliveryId=rootGroupDeliveryId(id,peer),m:RootChatMessage={id:deliveryId,peer,direction:'outgoing',text,at:d.now(),status:'pending',group:{id:groupId,revision:g.revision,messageId:id},...(reply?{reply:{...reply}}:{})};
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
   if(byteLength(encodeRootChat(peer,id,text,reply))>2048)throw Error('Message is too large for delivery');
   const s=await read(),c=contact(s,peer);if(c.blocked)throw Error('This identity is blocked');
   if(s.groupActions?.some(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id)||s.actions?.some(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id))throw Error('Message ID conflict');
   const reference=reply;
   if(reference&&!s.messages.some(m=>m.peer===peer&&m.id===reference.id&&(m.direction==='outgoing'?d.owner:peer)===reference.author))throw Error('Original message is no longer available');
   const old=s.messages.find(m=>m.id===id&&m.peer===peer&&m.direction==='outgoing');if(old){if(old.text!==text||old.attachment||!sameReply(old.reply,reply))throw Error('Message ID conflict');return;}
   if(s.messages.length>=5000)throw Error('Chat storage is full');c.accepted=true;
   s.hiddenChats=s.hiddenChats?.filter(k=>k!==peer);s.messages.push({id,peer,direction:'outgoing',text,at:d.now(),status:'pending',...(reply?{reply:{...reply}}:{})});await save(s);
  }),

  act:(peer:string,id:string,target:RootChatReply,kind:RootActionKind,text='')=>run(async()=>{
   if(!validPeer(peer))throw Error('Invalid identity');
   const s=await read(),c=contact(s,peer);if(c.blocked)throw Error('This identity is blocked');
   const m=s.messages.find(m=>m.peer===peer&&m.id===target.id&&(m.direction==='outgoing'?d.owner:peer)===target.author);
   if(!m)throw Error('Original message unavailable');
   if(m.group)throw Error('Group message actions are not available yet');
   const previous=(s.actions??[]).filter(a=>a.peer===peer&&a.direction==='outgoing'&&sameTarget(a.target,target)&&actionFamily(a.kind)===actionFamily(kind));
   const event:RootChatAction={id,peer,direction:'outgoing',target:{...target},kind,text,revision:kind==='read'?1:Math.max(0,...previous.map(a=>a.revision))+1,at:d.now(),status:'pending'};
   if(!validRootAction(event,d.owner,peer)||byteLength(encodeRootAction(event))>2048)throw Error('Invalid action or text too long');
   if(kind==='edit'&&m.attachment)throw Error('Only text messages can be edited');
   if(s.groupActions?.some(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id)||s.messages.some(m=>m.peer===peer&&m.direction==='outgoing'&&m.id===id))throw Error('Message ID conflict');
   const retry=s.actions?.find(a=>a.peer===peer&&a.direction==='outgoing'&&a.id===id);
   if(retry){if(retry.kind!==kind||retry.text!==text||!sameTarget(retry.target,target))throw Error('Action ID conflict');return;}
   if(s.actions?.some(a=>a.peer===peer&&sameTarget(a.target,target)&&a.kind==='delete'))throw Error('Message was deleted');
   if(kind==='read'&&previous.length)return;
   if((s.actions?.length??0)>=10000)throw Error('Action storage is full');
   (s.actions??=[]).push(event);await save(s);
  }),
  enqueueAttachment:(input:AttachmentDescriptor,reply?:RootChatReply,group?:RootGroupContext)=>run(async()=>{
   check();if(!validAttachmentDescriptor(input))throw Error('Invalid attachment');const descriptor=JSON.parse(JSON.stringify(input)) as AttachmentDescriptor;
   const {id,recipient:peer,sender}=descriptor.manifest;
   if(group&&(!validGroupContext(group)||reply))throw Error('Invalid group attachment');
   if(reply!==undefined&&!validRootReply(reply,d.owner,peer))throw Error('Invalid reply');
   if(reply)reply={...reply};
   if(sender!==d.owner||!validPeer(peer)||byteLength(group?encodeRootGroupMessage({id,peer,direction:'outgoing',text:descriptor.name,at:d.now(),status:'pending',attachment:descriptor,group}):encodeRootAttachment(peer,id,descriptor,reply))>2048||!await d.verifyAttachment?.(descriptor,'outgoing'))throw Error('Attachment identity could not be verified');
   const s=await read(),c=group?(s.contacts.find(c=>c.account===peer)??{blocked:false,accepted:false}):contact(s,peer);if(c.blocked)throw Error('This identity is blocked');
   if(s.hiddenChats?.includes(group?'group:'+group.id:peer))throw Error('This conversation was deleted');
   if(group&&(!rootGroupAllowed(s,d.owner,peer,group)||!s.groups?.find(g=>g.id===group.id)?.accepted))throw Error('Group membership changed');
   if(reply&&!s.messages.some(m=>m.peer===peer&&m.id===reply!.id&&(m.direction==='outgoing'?d.owner:peer)===reply!.author))throw Error('Original message is no longer available');
   const old=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction==='outgoing');if(old){if(JSON.stringify(old.group)!==JSON.stringify(group)||!sameReply(old.reply,reply)||!old.attachment||attachmentDescriptorFingerprint(old.attachment)!==attachmentDescriptorFingerprint(descriptor))throw Error('Attachment ID conflict');return;}
   if(s.messages.length>=5000)throw Error('Chat storage is full');if(!group)c.accepted=true;
   s.hiddenChats=s.hiddenChats?.filter(k=>k!==(typeof group!=='undefined'&&group?'group:'+group.id:peer));s.messages.push({id,peer,direction:'outgoing',text:descriptor.name,at:d.now(),status:'pending',attachment:descriptor,descriptorDelivered:false,...(reply?{reply}: {}),...(group?{group:{...group}}:{})});await save(s);
  }),
  receive:(from:string,id:string,raw:string)=>run(async()=>{
   if(!validPeer(from)||!idValid(id)||byteLength(raw)>2048)return false;
   let a;try{a=JSON.parse(raw);}catch{return false;}
   if(!Array.isArray(a)||a.length!==4||a[1]!==d.owner||a[2]!==id)return false;
   const prior=await read();
   if(prior.removedMessages?.some(m=>m.peer===from&&m.id===id&&m.direction==='incoming'))return true;
   if(a[0]==='axonic-root-group-action-v1'){const s=await read();if(!receiveGroupAction(s,d.owner,from,id,a[3],d.now()))return false;await save(s);return true;}
   if(a[0]==='axonic-group-members-v1'||a[0]==='axonic-group-leave-v1'){
    const s=await read(),old=s.groupSeen?.find(v=>v.peer===from&&v.id===id);if(old)return old.raw===raw;
    if(s.groupActions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming'))return false;
    if((s.groupSeen?.length??0)>=2000||s.messages.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming')||s.actions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming'))return false;
    if(!receiveRootGroupControl(s,d.owner,from,id,a[0],a[3]))return false;
    (s.groupSeen??=[]).push({peer:from,id,raw});await save(s);return true;
   }
   let group:RootGroupContext|undefined,groupReply:RootChatReply|undefined;
   if(a[0]==='axonic-root-group-text-v1'||a[0]==='axonic-root-group-attachment-v1'){
    const body=a[3],isAttachment=a[0]==='axonic-root-group-attachment-v1';
    if(!body||!(isAttachment?Object.keys(body).sort().join(',')==='descriptor,group':['group,text','group,reply,text'].includes(Object.keys(body).sort().join(',')))||!validGroupContext(body.group))return false;
    if(body.reply!==undefined&&!validGroupReply(body.reply))return false;groupReply=body.reply?{...body.reply}:undefined;
    const s=await read();if(!rootGroupAllowed(s,d.owner,from,body.group))return false;
    if(!isAttachment&&rootGroupDeliveryId(body.group.messageId,d.owner)!==id||s.messages.some(m=>m.direction==='incoming'&&m.peer===from&&m.group?.id===body.group.id&&m.group?.messageId===body.group.messageId&&m.id!==id))return false;
    group={...body.group};a[0]=isAttachment?'axonic-root-attachment-v1':'axonic-root-text-v1';a[3]=isAttachment?body.descriptor:body.text;
   }

   if(a[0]==='axonic-root-action-v1'){
    const body=a[3];if(!body||Object.keys(body).sort().join(',')!=='kind,revision,target,text')return false;
    const event:RootChatAction={...body,id,peer:from,direction:'incoming',at:d.now(),status:'delivered'};
    if(!validRootAction(event,d.owner,from))return false;
    const s=await read(),c=contact(s,from);if(c.blocked)return false;
    if(s.groupActions?.some(v=>v.peer===from&&v.id===id&&v.direction==='incoming')||s.messages.some(m=>m.peer===from&&m.direction==='incoming'&&m.id===id))return false;
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
   const old=s.messages.find(m=>m.id===id&&m.peer===from&&m.direction==='incoming');if(old)return JSON.stringify(old.group)===JSON.stringify(group)&&old.text===text&&sameReply(old.reply,reply)&&(!old.attachment&&!attachment||!!old.attachment&&!!attachment&&attachmentDescriptorFingerprint(old.attachment)===attachmentDescriptorFingerprint(attachment));
   if(s.messages.length>=5000)return false;s.messages.push({id,peer:from,direction:'incoming',text,at:d.now(),status:attachment?'pending':'delivered',...(attachment?{attachment}: {}),...(reply?{reply}: {}),...(group?{group}: {})});s.hiddenChats=s.hiddenChats?.filter(k=>k!==(group?'group:'+group.id:from));await save(s);return true;
  }),
  delivered:(peer:string,id:string)=>run(async()=>{const s=await read(),groupAction=s.groupActions?.find(a=>a.id===id&&a.peer===peer&&a.direction==='outgoing');if(groupAction){groupAction.status='delivered';await save(s);return;}const packet=s.groupPackets?.find(v=>v.peer===peer&&v.id===id);if(packet){packet.status='delivered';await save(s);return;}const m=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction==='outgoing');if(m){if(m.attachment)m.descriptorDelivered=true;else m.status='delivered';await save(s);}else{const a=s.actions?.find(a=>a.peer===peer&&a.id===id&&a.direction==='outgoing');if(a){a.status='delivered';await save(s);}}}),
  attachmentComplete:(peer:string,id:string,direction:RootChatMessage['direction'],receipt:AttachmentReceipt)=>run(async()=>{
   const s=await read(),m=s.messages.find(m=>m.peer===peer&&m.id===id&&m.direction===direction);if(!m?.attachment||!await d.verifyAttachmentReceipt?.(m.attachment,receipt))return false;
   check();m.status='delivered';if(direction==='outgoing')m.descriptorDelivered=true;await save(s);return true;
  }),
 };
}
export const encodeRootChat=(recipient:string,id:string,text:string,reply?:RootChatReply)=>JSON.stringify(reply?['axonic-root-reply-v1',recipient,id,{text,reply}]:['axonic-root-text-v1',recipient,id,text]);
export const encodeRootAttachment=(recipient:string,id:string,descriptor:AttachmentDescriptor,reply?:RootChatReply)=>JSON.stringify(reply?['axonic-root-attachment-reply-v1',recipient,id,{descriptor,reply}]:['axonic-root-attachment-v1',recipient,id,descriptor]);
export const encodeRootMessage=(m:RootChatMessage)=>m.group?encodeRootGroupMessage(m):m.attachment?encodeRootAttachment(m.peer,m.id,m.attachment,m.reply):encodeRootChat(m.peer,m.id,m.text,m.reply);

export const pendingRootChat=(s:RootChatState,owner?:string)=>[
 ...(s.groupPackets??[]).filter(p=>p.status==='pending').map(p=>({peer:p.peer,id:p.id,raw:p.raw})),
 ...s.messages.filter(m=>m.direction==='outgoing'&&m.status==='pending'&&!(m.attachment&&m.descriptorDelivered)&&(!m.group||!!owner&&rootGroupAllowed(s,owner,m.peer,m.group)&&s.groups?.find(g=>g.id===m.group!.id)?.accepted)).map(m=>({peer:m.peer,id:m.id,raw:encodeRootMessage(m)})),
 ...(s.groupActions??[]).filter(a=>a.direction==='outgoing'&&a.status==='pending'&&!!owner&&rootGroupAllowed(s,owner,a.peer,a.group)&&s.groups?.find(g=>g.id===a.group.id)?.accepted).map(a=>({peer:a.peer,id:a.id,raw:encodeGroupAction(a)})),
 ...(s.actions??[]).filter(a=>a.direction==='outgoing'&&a.status==='pending').map(a=>({peer:a.peer,id:a.id,raw:encodeRootAction(a)}))
].filter(m=>!s.contacts.find(c=>c.account===m.peer)?.blocked);


