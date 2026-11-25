import {languageSnapshot} from '../../localization/language';
import {File} from 'expo-file-system';
import ChatCamera from './ChatCamera';
import type {ImagePickerResult} from 'expo-image-picker';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import MediaViewer,{type PreviewItem} from './MediaViewer';
import {localAccount} from '../../modules/identity';
import type {AttachmentPreviewDraft,ConfirmAttachment} from '../../modules/ui/attachmentPreview';

/** Cancelling or leaving the screen never queues a selection. */
export function useAttachmentPreview(){
 const [cameraOpen,setCameraOpen]=useState(false);
 const cameraPending=useRef<((result:ImagePickerResult)=>void)|undefined>(undefined);
 const closeCamera=useCallback(()=>{const resolve=cameraPending.current;cameraPending.current=undefined;setCameraOpen(false);resolve?.({canceled:true,assets:null});},[languageSnapshot()]);
 const capture=useCallback(()=>new Promise<ImagePickerResult>(resolve=>{if(!mounted.current){resolve({canceled:true,assets:null});return;}cameraPending.current?.({canceled:true,assets:null});cameraPending.current=resolve;setCameraOpen(true);}),[languageSnapshot()]);
 useEffect(()=>()=>{cameraPending.current?.({canceled:true,assets:null});cameraPending.current=undefined;},[]);
 const [items,setItems]=useState<PreviewItem[]>([]);
 const mounted=useRef(true);
 const pending=useRef<((drafts:AttachmentPreviewDraft[]|null)=>void)|undefined>(undefined);
 const finish=useCallback((drafts:AttachmentPreviewDraft[]|null)=>{const resolve=pending.current;pending.current=undefined;setItems([]);resolve?.(drafts);},[languageSnapshot()]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.(null);pending.current=undefined;};},[]);
 const confirm:ConfirmAttachment=useCallback(drafts=>new Promise(resolve=>{
  if(!mounted.current){resolve(null);return;}pending.current?.(null);pending.current=resolve;
  setItems(drafts.map((d,i)=>({id:String(i),uri:d.uri,name:d.name,mimeType:d.mime,size:d.size,caption:d.caption,kind:d.mime.startsWith('image/')?'image':d.mime.startsWith('video/')?'video':'file'})));
 }),[languageSnapshot()]);
 return {confirm,capture,isOpen:items.length>0||cameraOpen,modal:<>{cameraOpen&&<ChatCamera onCancel={closeCamera} onCapture={photo=>{const asset={uri:photo.uri,width:photo.width,height:photo.height,type:'image' as const,mimeType:'image/jpeg',fileName:'Photo.jpg',fileSize:new File(photo.uri).size};const resolve=cameraPending.current;cameraPending.current=undefined;setCameraOpen(false);resolve?.({canceled:false,assets:[asset]});}}/>}{items.length?<MediaViewer items={items} onClose={()=>finish(null)} review={{onRemove:id=>{if(items.length===1)finish(null);else setItems(old=>old.filter(i=>i.id!==id));},
  onUpdate:(id,changes)=>setItems(old=>old.map(i=>i.id===id?{...i,...changes}:i)),
  onSend:()=>{if(localAccount.status().state==='unlocked')finish(items.map(i=>({uri:i.uri,name:i.name,mime:i.mimeType||'application/octet-stream',caption:i.caption})));}}}/>:null}</>};
}
