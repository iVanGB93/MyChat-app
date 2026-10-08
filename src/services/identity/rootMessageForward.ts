import {rootChatView} from './rootChatActions';
import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {queueRootAttachmentSource} from './rootAttachmentRuntime';
import {rootAttachmentFile} from './rootAttachmentFiles';
import {attachmentDigest} from './attachmentProtocol';
import {validAccountId} from './identityProtocol';
import type {RootChatMessage} from './rootChatLedger';

/** Forward a new message. Never reuse the original recipient's descriptor, key or receipt. */
export async function forwardRootMessage(source:Pick<RootChatMessage,'peer'|'id'|'direction'>,recipient:string){
 const owner=localAccount.status().account;
 const check=()=>{if(!owner||localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)throw Error('Unlock your account to forward this message');};
 check();if(!validAccountId(recipient)||recipient===owner)throw Error('Choose another identity');
 const state=rootChatView(owner!,await localRootChat().snapshot());check();
 if(state.contacts.find(c=>c.account===recipient)?.blocked)throw Error('This identity is blocked');
 const message=state.messages.find(m=>m.peer===source.peer&&m.id===source.id&&m.direction===source.direction);
 if(!message||message.deleted)throw Error('This message is no longer available');
 if(!message.attachment){
  const id=await Native!.identityRandomBytes!(32);check();
  await localRootChat().enqueue(recipient,id,message.text);return;
 }
 if(message.direction==='incoming'&&message.status!=='delivered')throw Error('Wait for the attachment to finish downloading');
 const file=rootAttachmentFile(owner!,attachmentDigest(message.attachment.manifest));
 if(!file.exists)throw Error('This attachment is not available on this device');
 // Stage our own bytes offline; the attachment worker verifies the recipient
 // before preparing a fresh encrypted descriptor for this destination.
 check();
 await queueRootAttachmentSource(recipient,file.uri,message.attachment.name,message.attachment.mime,owner!);
}
