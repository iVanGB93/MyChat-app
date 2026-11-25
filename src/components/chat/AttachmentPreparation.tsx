import {useLanguage} from '../../localization/useLanguage';
import {t} from '../../localization/language';
import VoiceMessageBubble from '../VoiceMessageBubble';
import {messageBubbleStyles as styles} from './message-bubble-styles';
import {isGroupAvatarFile} from '../../services/group-avatar-file';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import {Ionicons} from '@expo/vector-icons';
import React,{useState} from 'react';

import {View,Text,TextInput,Pressable,ActivityIndicator} from 'react-native';

import {retryRootAttachmentSelection,retryRootAttachmentCaption,removeRootAttachmentSelection,type AttachmentSelection} from '../../modules/media';

export default function AttachmentPreparation({selection:s,colors,report}:{selection:AttachmentSelection;colors:{textSecondary:string;primary:string;bubbleSent:string;neonBorder:string;text:string};report:(error:unknown)=>void}){
 useLanguage();

 const [caption,setCaption]=useState(s.caption??''),[busy,setBusy]=useState(false);

 const act=async(work:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await work();}catch(e){report(e);}finally{setBusy(false);}};

 const status=s.reason==='caption'?t("Caption is too long for this attachment. Shorten it and retry."):s.reason==='audience'?t("A group member is blocked or another recipient could not be prepared."):s.reason==='identity'&&!s.failed?t("Waiting for a recipient’s device identity…"):s.failed?t("Could not prepare attachment"):t("Preparing attachment…");

 if(s.group&&isGroupAvatarFile(s)){
  return <View style={{alignItems:'center',gap:8,marginHorizontal:24,marginVertical:8}}>
   <Text style={{textAlign:'center',color:colors.textSecondary,fontSize:13}}>{s.failed?status:t("Preparing group photo…")}</Text>
   {s.failed&&<View style={{flexDirection:'row',gap:20}}>
    <Pressable disabled={busy} onPress={()=>void act(()=>retryRootAttachmentSelection(s.id))}><Text style={{color:colors.primary}}>{t("Retry")}</Text></Pressable>
    <Pressable disabled={busy} onPress={()=>void act(()=>removeRootAttachmentSelection(s.id))}><Text style={{color:colors.primary}}>{t("Remove")}</Text></Pressable>
   </View>}
  </View>;
 }

 const sticker=s.name===IMPORTED_STICKER_CONTENT&&s.mime.startsWith('image/');
 const kind=sticker?t("Sticker"):s.mime.startsWith('image/')?t("Photo"):s.mime.startsWith('video/')?t("Video"):s.mime.startsWith('audio/')?t("Voice message"):'File';
 const audio=kind==='Voice message';
 const footer=<View style={[styles.metaRow,audio&&{marginTop:0,flexShrink:0}]}><Text style={[styles.timeText,{color:colors.textSecondary}]}>{s.createdAt?new Date(s.createdAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):''}</Text><Ionicons accessibilityLabel={t("Not sent yet")} name="time-outline" size={13} color={colors.textSecondary}/></View>;
 const visual=kind==='Photo'||kind==='Video'||sticker;
 const icon=kind==='Photo'||sticker?'image-outline':kind==='Video'?'videocam-outline':kind==='Voice message'?'mic-outline':'document-outline';
 const statusLine=<View style={{flexDirection:'row',alignItems:'center',gap:8,padding:6}}>{!s.failed&&<ActivityIndicator size="small" color={colors.primary}/>}<Text style={{color:colors.textSecondary,fontSize:12,flexShrink:1}}>{status}</Text></View>;
 return <View style={[styles.bubbleRow,styles.bubbleRowRight]}><View style={[styles.bubbleTouchTarget,styles.bubbleWrap]}><View style={[styles.bubble,styles.bubbleSent,styles.mediaBubble,{minWidth:260,borderColor:colors.neonBorder,backgroundColor:colors.bubbleSent},visual&&!sticker&&styles.photoBubble,kind==='Voice message'&&styles.voiceBubble,sticker&&styles.stickerBubble]}>
 {audio?<VoiceMessageBubble fileUri={null} durationMs={null} loading={!s.failed} loadingLabel={s.failed?t("Failed"):'Preparing...'} tint={colors.primary} subtleColor={colors.textSecondary} trackBg={colors.neonBorder} messageFooter={footer}/>:<View accessibilityLabel={kind+' preparing'} style={[kind==='Video'?styles.videoBubble:sticker?styles.stickerImage:kind==='Photo'?styles.imageBubble:{height:64}, {alignItems:'center',justifyContent:'center',gap:10}]}><Ionicons name={icon} size={40} color={colors.primary}/>{visual?<View style={{position:'absolute',bottom:0,left:0,right:0}}>{statusLine}</View>:null}</View>}
 {!visual&&!audio&&statusLine}
 {!!s.caption&&!(s.failed&&s.reason==='caption')&&<Text style={[styles.messageText,{color:colors.text,marginTop:8}]}>{s.caption}</Text>}
 {!audio&&footer}
 {s.failed&&s.reason==='caption'&&<TextInput accessibilityLabel={t("Attachment caption")} multiline value={caption} onChangeText={setCaption} style={{color:colors.textSecondary,padding:8}}/>}

 {s.failed&&<View style={{flexDirection:'row',gap:20}}><Pressable disabled={busy} onPress={()=>void act(()=>s.reason==='caption'?retryRootAttachmentCaption(s.id,caption):retryRootAttachmentSelection(s.id))}><Text style={{color:colors.primary}}>{t("Retry")}</Text></Pressable><Pressable disabled={busy} onPress={()=>void act(()=>removeRootAttachmentSelection(s.id))}><Text style={{color:colors.primary}}>{t("Remove")}</Text></Pressable></View>}</View></View></View>;

}

