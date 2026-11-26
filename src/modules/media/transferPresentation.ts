import {attachmentBlockBytes,attachmentDigest} from '../../services/identity/attachmentProtocol';
import {hasConfirmedDelivery} from '../../services/identity/rootMessageStatus';
import type {RootChatMessage} from '../../services/identity/rootChatTypes';

/** Translate active transfer state for UI controls. Saved media uses the storage API. */
export function attachmentTransferPresentation(message:RootChatMessage){
 const manifest=message.attachment?.manifest;
 if(!manifest||message.deleted||hasConfirmedDelivery(message))return;
 const {created,expires,bytes}=manifest;
 try{
  const bytesPerBlock=attachmentBlockBytes(manifest);
  return {id:attachmentDigest(manifest),created,expires,bytes,bytesPerBlock};
 }catch{return undefined;}
}
