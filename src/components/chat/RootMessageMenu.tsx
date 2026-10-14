import {Ionicons} from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {getFirstMessageUrl} from '../SmartMessageText';
import {parseSticker,loadStickerPreferences,updateStickerPreferences} from '../../services/stickers';
import {importSticker,isImportedStickerFavorite} from '../../services/imported-stickers';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import {ThemedAlert as Alert} from '../ui/ThemedAlert';
import {localAccount} from '../../modules/identity';
import {attachmentDigest} from '../../modules/messaging';
import {rootAttachmentFile,saveRootDownloadedMedia,removeRootDownloadedMedia} from '../../modules/storage';
import React from 'react';
import {Modal,Linking,ScrollView,Pressable,Text,TouchableOpacity,View,useWindowDimensions} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {ROOT_REACTIONS} from '../../modules/messaging';
import type {RootChatMessage} from '../../modules/messaging';
import {chatRoomStyles as styles} from './chat-room-styles';
export default function RootMessageMenu({message,close,copy,reply,forward,edit,remove,react,info,pageY,createSticker,onMediaChanged}:{message:RootChatMessage;close():void;copy():void;reply():void;forward?():void;edit():void;remove():void;react(text:string):void;info?():void;pageY?:number;createSticker?(uri:string):void;onMediaChanged?():void}){
 const {colors}=useTheme(),{height}=useWindowDimensions();
 const owner=localAccount.status().account,a=message.attachment,digest=a?attachmentDigest(a.manifest):null;
 const ready=!!owner&&!!digest&&rootAttachmentFile(owner,digest).exists&&(message.direction==='outgoing'||message.status==='delivered');
 const sticker=parseSticker(message.text),url=getFirstMessageUrl(message.text),menuHeight=Math.min(520,height-100);
 const perform=(action:()=>Promise<unknown>)=>void action().catch(e=>Alert.alert('Media',e instanceof Error?e.message:'Please try again.'));
 const icons:Record<string,React.ComponentProps<typeof Ionicons>['name']>={Info:'information-circle-outline','Add to favorites':'star-outline','Open link':'open-outline','Copy link':'link-outline','Copy message':'copy-outline',Reply:'arrow-undo-outline',Forward:'arrow-redo-outline','Save attachment':'download-outline','Create sticker':'happy-outline','Delete downloaded media':'trash-outline','Edit message':'create-outline','Delete message':'trash-outline','Remove my reaction':'heart-dislike-outline'};
 const option=(label:string,fn:()=>void,danger=false)=><TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={()=>{close();fn();}} style={[styles.contextOption,{flexDirection:'row',alignItems:'center',gap:12}]}><Ionicons name={icons[label]??'ellipse-outline'} size={20} color={danger?colors.error:colors.primary}/><Text style={[styles.contextOptionText,{color:danger?colors.error:colors.text}]}>{label}</Text></TouchableOpacity>;
 return <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={close}><Pressable onPress={close} style={[styles.modalBackdrop,{backgroundColor:colors.overlay}]}><Pressable onPress={()=>{}} style={[styles.contextPanel,{backgroundColor:colors.surface,borderColor:colors.neonBorder,top:Math.max(24,Math.min((pageY??height/2)-70,height-menuHeight-24))}]}>
  <ScrollView style={{maxHeight:menuHeight}}>
  {info&&option('Info',info)}
  <View style={styles.reactionsRow}>{ROOT_REACTIONS.map(emoji=><TouchableOpacity key={emoji} accessibilityLabel={'React '+emoji} onPress={()=>{close();react(emoji);}} style={[styles.reactionBtn,{backgroundColor:colors.surfaceVariant}]}><Text style={styles.reactionEmoji}>{emoji}</Text></TouchableOpacity>)}</View>
  <View style={[styles.contextDivider,{backgroundColor:colors.divider}]}/>
  {owner&&(sticker||ready&&a?.name===IMPORTED_STICKER_CONTENT)&&option('Add to favorites',()=>perform(async()=>{
   if(sticker){const prefs=await loadStickerPreferences(owner);if(!prefs.favorites.includes(sticker.id))await updateStickerPreferences(owner,sticker.id,'favorite');}
   else{const uri=rootAttachmentFile(owner,digest!).uri;if(!await isImportedStickerFavorite(owner,uri))await importSticker(owner,uri,'Received sticker',true);}
  }))}
  {!message.attachment&&url&&option('Open link',()=>perform(()=>Linking.openURL(url)))}
  {!message.attachment&&url&&option('Copy link',()=>perform(()=>Clipboard.setStringAsync(url)))}
  {!message.attachment&&option('Copy message',copy)}{option('Reply',reply)}{forward&&option('Forward',forward)}
  {ready&&a&&option('Save attachment',()=>perform(async()=>{await saveRootDownloadedMedia(owner!,digest!,a.name,a.mime);Alert.alert('Media saved',a.mime.startsWith('image/')||a.mime.startsWith('video/')?'Saved in Gallery.':'Saved in Downloads/Axonic.');}))}
  {ready&&a?.mime.startsWith('image/')&&createSticker&&option('Create sticker',()=>createSticker(rootAttachmentFile(owner!,digest!).uri))}
  {ready&&message.direction==='incoming'&&option('Delete downloaded media',()=>Alert.alert('Delete downloaded media?','Remove this downloaded file and its Axonic Gallery copy? The message remains.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>perform(async()=>{await removeRootDownloadedMedia(owner!,digest!);onMediaChanged?.();})}]),true)}
  {message.direction==='outgoing'&&!message.attachment&&option('Edit message',edit)}
  {message.direction==='outgoing'&&option('Delete message',remove,true)}{!!message.reactions?.length&&option('Remove my reaction',()=>react(''))}
 </ScrollView></Pressable></Pressable></Modal>;
}
