import type {ConfirmAttachment} from './attachmentPreview';
import type {RootChatReply} from '../messaging';
import * as ImagePicker from 'expo-image-picker';
import {localAccount} from '../identity';
import {validAccountId} from '../identity';
import {queueRootAttachmentBatch,rootGroupAttachmentAudience} from '../media';
import {ATTACHMENT_MAX_BYTES} from '../../services/identity/attachmentProtocol';
import {withRootPickedMedia,pickRootSharedMedia} from '../storage';

/** Native selection can background and lock the app; only stage bytes until normal unlock. */
export async function pickRootMedia(peer:string,source:'camera'|'library',reply?:RootChatReply,groupId?:string,confirm?:ConfirmAttachment){
 const owner=localAccount.status().account;
 if(!owner||localAccount.status().state!=='unlocked'||!groupId&&(!validAccountId(peer)||peer===owner))throw Error('Unlock your account and choose a peer');
 const audience=groupId?await rootGroupAttachmentAudience(groupId,reply):null;
 if(source==='camera'){
  const permission=await ImagePicker.requestCameraPermissionsAsync();
  if(!permission.granted)throw Error('Allow camera access in Settings to take a photo');
 }
 if(localAccount.status().account!==owner)throw Error('Account changed');
 const result=source==='camera'
  ?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:0.7})
  :await (pickRootSharedMedia()??ImagePicker.launchImageLibraryAsync({mediaTypes:['images','videos'],allowsMultipleSelection:true,selectionLimit:4,quality:1}));
 if(result.canceled)return;
 if(localAccount.status().account!==owner)throw Error('Account changed');
 const drafts:import('./attachmentPreview').AttachmentPreviewDraft[]=result.assets.map(asset=>{
  if(!asset?.uri)throw Error('The selected media is unavailable');
  if(asset.fileSize!==undefined&&asset.fileSize>ATTACHMENT_MAX_BYTES)throw Error('Choose a file smaller than 250 MiB');
  return {uri:asset.uri,name:asset.fileName||(asset.type==='video'?'Video':'Photo'),mime:asset.mimeType||'application/octet-stream',size:asset.fileSize};
 });
 if(!drafts.length)throw Error('The selected media is unavailable');
 if(drafts.length>4)throw Error('Choose up to four attachments at a time');
 const selected=confirm?await confirm(drafts):drafts;if(!selected)return;
 if(localAccount.status().account!==owner)throw Error('Account changed');
 return withRootPickedMedia(selected.map(item=>({...item,assetId:result.assets.find(a=>a.uri===item.uri)?.assetId})),items=>queueRootAttachmentBatch({peer,owner,reply,audience:audience??undefined,items}));
}
export const pickRootGroupMedia=(id:string,source:'camera'|'library',confirm?:ConfirmAttachment,reply?:RootChatReply)=>pickRootMedia(id,source,reply,id,confirm);
