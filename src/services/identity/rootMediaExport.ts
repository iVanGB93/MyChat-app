import {requireOptionalNativeModule} from 'expo';
import {File} from 'expo-file-system';
import {copyAsync} from 'expo-file-system/legacy';
import {AppState,Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {rootChatView} from './rootChatActions';
import {rootAttachmentFile,removeRootAttachmentContent,rootAttachmentExportLink,linkRootAttachmentExport} from './rootAttachmentFiles';
import {createReceivedMediaExporter,type MediaExportRecord} from './receivedMediaExport';
import {subscribeOwnChatWrites} from '../../modules/storage/chatStore';
import {createWorkPump} from '../workPump';

const native=Platform.OS==='android'?requireOptionalNativeModule<{supported:boolean;copyShared?(uri:string):Promise<string>;save(uri:string,name:string,mime:string,kind:string):Promise<string>;available(uri:string):Promise<boolean>;deleteOwned(uri:string,id:string):Promise<'deleted'|'missing'|'needs-confirmation'>;requestDelete(uri:string,id:string):Promise<boolean>}>('AxonicMediaStore'):null;
const preference='@axonic/auto-save-received-media';
export const getAutoSaveReceivedMedia=async()=>(await AsyncStorage.getItem(preference))!=='false';
const preferenceListeners=new Set<()=>void>();
export const setAutoSaveReceivedMedia=async(enabled:boolean)=>{await AsyncStorage.setItem(preference,String(enabled));for(const listener of preferenceListeners)listener();};

/** Separate from delivery acknowledgements and the transfer queue. */
export function startRootMediaExport(){
 let stopped=false,epoch=0,worker:ReturnType<typeof createReceivedMediaExporter>|undefined,bound:string|null=null;
 async function pump(){
  const owner=localAccount.status().account;
  if(stopped||!native?.supported||!owner||localAccount.status().state!=='unlocked'||AppState.currentState!=='active')return;
  if(bound!==owner){bound=owner;const generation=epoch,key='@axonic_received_exports_v1:'+owner;
   const verifiedLinks=new Map<string,{uri:string;until:number}>();
   worker=createReceivedMediaExporter({
    current:()=>!stopped&&generation===epoch&&localAccount.status().account===owner&&localAccount.status().state==='unlocked'&&AppState.currentState==='active',
    snapshot:async()=>rootChatView(owner,await localRootChat().snapshot()),enabled:getAutoSaveReceivedMedia,
    read:async()=>JSON.parse(await AsyncStorage.getItem(key)||'{}') as Record<string,MediaExportRecord>,
    write:rows=>AsyncStorage.setItem(key,JSON.stringify(rows)),
    source:digest=>{const f=rootAttachmentFile(owner,digest);return f.exists?f.uri:null;},
    save:(...args)=>native!.save(...args),
    link:async(digest,uri)=>{const file=rootAttachmentFile(owner,digest),verified=verifiedLinks.get(digest);
     if(verified?.uri===uri&&verified.until>Date.now()&&file.exists&&rootAttachmentExportLink(owner,digest)===uri)return;
     if(await native!.available(uri)){if(!file.exists)await copyAsync({from:uri,to:file.uri});linkRootAttachmentExport(owner,digest,uri);
      if(verifiedLinks.size>=5000)verifiedLinks.delete(verifiedLinks.keys().next().value!);
      verifiedLinks.set(digest,{uri,until:Date.now()+300000});}},
    remove:async(digest,uri)=>{const result=await native!.deleteOwned(uri,digest);if(result==='needs-confirmation')return false;removeRootAttachmentContent(owner,digest);return true;},
   });
  }
  return await worker!.run();
 }
 const scheduler=createWorkPump({run:pump,idleMilliseconds:15000,maximumIdleMilliseconds:300000}),wake=scheduler.wake;
 const offWrites=subscribeOwnChatWrites(owner=>{if(owner===localAccount.status().account)wake();});
 const offAccount=localAccount.subscribe(()=>{epoch++;worker=undefined;bound=null;wake();});
 preferenceListeners.add(wake);
 const subscription=AppState.addEventListener('change',state=>{if(state==='active')wake();});
 return {wake,stop(){stopped=true;scheduler.stop();offWrites();offAccount();preferenceListeners.delete(wake);subscription.remove();}};
}

/** Explicit storage action may ask Android to remove an older owned export. */
export async function removeRootDownloadedMedia(owner:string,digest:string){
 if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)throw Error('Unlock your account');
 const uri=rootAttachmentExportLink(owner,digest);
 if(uri&&native){
  const result=await native.deleteOwned(uri,digest);
  if(result==='needs-confirmation'&&!await native.requestDelete(uri,digest))throw Error('Media removal was not approved');
 }
 removeRootAttachmentContent(owner,digest);
}

/** Explicit Save from the original message menu; independent of auto-save. */
export async function saveRootDownloadedMedia(owner:string,digest:string,name:string,mime:string){
 if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)throw Error('Unlock your account');
 if(!native?.supported)throw Error('Saving media requires Android 10 or later.');
 const file=rootAttachmentFile(owner,digest);if(!file.exists)throw Error('Wait for the download to finish');
 const clean=name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').slice(0,80)||'Attachment';
 const uri=await native.save(file.uri,`AXN_${digest}__${clean}`,mime,mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':'document');
 linkRootAttachmentExport(owner,digest,uri);return uri;
}

/** User-initiated cleanup can ask for one Android consent per invocation. */
export async function finishRootMediaCleanup(){
 const owner=localAccount.status().account;if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');
 if(!native?.supported)return 0;
 const key='@axonic_received_exports_v1:'+owner,rows=JSON.parse(await AsyncStorage.getItem(key)||'{}') as Record<string,MediaExportRecord>;
 const state=rootChatView(owner,await localRootChat().snapshot());let pending=0,asked=false;
 for(const [digest,row] of Object.entries(rows)){
  if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');
  if(!row.peer||!row.id)continue;
  const deleted=state.messages.some(m=>m.peer===row.peer&&m.id===row.id&&m.direction==='incoming'&&m.deleted)||state.removedMessages?.some(m=>m.peer===row.peer&&m.id===row.id&&m.direction==='incoming');
  if(!deleted)continue;
  const result=await native.deleteOwned(row.uri,digest);
  if(result==='needs-confirmation'){
   if(asked){pending++;continue;}asked=true;
   if(!await native.requestDelete(row.uri,digest)){pending++;continue;}
  }
  removeRootAttachmentContent(owner,digest);
 }
 // The normal serialized exporter removes confirmed/missing entries from its journal.
 return pending;
}

/** A share grant is a content URI, not an Expo seekable file. */
export async function withRootSharedFile<T>(owner:string,uri:string,work:(localUri:string)=>Promise<T>):Promise<T>{
 const check=()=>{if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Unlock the original account to share');};
 check();if(!uri.startsWith('content://'))return work(uri);
 if(!native?.copyShared)throw Error('Update Axonic to share this file from another app.');
 const path=await native.copyShared(uri);
 try{check();return await work(path);}finally{const file=new File(path);if(file.exists)file.delete();}
}
