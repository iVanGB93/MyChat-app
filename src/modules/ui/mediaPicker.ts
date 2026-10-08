import type {RootChatReply} from '../messaging';
import * as ImagePicker from 'expo-image-picker';
import {localAccount} from '../identity';
import {validAccountId} from '../identity';
import {queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience} from '../messaging';
import {ATTACHMENT_MAX_BYTES} from '../../services/identity/attachmentProtocol';

/** Native selection can background and lock the app; only stage bytes until normal unlock. */
export async function pickRootMedia(peer:string,source:'camera'|'library',reply?:RootChatReply,groupId?:string){
 const owner=localAccount.status().account;
 if(!owner||localAccount.status().state!=='unlocked'||!groupId&&(!validAccountId(peer)||peer===owner))throw Error('Unlock your account and choose a peer');
 const audience=groupId?await rootGroupAttachmentAudience(groupId):null;
 if(source==='camera'){
  const permission=await ImagePicker.requestCameraPermissionsAsync();
  if(!permission.granted)throw Error('Allow camera access in Settings to take a photo');
 }
 if(localAccount.status().account!==owner)throw Error('Account changed');
 const result=source==='camera'
  ?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:0.7})
  :await ImagePicker.launchImageLibraryAsync({mediaTypes:['images','videos'],allowsMultipleSelection:false,quality:0.7});
 if(result.canceled)return;
 if(localAccount.status().account!==owner)throw Error('Account changed');
 const asset=result.assets[0];
 if(!asset?.uri)throw Error('The selected media is unavailable');
 if(asset.fileSize!==undefined&&asset.fileSize>ATTACHMENT_MAX_BYTES)throw Error('Choose a file smaller than 250 MiB');
 const video=asset.type==='video';
 // Do not guess a codec from the filename. Unknown types remain generic files.
 const mime=asset.mimeType||'application/octet-stream';
 const name=asset.fileName||(video?'Video':'Photo');
 return audience?queueRootGroupAttachmentSource(audience,asset.uri,name,mime):queueRootAttachmentSource(peer,asset.uri,name,mime,owner,reply);
}
export const pickRootGroupMedia=(id:string,source:'camera'|'library')=>pickRootMedia(id,source,undefined,id);
