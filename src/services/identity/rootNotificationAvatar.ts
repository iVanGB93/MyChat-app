import {File,Paths} from 'expo-file-system';
import {toByteArray} from 'base64-js';
import {readSharedAvatar} from '../../modules/storage/sharedProfileStore';
/** Temporary local image only; never fetch a remote URL or persist it in notice data. */
export async function rootNotificationAvatar(owner:string,peer:string){
 let file:File|undefined;
 try{
  const uri=await readSharedAvatar(owner,peer);if(!uri?.startsWith('data:image/jpeg;base64,'))return null;
  const encoded=uri.slice('data:image/jpeg;base64,'.length);if(encoded.length>512000)return null;
  file=new File(Paths.cache,`notification-avatar-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  file.write(toByteArray(encoded));const saved=file;
  return {uri:saved.uri,remove(){try{if(saved.exists)saved.delete();}catch{}}};
 }catch{try{if(file?.exists)file.delete();}catch{}return null;}
}
