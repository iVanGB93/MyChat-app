import {rootChatView} from './rootChatActions';
import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {queueRootAttachmentSource,rootGroupAttachmentAudience,queueRootGroupAttachmentSource} from './rootAttachmentSelections';
import {rootAttachmentFile} from './rootAttachmentFiles';
import {withRootSharedFile} from './rootMediaExport';
import {chatMediaPresentation} from './savedAttachmentPresentation';
import {validAccountId} from './identityProtocol';
import type {RootChatMessage} from './rootChatLedger';

/** Forward a new message. Never reuse the original recipient's descriptor, key or receipt. */
export async function forwardRootMessage(source:Pick<RootChatMessage,'peer'|'id'|'direction'>,recipient:string){
 const owner=localAccount.status().account;
 const check=()=>{if(!owner||localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)throw Error('Unlock your account to forward this message');};
 const group=recipient.startsWith('group:')?recipient.slice(6):undefined;
 check();if(!group&&(!validAccountId(recipient)||recipient===owner))throw Error('Choose another identity');
 const state=rootChatView(owner!,await localRootChat().messageSnapshot(source.peer,source.id,source.direction));check();
 if(state.contacts.find(c=>c.account===recipient)?.blocked)throw Error('This identity is blocked');
 const message=state.messages.find(m=>m.peer===source.peer&&m.id===source.id&&m.direction===source.direction);
 if(!message||message.deleted)throw Error('This message is no longer available');
 const media=chatMediaPresentation(message,owner);
 if(!media){
  if(message.retiredAttachment)throw Error('This attachment is not available on this device');
  const id=await Native!.identityRandomBytes!(32);check();
  if(group)await localRootChat().enqueueGroup(group,id,message.text);else await localRootChat().enqueue(recipient,id,message.text);return;
 }
 const file=rootAttachmentFile(owner!,media.fileKey);
 if(!file.exists)throw Error('This attachment is not available on this device');
 // Stage our own bytes offline; the attachment worker verifies the recipient
 // before preparing a fresh encrypted descriptor for this destination.
 check();
 await withRootSharedFile(owner!,file.uri,async uri=>{
  if(group){await queueRootGroupAttachmentSource(await rootGroupAttachmentAudience(group),uri,media.name,media.mime,media.caption);return;}
  await queueRootAttachmentSource(recipient,uri,media.name,media.mime,owner!,undefined,media.caption);
 });
}
