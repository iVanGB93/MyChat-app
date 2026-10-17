import RootVideoThumbnail from './chat/RootVideoThumbnail';
import {Image as StickerImage} from 'expo-image';
import StickerPreview from './chat/sticker-preview';
import {IMPORTED_STICKER_CONTENT,MAX_STICKER_BYTES} from '../services/sticker-file-format';
import RootAudioPlayer from './chat/RootAudioPlayer';
import React,{useMemo,useState} from 'react';
import {Image,Linking,Platform,Pressable,Text,View,type GestureResponderEvent} from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import {useTheme} from '../contexts/ThemeContext';
import {localAccount} from '../modules/identity';
import {attachmentDigest} from '../modules/messaging';
import {rootAttachmentFile} from '../modules/storage';
import type {RootChatMessage} from '../modules/messaging';
import {controlRootAttachment} from '../modules/messaging';
import FullscreenImageViewer from './chat/fullscreen-image-viewer';
import {messageBubbleStyles as styles} from './chat/message-bubble-styles';
import {Ionicons} from '@expo/vector-icons';
export default function RootAttachmentBubble({message,progress,showSize=false,onError,onLongPress,audioFooter}:{message:RootChatMessage;progress?:{phase:string;cursor:number;bytes:number;failures:number;canPause:boolean};showSize?:boolean;audioFooter?:React.ReactNode;onLongPress?(event:GestureResponderEvent):void;onError(error:string):void}){
 const [changing,setChanging]=useState(false),[preview,setPreview]=useState(false),[imagePreview,setImagePreview]=useState(false);
 const {colors}=useTheme(),descriptor=message.attachment!,owner=localAccount.status().account;
 const digest=useMemo(()=>attachmentDigest(descriptor.manifest),[descriptor.manifest]);
 // File availability and shared payload paths can change; never cache them.
 const file=owner?rootAttachmentFile(owner,digest):null;
 const exists=!!file?.exists;
 const sticker=descriptor.name===IMPORTED_STICKER_CONTENT&&descriptor.manifest.bytes<=MAX_STICKER_BYTES&&/^image\/(png|webp|gif)$/.test(descriptor.mime);
 const ready=exists&&(message.direction==='outgoing'||message.status==='delivered');
 const percent=progress?Math.min(100,Math.floor(progress.cursor*4096/descriptor.manifest.bytes*100)):0;
 const expired=descriptor.manifest.expires<=Date.now(),reset=message.networkCancelledAt!==undefined,paused=progress?.phase==='cancelled';
 const label=message.status==='delivered'&&!exists?'Removed from this device':message.status==='delivered'?(message.direction==='incoming'?'Received':'Delivered'):reset?'Canceled by network reset':expired?'Attachment expired':paused?'Paused on this device':progress?.phase==='confirming'?'Waiting for confirmation':`${message.direction==='outgoing'?'Sending':'Receiving'} · ${percent}%`;
 async function control(action:'pause'|'retry'){if(changing)return;setChanging(true);try{await controlRootAttachment(digest,action);}catch(error){onError(error instanceof Error?error.message:'Unable to update transfer');}finally{setChanging(false);}}
 async function open(){try{if(!ready||!file||localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)return;
  if(Platform.OS==='android')await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:file.contentUri,type:descriptor.mime,flags:1});else await Linking.openURL(file.uri);
 }catch{onError('No app could open this file.');}}
 const image=/^image\/(jpeg|png|gif|webp|heic)$/.test(descriptor.mime),audio=descriptor.mime.startsWith('audio/'),video=descriptor.mime.startsWith('video/');
 return <View style={{gap:8}}>
  {ready&&sticker?<Pressable accessibilityLabel="Preview sticker" onLongPress={onLongPress} onPress={()=>setPreview(true)}><StickerImage source={{uri:file!.uri}} style={styles.stickerImage} contentFit="contain"/></Pressable>:ready&&image?<Pressable accessibilityLabel="View photo" onLongPress={onLongPress} onPress={()=>setImagePreview(true)}><Image source={{uri:file!.uri}} accessibilityLabel={descriptor.name} style={styles.imageBubble} resizeMode="cover"/></Pressable>:ready&&video?<RootVideoThumbnail owner={owner!} digest={digest} onPress={()=>void open()} onLongPress={onLongPress}/>:!audio&&!sticker&&<Pressable accessibilityLabel="Open attachment" onLongPress={onLongPress} onPress={()=>void open()} style={[styles.sharedFile,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><View style={[styles.sharedFileIcon,{backgroundColor:colors.highlight}]}><Ionicons name={descriptor.mime.startsWith('video/')?'videocam-outline':'document-outline'} size={24} color={colors.primary}/></View><View style={styles.sharedFileInfo}><Text numberOfLines={2} style={[styles.sharedFileTitle,{color:colors.text}]}>{descriptor.name}</Text><Text style={[styles.sharedFileHint,{color:colors.textSecondary}]}>{ready?'Tap to open':label}</Text></View></Pressable>}
  {ready&&descriptor.mime.startsWith('audio/')&&<RootAudioPlayer uri={file!.uri} onError={onError} messageFooter={audioFooter}/>}
  {(showSize||!sticker&&!ready)&&<Text style={[styles.sharedFileHint,{color:colors.textSecondary}]}>{showSize&&(descriptor.manifest.bytes>=1048576?(descriptor.manifest.bytes/1048576).toFixed(1)+' MB':(descriptor.manifest.bytes/1024).toFixed(1)+' KB')}{!ready?(showSize?' · ':'')+label:''}</Text>}
  {message.status!=='delivered'&&!reset&&!expired&&progress?.canPause&&<Pressable accessibilityRole="button" disabled={changing} onPress={()=>void control('pause')}><Text style={{color:colors.text}}>Pause transfer</Text></Pressable>}
  {message.status!=='delivered'&&!reset&&!expired&&(paused||!!progress?.failures)&&<Pressable accessibilityRole="button" disabled={changing} onPress={()=>void control('retry')}><Text style={{color:colors.text}}>{paused?'Resume transfer':'Retry now'}</Text></Pressable>}
  {paused&&!expired&&<Text style={{color:colors.textSecondary}}>Pauses this device only. Copies already sent may still arrive.</Text>}
  {!!descriptor.caption&&<Text style={[styles.messageText,{color:colors.text}]}>{descriptor.caption}</Text>}
  {audio&&!ready&&audioFooter}
  {imagePreview&&ready&&<FullscreenImageViewer uri={file!.uri} accentColor={colors.primary} onClose={()=>setImagePreview(false)}/>}
  {preview&&ready&&owner&&<StickerPreview uri={file!.uri} userId={owner} onClose={()=>setPreview(false)}/>}
 </View>;
}
