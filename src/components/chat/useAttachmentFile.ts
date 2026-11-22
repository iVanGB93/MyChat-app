import {useMemo,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {subscribeAttachmentContentChanges} from '../../modules/media';
import {rootAttachmentFile} from '../../modules/storage';

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
