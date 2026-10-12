import {storeSharedAvatarPart} from '../../modules/storage/sharedProfileStore';
import {publishRootMessageFeedback} from './rootMessageFeedback';
import {ownChatStore} from '../../modules/storage/chatStore';
import { localAccount } from './localAccount';
import { createRootChatLedger } from './rootChatLedger';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {verifyAttachmentManifest,verifyAttachmentReceipt} from './attachmentProtocol';
const ledgers=new Map<string,ReturnType<typeof createRootChatLedger>>();
const queuedListeners=new Set<(owner:string,peer:string,id:string)=>void>();
export function subscribeRootChatQueued(listener:(owner:string,peer:string,id:string)=>void){queuedListeners.add(listener);return()=>{queuedListeners.delete(listener);};}
export function localRootChat(){
 const owner=localAccount.status().account;
 if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account first');
 let ledger=ledgers.get(owner);if(!ledger){const store=ownChatStore(owner);
  ledger=createRootChatLedger({owner,...store,now:Date.now,
   messageCommitted:(m,state)=>{
    // Outgoing attachment feedback occurs when selections are staged, before deferred preparation.
    if(m.direction==='outgoing'&&m.attachment)return;
    const muted=m.group?state.groups?.find(g=>g.id===m.group!.id)?.muted:state.contacts.find(c=>c.account===m.peer)?.muted;
    publishRootMessageFeedback({owner,peer:m.peer,id:m.group?.messageId??m.id,direction:m.direction,...(m.group?{group:m.group.id}:{}),muted});
   },
   receiveProfile:(peer,id,part)=>storeSharedAvatarPart(owner,peer,id,part,()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner),
   signGroup:group=>localAccount.signGroup(group),
   queued:(peer,id)=>{for(const listener of queuedListeners){try{listener(owner,peer,id);}catch{/* Durable outbox retries on its normal timer. */}}},
   verifyAttachment:async(descriptor,direction)=>{const m=descriptor.manifest,record=direction==='outgoing'?localAccount.publicRecord():await createMobileIdentityRecordStore(Date.now).read(m.sender);
    return !!record&&verifyAttachmentManifest(m,record,Date.now())&&(direction==='outgoing'?m.senderDevice:m.recipientDevice)===localAccount.callDevice();},
   verifyAttachmentReceipt:async(descriptor,receipt)=>{const m=descriptor.manifest,record=m.recipient===owner?localAccount.publicRecord():await createMobileIdentityRecordStore(Date.now).read(m.recipient);
    return !!record&&verifyAttachmentReceipt(receipt,m,record,Date.now());},
   current:()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner});ledgers.set(owner,ledger);
 }return ledger;
}
