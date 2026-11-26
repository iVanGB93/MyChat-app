import {rootGroupPhoto,type RootChatState} from '../../modules/messaging';
import {chatMediaPresentation,rootAttachmentFile} from '../../modules/storage';

/** Reuse the authenticated chat file; cleanup must also remove the avatar. */
export function groupPhotoUri(state:RootChatState,id:string,owner:string|null){
 if(!owner)return null;
 const message=rootGroupPhoto(state,id,owner,m=>chatMediaPresentation(m,owner)?.mime.startsWith('image/'));
 const media=chatMediaPresentation(message??undefined,owner);
 if(!media)return null;
 try{const file=rootAttachmentFile(owner,media.fileKey);return file.exists?file.uri:null;}catch{return null;}
}
