import {parseSticker} from '../stickers';
import type {RootChatMessage} from './rootChatTypes';
/** Called after verified descriptor admission, before attachment download/receipt. */
export function rootNotificationPreviewText(message:Pick<RootChatMessage,'attachment'|'text'>){
 const media=message.attachment;
 if(!media)return parseSticker(message.text)?'Sticker':message.text;
 if(media.mime.startsWith('image/'))return 'Photo';
 if(media.mime.startsWith('video/'))return 'Video';
 if(media.mime.startsWith('audio/'))return 'Voice message';
 return 'File';
}
