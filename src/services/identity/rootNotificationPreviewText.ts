import {isGroupAvatarFile} from '../group-avatar-file';
import {parseSticker} from '../stickers';
import {IMPORTED_STICKER_CONTENT} from '../sticker-file-format';
import type {RootChatMessage} from './rootChatTypes';
/** Called after verified descriptor admission, before attachment download/receipt. */
export function rootNotificationPreviewText(message:Pick<RootChatMessage,'attachment'|'text'|'group'>){
 const media=message.attachment;
 if(!media)return parseSticker(message.text)?'Sticker':message.text;
 if(message.group&&isGroupAvatarFile(media))return 'Group avatar';
 if(media.name===IMPORTED_STICKER_CONTENT)return 'Sticker';
 if(media.mime.startsWith('image/'))return 'Photo';
 if(media.mime.startsWith('video/'))return 'Video';
 if(media.mime.startsWith('audio/'))return 'Voice message';
 return 'File';
}
