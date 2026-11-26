import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {validAccountId} from './identityProtocol';
import {attachmentDigest,attachmentContentDigest} from './attachmentProtocol';
import type {AttachmentDescriptor} from './attachmentTransfer';
import type {LocalChatMedia,RootChatMessage} from './rootChatTypes';
import {retiredAttachment} from './retiredAttachment';

export type SavedAttachmentPresentation={digest:string;name:string;mime:string;bytes:number;caption?:string};

const hex=(value:unknown,length:number):value is string=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/.test(value);
const validName=(name:unknown):name is string=>typeof name==='string'&&name.length>0&&name.length<=120&&!/[\x00-\x1f\x7f/\\]/.test(name);
const validMime=(mime:unknown):mime is string=>typeof mime==='string'&&mime.length<=100&&/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime);
const positiveSize=(bytes:unknown):bytes is number=>typeof bytes==='number'&&Number.isSafeInteger(bytes)&&bytes>0;

/** Capture local presentation once as the app admits a verified descriptor. */
export function localMediaFromDescriptor({manifest,name,mime,caption}:AttachmentDescriptor):LocalChatMedia{
 const preview=manifest.preview;
 return {fileKey:attachmentDigest(manifest),name,mime,bytes:manifest.bytes,...(caption?{caption}:{}),
  ...(preview?{preview:{fileKey:attachmentContentDigest(manifest),width:preview.width,height:preview.height}}:{})};
}

/** UI lookup never requires a network session, receipt or live manifest. */
export function chatMediaPresentation(message:RootChatMessage|undefined,owner:string|null):LocalChatMedia|undefined{
 if(!message||message.deleted||!validAccountId(owner))return;
 const local=message.localMedia;
 if(local&&hex(local.fileKey,64)&&validName(local.name)&&validMime(local.mime)&&positiveSize(local.bytes)&&
    (local.caption===undefined||typeof local.caption==='string'&&local.caption.length<=1600)&&
    (local.preview===undefined||local.preview&&hex(local.preview.fileKey,64)&&positiveSize(local.preview.width)&&positiveSize(local.preview.height)))return local;
 if(message.attachment&&!retiredAttachment(message.attachment))return localMediaFromDescriptor(message.attachment);
 const previous=savedAttachmentPresentation(message,owner);
 if(previous){const {digest,...fields}=previous;return {...fields,fileKey:digest};}
}

/** Locate a completed v4 file using its original local storage key. */
export function savedAttachmentPresentation(message:RootChatMessage|undefined,owner:string|null):SavedAttachmentPresentation|undefined{
 if(!message||message.deleted||!validAccountId(owner)||!validAccountId(message.peer))return;
 const saved=(message.attachment??message.retiredAttachment) as {name?:unknown;mime?:unknown;caption?:unknown;manifest?:Record<string,unknown>}|undefined;
 const manifest=saved?.manifest;
 if(!manifest||manifest.version!==4||manifest.id!==message.id||!hex(manifest.id,64))return;
 const sender=message.direction==='outgoing'?owner:message.peer;
 const recipient=message.direction==='outgoing'?message.peer:owner;
 if(manifest.sender!==sender||manifest.recipient!==recipient||sender===recipient||
    !hex(manifest.senderDevice,64)||!hex(manifest.recipientDevice,64)||!hex(manifest.root,64)||!hex(manifest.checksum,64)||!hex(manifest.signature,128)||
    !Number.isSafeInteger(manifest.created)||!Number.isSafeInteger(manifest.expires)||!positiveSize(manifest.bytes)||
    !validName(saved.name)||!validMime(saved.mime))return;
 const shared=manifest.shared as {id?:unknown;count?:number;slot?:number}|undefined;
 if(shared!==undefined&&(!shared||!hex(shared.id,64)||typeof shared.count!=='number'||!Number.isSafeInteger(shared.count)||shared.count<1||shared.count>9||typeof shared.slot!=='number'||!Number.isSafeInteger(shared.slot)||shared.slot<0||shared.slot>=shared.count))return;

 const fields=['axonic-attachment-v4',4,manifest.id,sender,manifest.senderDevice,recipient,manifest.recipientDevice,
  manifest.created,manifest.expires,manifest.bytes,manifest.root,manifest.checksum];
 if(shared)fields.push(shared.id,shared.count,shared.slot);
 const body=bytesToHex(utf8ToBytes(JSON.stringify(fields)));
 const digest=bytesToHex(sha256(utf8ToBytes(JSON.stringify([body,manifest.signature]))));
 return {digest,name:saved.name,mime:saved.mime,bytes:manifest.bytes,...(typeof saved.caption==='string'&&saved.caption.length<=1600?{caption:saved.caption}:{})};
}
