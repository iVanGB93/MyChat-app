import {t} from '../localization/language';
import RootMessageStatus from './chat/RootMessageStatus';
import {attachmentLabel} from '../utils/attachment-label';
import RootVideoThumbnail from './chat/RootVideoThumbnail';
import {Image} from 'expo-image';
import StickerPreview from './chat/sticker-preview';
import {IMPORTED_STICKER_CONTENT,MAX_STICKER_BYTES} from '../services/sticker-file-format';
import RootAudioPlayer from './chat/RootAudioPlayer';
import React,{useEffect,useMemo,useState} from 'react';
import {AppState,Linking,Platform,Pressable,Text,View,type GestureResponderEvent} from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import {useTheme} from '../contexts/ThemeContext';
import {localAccount} from '../modules/identity';
import {attachmentTransferPresentation} from '../modules/media';
import type {LocalChatMedia} from '../modules/storage';
import {hasConfirmedDelivery,type RootChatMessage} from '../modules/messaging';
import MediaViewer from './chat/MediaViewer';
import {chatMediaKind} from './chat/useChatMediaViewer';
import {messageBubbleStyles as styles,mediaPreviewWidth,type ChatPhotoSize} from './chat/message-bubble-styles';
import {Ionicons} from '@expo/vector-icons';
import {useReceivingProgress} from '../modules/ui/transferState';
import {outgoingMediaStatus} from '../utils/outgoing-media-status';
import {useAttachmentFile,useAttachmentPreview} from './chat/useAttachmentFile';
import {useMotionPhoto} from './chat/useMotionPhoto';
export default function RootAttachmentBubble({message,media,progress:initialProgress,showSize=false,onError,onLongPress,audioFooter,onMedia,voiceKey,nextVoice,photoSize,onPhotoSize}:{message:RootChatMessage;media:LocalChatMedia;progress?:{phase:string;cursor:number;bytes:number;failures:number;canPause:boolean};showSize?:boolean;audioFooter?:React.ReactNode;onLongPress?(event:GestureResponderEvent):void;onError(error:string):void;onMedia?(message:RootChatMessage):void;voiceKey?:string;nextVoice?:string;photoSize?:ChatPhotoSize;onPhotoSize?(size:ChatPhotoSize):void}){
 const [preview,setPreview]=useState(false),[mediaPreview,setMediaPreview]=useState(false);
 const {colors,isDark}=useTheme(),owner=localAccount.status().account;
 const {fileKey:digest,bytes}=media;
 const transfer=useMemo(()=>attachmentTransferPresentation(message),[message]);
 const expires=transfer?.expires;
 const confirmed=hasConfirmedDelivery(message);
 const [,refreshExpiry]=useState(0);
 useEffect(()=>{
  if(expires===undefined)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{clearTimeout(timer);refreshExpiry(v=>v+1);const delay=expires-Date.now();if(delay>0)timer=setTimeout(refresh,Math.min(delay+1,2147483647));};
  refresh();const subscription=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
  return()=>{clearTimeout(timer);subscription.remove();};
 },[expires]);
 const [savedProgress,streamBytes]=useReceivingProgress(transfer?.id??'');
 const progress=savedProgress??initialProgress;
 const file=useAttachmentFile(owner,digest,message.status);
 const thumbnail=useAttachmentPreview(owner,media.preview?.fileKey);
 const sticker=media.name===IMPORTED_STICKER_CONTENT&&bytes<=MAX_STICKER_BYTES&&/^image\/(png|webp|gif)$/.test(media.mime);
 const ready=!!file;
 const checkpointBytes=progress&&transfer?progress.cursor*transfer.bytesPerBlock:0;
 const percent=Math.min(message.direction==='incoming'&&!confirmed?99:100,Math.floor(Math.max(checkpointBytes,streamBytes)/bytes*100));
 const expired=expires!==undefined&&expires<=Date.now(),reset=message.networkCancelledAt!==undefined,paused=progress?.phase==='cancelled';
 const outgoing=expires===undefined?undefined:outgoingMediaStatus(message,expires,progress?.phase,percent);
 const label=!transfer?t("Not available on this device"):message.groupAttachmentDelivery?.delivered?t("Delivered to some recipients"):reset?t("Canceled by network reset"):outgoing?t(outgoing.label):expired?t("Attachment expired"):paused?t("Paused on this device"):`Receiving · ${percent}%`;
 async function open(){try{if(!ready||!file||localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)return;
  if(Platform.OS==='android')await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:file.contentUri,type:media.mime,flags:1});else await Linking.openURL(file.uri);
 }catch{onError('No app could open this file.');}}
 const kind=chatMediaKind(media.mime),image=kind==='image',video=kind==='video',audio=media.mime.startsWith('audio/');
 const motion=useMotionPhoto(image&&!sticker?file?.uri:undefined,media.mime);
 const shape=media.preview??(image?photoSize:undefined),previewImage=thumbnail??(ready&&image?file?.uri:null);
 const framedPreview=!sticker&&(image&&(shape||ready)||video&&shape);
 const fileRow=!audio&&!sticker&&!framedPreview&&!(ready&&video);
 const showTransferHint=(!sticker||!transfer)&&!ready&&!fileRow;
 const previewStyle=shape?{width:mediaPreviewWidth(shape),aspectRatio:shape.width/shape.height}:undefined;
 const showMedia=()=>{if(onMedia)onMedia(message);else setMediaPreview(true);};
 return <View style={{gap:8}}>
  {framedPreview?<Pressable accessibilityRole="button" accessibilityLabel={t(video?"Play video":motion?"View motion photo":"View photo")} onPress={showMedia} onLongPress={onLongPress} style={[video?styles.videoBubble:styles.imageBubble,previewStyle,{overflow:'hidden',backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'}]}>
   {previewImage?<Image source={{uri:previewImage}} recyclingKey={previewImage} allowDownscaling contentFit="contain" cachePolicy="memory"
    onLoad={image&&!shape&&onPhotoSize?({source:{width,height}})=>{
     if(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0)onPhotoSize({width,height});
    }:undefined}
    style={{position:'absolute',width:'100%',height:'100%'}}/>:null}
   {(video||!previewImage)&&<Ionicons name={video?'play-circle-outline':'image-outline'} size={36} color={colors.primary}/>}
   {!!motion&&<View pointerEvents="none" style={{position:'absolute',top:8,left:8,padding:5,borderRadius:14,backgroundColor:colors.headerBg+'DD'}}>
    <Ionicons name="play-circle-outline" size={18} color={colors.primary}/>
   </View>}
  </Pressable>:ready&&sticker?<Pressable accessibilityLabel={t("Preview sticker")} onLongPress={onLongPress} onPress={()=>setPreview(true)}><Image source={{uri:file!.uri}} style={styles.stickerImage} contentFit="contain"/></Pressable>:ready&&video?<RootVideoThumbnail owner={owner!} digest={digest} onPress={showMedia} onLongPress={onLongPress}/>:fileRow&&
   <Pressable accessibilityLabel={ready?t("Open attachment"):undefined} accessibilityRole={ready?'button':undefined} onLongPress={onLongPress} onPress={ready?()=>void open():undefined}
    style={({pressed})=>[styles.sharedFile,ready&&{backgroundColor:isDark
     ?(pressed?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.07)')
     :(pressed?'rgba(0,0,0,0.09)':'rgba(0,0,0,0.05)')}]}>
    <View style={styles.sharedFileIcon}><Ionicons name={video?'videocam-outline':'document-outline'} size={24} color={colors.primary}/></View>
    <View style={styles.sharedFileInfo}>
     <Text numberOfLines={2} style={[styles.sharedFileTitle,{color:colors.text}]}>{attachmentLabel(media)}</Text>
     <Text style={[styles.sharedFileHint,{color:colors.textSecondary}]}>{ready?t("Tap to open"):label}</Text>
    </View>
   </Pressable>}
  {audio&&file&&<RootAudioPlayer uri={file.uri} voiceKey={voiceKey} nextVoice={nextVoice} onError={onError} messageFooter={audioFooter}/>}
  {(showSize||showTransferHint)&&<Text style={[styles.sharedFileHint,{color:colors.textSecondary}]}>{showSize&&(bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':(bytes/1024).toFixed(1)+' KB')}{showTransferHint?(showSize?' · ':'')+label:''}</Text>}
  {showSize&&<RootMessageStatus message={message} onError={onError}/>}
  {!!media.caption&&<Text style={[styles.messageText,{color:colors.text}]}>{media.caption}</Text>}
  {audio&&!ready&&audioFooter}
  {mediaPreview&&owner&&kind&&<MediaViewer items={[{id:message.id,name:media.name,kind,mimeType:media.mime,size:bytes,caption:media.caption,local:{owner,fileKey:digest,previewKey:media.preview?.fileKey,downloadUntil:transfer?.expires,delivery:message.status}}]} onClose={()=>setMediaPreview(false)}/> }
  {preview&&ready&&owner&&<StickerPreview uri={file!.uri} userId={owner} onClose={()=>setPreview(false)}/>}
 </View>;
}
