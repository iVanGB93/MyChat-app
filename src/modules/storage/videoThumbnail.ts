import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo';
import {localAccount} from '../../services/identity/localAccount';
import {rootAttachmentFile} from '../../services/identity/rootAttachmentFiles';
const native=Platform.OS==='android'?requireOptionalNativeModule<{videoThumbnail?(uri:string):Promise<string|null>}>('AxonicMediaStore'):null;
/** Extract a bounded preview in memory only; never export it or retain it across account locks. */
export async function rootVideoThumbnail(owner:string,digest:string){
 const current=()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner;
 if(!current()||!native?.videoThumbnail)return null;
 const file=rootAttachmentFile(owner,digest);if(!file.exists)return null;
 try{const result=await native.videoThumbnail(file.uri);return current()?result:null;}catch{return null;}
}
