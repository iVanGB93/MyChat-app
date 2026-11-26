import React from 'react';
import {Text} from 'react-native';
import type {RootChatMessage} from '../../modules/messaging';
import type {LocalChatMedia} from '../../modules/storage';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import {useTheme} from '../../contexts/ThemeContext';
import {messageBubbleStyles as styles} from './message-bubble-styles';

export default function RootMediaSize({message,media:file,fileFooter=false}:{message:RootChatMessage;media:LocalChatMedia;fileFooter?:boolean}){
 const {colors}=useTheme();
 if(message.deleted||!file||file.name===IMPORTED_STICKER_CONTENT||file.mime.startsWith('audio/'))return null;
 const bytes=file.bytes,size=bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':(bytes/1024).toFixed(1)+' KB';
 const placement=fileFooter
  ?(message.direction==='incoming'?styles.fileSizeRight:styles.fileSizeLeft)
  :styles.mediaSize;
 return <Text style={[styles.timeText,placement,{color:colors.textTertiary}]}>{size}</Text>;
}
