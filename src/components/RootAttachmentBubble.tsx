import {t,languageSnapshot} from '../localization/language';
import RootMessageStatus from './chat/RootMessageStatus';
import {attachmentLabel} from '../utils/attachment-label';
import RootVideoThumbnail from './chat/RootVideoThumbnail';
import {Image as StickerImage} from 'expo-image';
import StickerPreview from './chat/sticker-preview';
import {IMPORTED_STICKER_CONTENT,MAX_STICKER_BYTES} from '../services/sticker-file-format';
import RootAudioPlayer from './chat/RootAudioPlayer';
import React,{useEffect,useMemo,useState} from 'react';
import {AppState,Image,Linking,Platform,Pressable,Text,View,type GestureResponderEvent} from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import {useTheme} from '../contexts/ThemeContext';
import {localAccount} from '../modules/identity';
import {attachmentDigest,attachmentBlockBytes} from '../modules/media';
import {rootAttachmentFile} from '../modules/storage';
import {hasConfirmedDelivery,type RootChatMessage} from '../modules/messaging';
import FullscreenImageViewer from './chat/fullscreen-image-viewer';
import {messageBubbleStyles as styles} from './chat/message-bubble-styles';
import {Ionicons} from '@expo/vector-icons';
import {useTransferProgress} from '../modules/ui/transferState';
import {outgoingMediaStatus} from '../utils/outgoing-media-status';
export default function RootAttachmentBubble({message,progress:initialProgress,showSize=false,onError,onLongPress,audioFooter}:{message:RootChatMessage;progress?:{phase:string;cursor:number;bytes:number;failures:number;canPause:boolean};showSize?:boolean;audioFooter?:React.ReactNode;onLongPress?(event:GestureResponderEvent):void;onError(error:string):void}){
 const [preview,setPreview]=useState(false),[imagePreview,setImagePreview]=useState(false);
 const {colors}=useTheme(),descriptor=message.attachment!,owner=localAccount.status().account;
 const confirmed=hasConfirmedDelivery(message);
 const [,refreshExpiry]=useState(0);
 useEffect(()=>{
  if(confirmed)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{clearTimeout(timer);refreshExpiry(v=>v+1);const delay=descriptor.manifest.expires-Date.now();if(delay>0)timer=setTimeout(refresh,Math.min(delay+1,2147483647));};
  refresh();const subscription=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
  return()=>{clearTimeout(timer);subscription.remove();};
 },[descriptor.manifest.expires,confirmed]);
 const digest=useMemo(()=>attachmentDigest(descriptor.manifest),[descriptor.manifest,languageSnapshot()]);
 const progress=useTransferProgress(digest)??initialProgress;
 // File availability and shared payload paths can change; never cache them.
 const file=owner?rootAttachmentFile(owner,digest):null;
 const exists=!!file?.exists;
 const sticker=descriptor.name===IMPORTED_STICKER_CONTENT&&descriptor.manifest.bytes<=MAX_STICKER_BYTES&&/^image\/(png|webp|gif)$/.test(descriptor.mime);
 const ready=exists&&(message.direction==='outgoing'||confirmed);
 const percent=progress?Math.min(100,Math.floor(progress.cursor*attachmentBlockBytes(descriptor.manifest)/descriptor.manifest.bytes*100)):0;
 const expired=descriptor.manifest.expires<=Date.now(),reset=message.networkCancelledAt!==undefined,paused=progress?.phase==='cancelled';
 const outgoing=outgoingMediaStatus(message,descriptor.manifest.expires,progress?.phase,percent);
 const label=confirmed&&!exists?t("Not available on this device"):confirmed?(message.direction==='incoming'?'Received':t("Delivered")):message.groupAttachmentDelivery?.delivered?t("Delivered to some recipients"):reset?t("Canceled by network reset"):outgoing?t(outgoing.label):expired?t("Attachment expired"):paused?t("Paused on this device"):`Receiving · ${percent}%`;
 async function open(){try{if(!ready||!file||localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)return;
  if(Platform.OS==='android')await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:file.contentUri,type:descriptor.mime,flags:1});else await Linking.openURL(file.uri);
 }catch{onError('No app could open this file.');}}
 const image=/^image\/(jpeg|png|gif|webp|heic)$/.test(descriptor.mime),audio=descriptor.mime.startsWith('audio/'),video=descriptor.mime.startsWith('video/');
 return <View style={{gap:8}}>
  {ready&&sticker?<Pressable accessibilityLabel={t("Preview sticker")} onLongPress={onLongPress} onPress={()=>setPreview(true)}><StickerImage source={{uri:file!.uri}} style={styles.stickerImage} contentFit="contain"/></Pressable>:ready&&image?<Pressable accessibilityLabel={t("View photo")} onLongPress={onLongPress} onPress={()=>setImagePreview(true)}><Image source={{uri:file!.uri}} accessibilityLabel={attachmentLabel(descriptor)} style={styles.imageBubble} resizeMode="cover"/></Pressable>:ready&&video?<RootVideoThumbnail owner={owner!} digest={digest} onPress={()=>void open()} onLongPress={onLongPress}/>:!audio&&!sticker&&<Pressable accessibilityLabel={t("Open attachment")} onLongPress={onLongPress} onPress={()=>void open()} style={[styles.sharedFile,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}><View style={[styles.sharedFileIcon,{backgroundColor:colors.highlight}]}><Ionicons name={descriptor.mime.startsWith('video/')?'videocam-outline':'document-outline'} size={24} color={colors.primary}/></View><View style={styles.sharedFileInfo}><Text numberOfLines={2} style={[styles.sharedFileTitle,{color:colors.text}]}>{attachmentLabel(descriptor)}</Text><Text style={[styles.sharedFileHint,{color:colors.textSecondary}]}>{ready?t("Tap to open"):label}</Text></View></Pressable>}
  {ready&&descriptor.mime.startsWith('audio/')&&<RootAudioPlayer uri={file!.uri} onError={onError} messageFooter={audioFooter}/>}
  {(showSize||!sticker&&!ready)&&<Text style={[styles.sharedFileHint,{color:colors.textSecondary}]}>{showSize&&(descriptor.manifest.bytes>=1048576?(descriptor.manifest.bytes/1048576).toFixed(1)+' MB':(descriptor.manifest.bytes/1024).toFixed(1)+' KB')}{!ready?(showSize?' · ':'')+label:''}</Text>}
  {showSize&&<RootMessageStatus message={message} onError={onError}/>}
  {!!descriptor.caption&&<Text style={[styles.messageText,{color:colors.text}]}>{descriptor.caption}</Text>}
  {audio&&!ready&&audioFooter}
  {imagePreview&&ready&&<FullscreenImageViewer uri={file!.uri} accentColor={colors.primary} onClose={()=>setImagePreview(false)}/>}
  {preview&&ready&&owner&&<StickerPreview uri={file!.uri} userId={owner} onClose={()=>setPreview(false)}/>}
 </View>;
}
