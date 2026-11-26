import {useMemo,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {subscribeAttachmentContentChanges} from '../../modules/media';
import {rootAttachmentPreviewUri,rootAttachmentFile} from '../../modules/storage';

function localFile(owner:string|null,digest:string|undefined){
 if(!owner||!digest)return null;
 try{
  const file=rootAttachmentFile(owner,digest);
  return file.exists?file:null;
 }catch{return null;}
}

/** File changes can affect several grants pointing at the same downloaded media.
 * Recheck on those events, but publish only when this row's usable path changes. */
export function useAttachmentFile(owner:string|null,digest:string|undefined,delivery?:string){
 const source=useMemo(()=>{
  let current=localFile(owner,digest);
  return {
   read:()=>current,
   subscribe(changed:()=>void){
    if(!owner||!digest)return ()=>{};
    const refresh=()=>{
     const next=localFile(owner,digest);
     if(next?.uri===current?.uri)return;
     current=next;changed();
    };
    const detach=subscribeAttachmentContentChanges(refresh);
    const app=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
    refresh();
    return ()=>{detach();app.remove();};
   },
  };
 },[owner,digest,delivery]);
 return useSyncExternalStore(source.subscribe,source.read,source.read);
}

/** Read the private preview on file-change events instead of generating it during scroll. */
export function useAttachmentPreview(owner:string|null,digest:string|undefined){
 const source=useMemo(()=>{
  const find=()=>owner&&digest?rootAttachmentPreviewUri(owner,digest):null;
  let current=find();
  return {read:()=>current,subscribe(changed:()=>void){
   if(!owner||!digest)return ()=>{};
   const refresh=()=>{const next=find();if(next!==current){current=next;changed();}};
   const off=subscribeAttachmentContentChanges(refresh);refresh();return off;
  }};
 },[owner,digest]);
 return useSyncExternalStore(source.subscribe,source.read,source.read);
}
