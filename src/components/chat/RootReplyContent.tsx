import {t} from '../../localization/language';
import {attachmentLabel} from '../../utils/attachment-label';
import React from 'react';
import {Text,View} from 'react-native';
import {Image} from 'expo-image';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import type {RootChatMessage} from '../../modules/messaging';
import {attachmentDigest} from '../../modules/media';
import {rootAttachmentFile} from '../../modules/storage';
import {useTransferProgress} from '../../modules/ui/transferState';
import {parseSticker} from '../../services/stickers';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import StickerArt from './sticker-art';
import RootVideoThumbnail from './RootVideoThumbnail';

/** Read-only quote preview: reuse local media, without another download or player. */
export default function RootReplyContent({message}:{message?:RootChatMessage}){
 const {colors}=useTheme(),attachment=message?.attachment;
 const digest=attachment?attachmentDigest(attachment.manifest):undefined;
 useTransferProgress(digest??'');
 const status=localAccount.status(),owner=status.state==='unlocked'?status.account:null;
 const file=owner&&digest&&!message?.deleted?rootAttachmentFile(owner,digest):null;
 const ready=!!file?.exists&&(message?.direction==='outgoing'||message?.status==='delivered');
 const sticker=message&&!message.deleted?parseSticker(message.text):undefined;
 const imported=attachment?.name===IMPORTED_STICKER_CONTENT;
 const label=!message?t("Original message unavailable on this device"):message.deleted?t("Message deleted"):sticker||imported?t("Sticker"):attachment?(attachment.caption||attachmentLabel(attachment)):message.text;
 const media=message&&!message.deleted&&(sticker||ready&&attachment&&(/^(image|video)\//.test(attachment.mime)));
 return <View style={{flexDirection:'row',alignItems:'center',gap:8,marginTop:3}}>
  {media&&(sticker?<StickerArt sticker={sticker} size={56} animate={false}/>:attachment!.mime.startsWith('video/')?<RootVideoThumbnail owner={owner!} digest={digest!} compact/>:<Image source={{uri:file!.uri}} accessibilityLabel={imported?t("Quoted sticker"):t("Quoted photo")} style={{width:imported?56:72,height:imported?56:72,borderRadius:6,flexShrink:0}} contentFit={imported?"contain":"cover"} autoplay={false}/>)}
  <Text numberOfLines={2} style={{color:colors.textSecondary,flexShrink:1}}>{label}</Text>
 </View>;
}
