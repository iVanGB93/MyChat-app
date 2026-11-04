import {t,languageSnapshot} from '../../localization/language';
import {File} from 'expo-file-system';
import ChatCamera from './ChatCamera';
import type {ImagePickerResult} from 'expo-image-picker';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Image,Pressable,Text,View} from 'react-native';
import {openAttachmentPreview} from '../../modules/ui/openAttachmentPreview';
import SharePreview,{type PreviewItem} from './share-preview';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import type {AttachmentPreviewDraft,ConfirmAttachment} from '../../modules/ui/attachmentPreview';

export function AttachmentPreviewContent({draft}:{draft:AttachmentPreviewDraft}){
 const {colors}=useTheme(),[error,setError]=useState('');
 const image=draft.mime.startsWith('image/');
 async function open(){try{
  await openAttachmentPreview(draft.uri,draft.mime);
 }catch{setError(t("Preview unavailable. You can still send this file."));}}
 return <View style={{gap:12}}>
  {image?<Image source={{uri:draft.uri}} accessibilityLabel={t("Selected image preview")} resizeMode="contain" style={{width:'100%',height:260}} onError={()=>setError(t("Image preview unavailable."))}/>:<Pressable accessibilityRole="button" accessibilityLabel={t("Preview selected media")} onPress={()=>void open()} style={{padding:24,alignItems:'center',gap:12}}><Ionicons name={draft.mime.startsWith('video/')?'videocam-outline':draft.mime.startsWith('audio/')?'musical-notes-outline':'document-outline'} size={64} color={colors.primary}/><Text style={{color:colors.primary}}>{t("Tap to preview")}</Text></Pressable>}
  <Text numberOfLines={2} style={{color:colors.text}}>{draft.name}</Text>
  {draft.size!==undefined&&<Text style={{color:colors.textSecondary}}>{draft.size>=1048576?(draft.size/1048576).toFixed(1)+' MB':(draft.size/1024).toFixed(1)+' KB'}</Text>}
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.textSecondary}}>{error}</Text>}
 </View>;
}

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
 return {confirm,capture,isOpen:items.length>0||cameraOpen,modal:<>{cameraOpen&&<ChatCamera onCancel={closeCamera} onCapture={photo=>{const asset={uri:photo.uri,width:photo.width,height:photo.height,type:'image' as const,mimeType:'image/jpeg',fileName:'Photo.jpg',fileSize:new File(photo.uri).size};const resolve=cameraPending.current;cameraPending.current=undefined;setCameraOpen(false);resolve?.({canceled:false,assets:[asset]});}}/>}{items.length?<SharePreview items={items} visible busy={false}
  onClose={()=>finish(null)} onRemove={id=>{if(items.length===1)finish(null);else setItems(old=>old.filter(i=>i.id!==id));}}
  onUpdate={(id,changes)=>setItems(old=>old.map(i=>i.id===id?{...i,...changes}:i))}
  onSend={()=>{if(localAccount.status().state==='unlocked')finish(items.map(i=>({uri:i.uri,name:i.name,mime:i.mimeType||'application/octet-stream',caption:i.caption})));}}/>:null}</>};
}
