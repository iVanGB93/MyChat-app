import {requireOptionalNativeModule} from 'expo';
import {File,Paths} from 'expo-file-system';
import {AppState,Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {rootChatView} from './rootChatActions';
import {rootAttachmentFile,removeRootAttachmentContent,rootAttachmentExportLink,adoptRootAttachmentExport} from './rootAttachmentFiles';
import {SharedMediaFile,isSharedMediaUri} from './sharedMediaFile';
import {createReceivedMediaExporter,type MediaExportRecord} from './receivedMediaExport';
import {subscribeOwnChatWrites} from '../../modules/storage/chatStore';
import {createWorkPump} from '../workPump';
import {subscribeAttachmentContentChanges} from './attachmentChanges';

const native=Platform.OS==='android'?requireOptionalNativeModule<{supported:boolean;original?(uri:string,id:string,mime:string):Promise<string|null>;copyShared?(uri:string):Promise<string>;save(uri:string,name:string,mime:string,kind:string):Promise<string>;available(uri:string):Promise<boolean>;deleteOwned(uri:string,id:string):Promise<'deleted'|'missing'|'needs-confirmation'>;requestDelete(uri:string,id:string):Promise<boolean>}>('AxonicMediaStore'):null;
const preference='@axonic/auto-save-received-media';
export const pickRootSharedMedia=()=> (native as (typeof native)&{pickMedia?():Promise<import('expo-image-picker').ImagePickerResult>})?.pickMedia?.();
export const getAutoSaveReceivedMedia=async()=>(await AsyncStorage.getItem(preference))!=='false';
const preferenceListeners=new Set<()=>void>();
export const setAutoSaveReceivedMedia=async(enabled:boolean)=>{await AsyncStorage.setItem(preference,String(enabled));for(const listener of preferenceListeners)listener();};

/** Preserve the selected original when Android exposes an accessible asset ID.
 * Re-encoded selections are different bytes and must not point at that original. */
export async function withRootPickedMedia<T,I extends {uri:string;mime:string;assetId?:string|null}>(items:I[],work:(local:I[])=>Promise<T>):Promise<T>{
 const markers:File[]=[],temporary:File[]=[],local:I[]=[];
 try{
  for(const item of items){
   if(item.uri.startsWith('content://')){
    if(!native?.copyShared)throw Error('Update Axonic to use the media picker');
    const path=await native.copyShared(item.uri);temporary.push(new File(path));local.push({...item,uri:path});
    if(isSharedMediaUri(item.uri)){const marker=new File(path+'.axonic-origin.json');marker.write(JSON.stringify({uri:item.uri}));markers.push(marker);}
    continue;
   }
   local.push(item);
   if(!native?.original||!item.assetId||!/^\d{1,19}$/.test(item.assetId)||!item.uri.startsWith(Paths.cache.uri))continue;
   const uri=await native.original(item.uri,item.assetId,item.mime).catch(()=>null);
   if(uri){const marker=new File(item.uri+'.axonic-origin.json');marker.write(JSON.stringify({uri}));markers.push(marker);}
  }
  const result=await work(local);
  // Only picker-created cache files, after durable staging; never delete a
  // gallery original or a source outside this app's disposable cache.
  for(const item of items)if(item.uri.startsWith(Paths.cache.uri)){try{const file=new File(item.uri);if(file.exists)file.delete();}catch{/* Cache cleanup must not turn a committed send into a retry. */}}
  return result;
 }finally{for(const file of [...markers,...temporary])try{if(file.exists)file.delete();}catch{/* Disposable cache only. */}}
}

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
    save:(uri,...args)=>isSharedMediaUri(uri)?Promise.resolve(uri):native!.save(uri,...args),
    link:async(digest,uri)=>{const verified=verifiedLinks.get(digest);
     // This cache skips completed maintenance only. Actual media reads still
     // resolve and check the canonical file; deleted gallery files stay deleted.
     if(verified?.uri===uri&&verified.until>Date.now())return;
     const remember=()=>{if(verifiedLinks.size>=5000)verifiedLinks.delete(verifiedLinks.keys().next().value!);verifiedLinks.set(digest,{uri,until:Date.now()+300000});};
     const file=rootAttachmentFile(owner,digest);
     if(file instanceof SharedMediaFile){await adoptRootAttachmentExport(owner,digest,file.uri);if(file.uri===uri)remember();return;} // Finish crash-interrupted cleanup once; never recreate media.
     if(await native!.available(uri)){await adoptRootAttachmentExport(owner,digest,uri);
      remember();}},
    remove:async(digest,uri)=>{verifiedLinks.delete(digest);const result=await native!.deleteOwned(uri,digest);if(result==='needs-confirmation')return false;removeRootAttachmentContent(owner,digest);return true;},
   });
  }
  return await worker!.run();
 }
 const scheduler=createWorkPump({run:pump,idleMilliseconds:15000,maximumIdleMilliseconds:300000,nextDelay:()=>AppState.currentState==='active'?worker?.nextDelay()??Infinity:Infinity}),wake=scheduler.wake;
 const offFiles=subscribeAttachmentContentChanges(wake);
 const offWrites=subscribeOwnChatWrites(owner=>{if(owner===localAccount.status().account)wake();});
 const offAccount=localAccount.subscribe(()=>{epoch++;worker=undefined;bound=null;wake();});
 preferenceListeners.add(wake);
 const subscription=AppState.addEventListener('change',state=>{if(state==='active')wake();});
 return {wake,stop(){stopped=true;scheduler.stop();offFiles();offWrites();offAccount();preferenceListeners.delete(wake);subscription.remove();}};
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
 if(file instanceof SharedMediaFile)return file.uri;
 const clean=name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').slice(0,80)||'Attachment';
 const uri=await native.save(file.uri,`AXN_${digest}__${clean}`,mime,mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':'document');
 await adoptRootAttachmentExport(owner,digest,uri);return uri;
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
  const direction=row.direction??'incoming';
  const deleted=state.messages.some(m=>m.peer===row.peer&&m.id===row.id&&m.direction===direction&&m.deleted)||state.removedMessages?.some(m=>m.peer===row.peer&&m.id===row.id&&m.direction===direction);
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
 const origin=new File(path+'.axonic-origin.json');
 try{check();if(isSharedMediaUri(uri))origin.write(JSON.stringify({uri}));return await work(path);}
 finally{if(origin.exists)origin.delete();const file=new File(path);if(file.exists)file.delete();}
}
