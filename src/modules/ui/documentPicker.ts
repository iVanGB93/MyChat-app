import * as DocumentPicker from 'expo-document-picker';
import {localAccount,validAccountId} from '../identity';
import {queueRootAttachmentSource,rootGroupAttachmentAudience,queueRootGroupAttachmentSource,type RootChatReply} from '../messaging';
export async function pickRootAttachment(peer:string,reply?:RootChatReply){
 const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked'||!validAccountId(peer)||peer===owner)throw Error('Unlock your account and choose a peer');
 const result=await DocumentPicker.getDocumentAsync({copyToCacheDirectory:true,multiple:false});if(result.canceled)return;
 if(localAccount.status().account!==owner)throw Error('Account changed');const asset=result.assets[0];
 // The system picker may lock the account. Store only a local selection; encryption resumes after normal unlock.
 return queueRootAttachmentSource(peer,asset.uri,asset.name,asset.mimeType,owner,reply);
}
export async function pickRootGroupAttachment(groupId:string){const audience=await rootGroupAttachmentAudience(groupId),result=await DocumentPicker.getDocumentAsync({copyToCacheDirectory:true,multiple:false});if(result.canceled)return;const asset=result.assets[0];return queueRootGroupAttachmentSource(audience,asset.uri,asset.name,asset.mimeType);}
