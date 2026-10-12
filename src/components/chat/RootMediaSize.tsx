import React from 'react';
import {Text} from 'react-native';
import type {RootChatMessage} from '../../modules/messaging';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import {useTheme} from '../../contexts/ThemeContext';
import {messageBubbleStyles as styles} from './message-bubble-styles';

export default function RootMediaSize({message}:{message:RootChatMessage}){
 const {colors}=useTheme(),file=message.attachment;
 if(message.deleted||!file||file.name===IMPORTED_STICKER_CONTENT||file.mime.startsWith('audio/'))return null;
 const bytes=file.manifest.bytes,size=bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':(bytes/1024).toFixed(1)+' KB';
 return <Text style={[styles.timeText,styles.mediaSize,{color:colors.textTertiary}]}>{size}</Text>;
}
