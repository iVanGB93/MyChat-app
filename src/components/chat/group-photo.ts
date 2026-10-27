import {rootGroupPhoto,type RootChatState} from '../../modules/messaging';
import {attachmentDigest} from '../../modules/media';
import {rootAttachmentFile} from '../../modules/storage';

/** Reuse the authenticated chat file; cleanup must also remove the avatar. */
export function groupPhotoUri(state:RootChatState,id:string,owner:string|null){
 if(!owner)return null;
 const message=rootGroupPhoto(state,id,owner);
 if(!message?.attachment||message.direction==='incoming'&&message.status!=='delivered')return null;
 const file=rootAttachmentFile(owner,attachmentDigest(message.attachment.manifest));
 return file?.exists?file.uri:null;
}
