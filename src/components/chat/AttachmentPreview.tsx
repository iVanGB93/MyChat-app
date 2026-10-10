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
 }catch{setError('Preview unavailable. You can still send this file.');}}
 return <View style={{gap:12}}>
  {image?<Image source={{uri:draft.uri}} accessibilityLabel="Selected image preview" resizeMode="contain" style={{width:'100%',height:260}} onError={()=>setError('Image preview unavailable.')}/>:<Pressable accessibilityRole="button" accessibilityLabel="Preview selected media" onPress={()=>void open()} style={{padding:24,alignItems:'center',gap:12}}><Ionicons name={draft.mime.startsWith('video/')?'videocam-outline':draft.mime.startsWith('audio/')?'musical-notes-outline':'document-outline'} size={64} color={colors.primary}/><Text style={{color:colors.primary}}>Tap to preview</Text></Pressable>}
  <Text numberOfLines={2} style={{color:colors.text}}>{draft.name}</Text>
  {draft.size!==undefined&&<Text style={{color:colors.textSecondary}}>{draft.size>=1048576?(draft.size/1048576).toFixed(1)+' MB':(draft.size/1024).toFixed(1)+' KB'}</Text>}
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.textSecondary}}>{error}</Text>}
 </View>;
}

/** Cancelling or leaving the screen never queues a selection. */
export function useAttachmentPreview(){
 const [items,setItems]=useState<PreviewItem[]>([]);
 const mounted=useRef(true);
 const pending=useRef<((drafts:AttachmentPreviewDraft[]|null)=>void)|undefined>(undefined);
 const finish=useCallback((drafts:AttachmentPreviewDraft[]|null)=>{const resolve=pending.current;pending.current=undefined;setItems([]);resolve?.(drafts);},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.(null);pending.current=undefined;};},[]);
 const confirm:ConfirmAttachment=useCallback(drafts=>new Promise(resolve=>{
  if(!mounted.current){resolve(null);return;}pending.current?.(null);pending.current=resolve;
  setItems(drafts.map((d,i)=>({id:String(i),uri:d.uri,name:d.name,mimeType:d.mime,caption:d.caption,kind:d.mime.startsWith('image/')?'image':d.mime.startsWith('video/')?'video':'file'})));
 }),[]);
 return {confirm,isOpen:items.length>0,modal:items.length?<SharePreview items={items} visible busy={false}
  onClose={()=>finish(null)} onRemove={id=>{if(items.length===1)finish(null);else setItems(old=>old.filter(i=>i.id!==id));}}
  onUpdate={(id,changes)=>setItems(old=>old.map(i=>i.id===id?{...i,...changes}:i))}
  onSend={()=>{if(localAccount.status().state==='unlocked')finish(items.map(i=>({uri:i.uri,name:i.name,mime:i.mimeType||'application/octet-stream',caption:i.caption})));}}/>:null};
}
