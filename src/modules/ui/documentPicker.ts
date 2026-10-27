import type {ConfirmAttachment} from './attachmentPreview';
import * as DocumentPicker from 'expo-document-picker';
import {localAccount,validAccountId} from '../identity';
import {type RootChatReply} from '../messaging';
import {queueRootAttachmentBatch,rootGroupAttachmentAudience} from '../media';
export async function pickRootAttachment(peer:string,reply?:RootChatReply,confirm?:ConfirmAttachment,groupId?:string){
 const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked'||!groupId&&(!validAccountId(peer)||peer===owner))throw Error('Unlock your account and choose a peer');
 const audience=groupId?await rootGroupAttachmentAudience(groupId,reply):null;
 const result=await DocumentPicker.getDocumentAsync({copyToCacheDirectory:true,multiple:true});if(result.canceled)return;
 if(localAccount.status().account!==owner)throw Error('Account changed');
 if(result.assets.length>4)throw Error('Choose up to four attachments at a time');
 const drafts:import('./attachmentPreview').AttachmentPreviewDraft[]=result.assets.map(asset=>({uri:asset.uri,name:asset.name,mime:asset.mimeType||'application/octet-stream',size:asset.size}));
 const selected=confirm?await confirm(drafts):drafts;if(!selected)return;
 if(localAccount.status().account!==owner)throw Error('Account changed');
 return queueRootAttachmentBatch({peer,owner,reply,audience:audience??undefined,items:selected});
}
export const pickRootGroupAttachment=(groupId:string,confirm?:ConfirmAttachment,reply?:RootChatReply)=>pickRootAttachment(groupId,reply,confirm,groupId);
