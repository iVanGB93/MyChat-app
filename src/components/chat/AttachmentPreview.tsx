import {languageSnapshot} from '../../localization/language';
import ChatCamera,{discardChatCapture} from './ChatCamera';
import type {ImagePickerResult} from 'expo-image-picker';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import MediaViewer,{type PreviewItem} from './MediaViewer';
import {localAccount} from '../../modules/identity';
import type {AttachmentPreviewDraft,ConfirmAttachment} from '../../modules/ui/attachmentPreview';

/** Cancelling or leaving the screen never queues a selection. */
export function useAttachmentPreview(){
 const [cameraOpen,setCameraOpen]=useState<'picture'|'video'|null>(null);
 const cameraPending=useRef<((result:ImagePickerResult)=>void)|undefined>(undefined);
 const captureUri=useRef<string|undefined>(undefined);
 const closeCamera=useCallback(()=>{const resolve=cameraPending.current;cameraPending.current=undefined;setCameraOpen(null);resolve?.({canceled:true,assets:null});},[languageSnapshot()]);
 const capture=useCallback((mode:'picture'|'video'='picture')=>new Promise<ImagePickerResult>(resolve=>{if(!mounted.current){resolve({canceled:true,assets:null});return;}cameraPending.current?.({canceled:true,assets:null});cameraPending.current=resolve;setCameraOpen(mode);}),[languageSnapshot()]);
 useEffect(()=>()=>{cameraPending.current?.({canceled:true,assets:null});cameraPending.current=undefined;},[]);
 const [items,setItems]=useState<PreviewItem[]>([]);
 const mounted=useRef(true);
 const pending=useRef<((drafts:AttachmentPreviewDraft[]|null)=>void)|undefined>(undefined);
 const finish=useCallback((drafts:AttachmentPreviewDraft[]|null)=>{
  const resolve=pending.current,original=captureUri.current;
  pending.current=undefined;captureUri.current=undefined;setItems([]);
  if(original&&!drafts?.some(draft=>draft.uri===original))discardChatCapture(original);
  resolve?.(drafts);
 },[languageSnapshot()]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.(null);pending.current=undefined;if(captureUri.current)discardChatCapture(captureUri.current);captureUri.current=undefined;};},[]);
 const confirm:ConfirmAttachment=useCallback(drafts=>new Promise(resolve=>{
  if(!mounted.current){resolve(null);return;}pending.current?.(null);pending.current=resolve;
  setItems(drafts.map((d,i)=>({id:String(i),uri:d.uri,name:d.name,mimeType:d.mime,size:d.size,caption:d.caption,kind:d.mime.startsWith('image/')?'image':d.mime.startsWith('video/')?'video':'file'})));
 }),[languageSnapshot()]);
 return {confirm,capture,isOpen:items.length>0||!!cameraOpen,modal:<>{cameraOpen&&<ChatCamera key={cameraOpen} mode={cameraOpen} onCancel={closeCamera} onCapture={(asset,temporary)=>{const resolve=cameraPending.current;cameraPending.current=undefined;captureUri.current=temporary?asset.uri:undefined;setCameraOpen(null);resolve?.({canceled:false,assets:[asset]});}}/>}{items.length?<MediaViewer items={items} onClose={()=>finish(null)} review={{onRemove:id=>{if(items.length===1)finish(null);else setItems(old=>old.filter(i=>i.id!==id));},
  onUpdate:(id,changes)=>setItems(old=>old.map(i=>i.id===id?{...i,...changes}:i)),
  onSend:()=>{if(localAccount.status().state==='unlocked')finish(items.map(i=>({uri:i.uri,name:i.name,mime:i.mimeType||'application/octet-stream',caption:i.caption})));}}}/>:null}</>};
}
