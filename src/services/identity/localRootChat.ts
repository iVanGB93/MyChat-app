import {ownChatStore} from '../../modules/storage/chatStore';
import { localAccount } from './localAccount';
import { createRootChatLedger } from './rootChatLedger';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {verifyAttachmentManifest,verifyAttachmentReceipt} from './attachmentProtocol';
const ledgers=new Map<string,ReturnType<typeof createRootChatLedger>>();
export function localRootChat(){
 const owner=localAccount.status().account;
 if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account first');
 let ledger=ledgers.get(owner);if(!ledger){const store=ownChatStore(owner);
  ledger=createRootChatLedger({owner,...store,now:Date.now,
   verifyAttachment:async(descriptor,direction)=>{const m=descriptor.manifest,record=direction==='outgoing'?localAccount.publicRecord():await createMobileIdentityRecordStore(Date.now).read(m.sender);
    return !!record&&verifyAttachmentManifest(m,record,Date.now())&&(direction==='outgoing'?m.senderDevice:m.recipientDevice)===localAccount.callDevice();},
   verifyAttachmentReceipt:async(descriptor,receipt)=>{const m=descriptor.manifest,record=m.recipient===owner?localAccount.publicRecord():await createMobileIdentityRecordStore(Date.now).read(m.recipient);
    return !!record&&verifyAttachmentReceipt(receipt,m,record,Date.now());},
   current:()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner});ledgers.set(owner,ledger);
 }return ledger;
}
