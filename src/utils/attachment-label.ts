import {t} from '../localization/language';
import {IMPORTED_STICKER_CONTENT} from '../services/sticker-file-format';

/** Display labels only; preserve original filenames in storage and exports. */
export function attachmentLabel(attachment:{name:string;mime?:string}){
 if(attachment.name===IMPORTED_STICKER_CONTENT)return t('Sticker');
 // Older cached conversation summaries contain only a filename.
 const mime=attachment.mime??(/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(attachment.name)?'image/':/\.(mp4|mov|webm|mkv|3gp)$/i.test(attachment.name)?'video/':/\.(m4a|mp3|aac|wav|ogg|opus|flac)$/i.test(attachment.name)?'audio/':'');
 if(mime.startsWith('image/'))return t('Photo');
 if(mime.startsWith('video/'))return t('Video');
 if(mime.startsWith('audio/'))return /^Voice message(?:\.|$)/i.test(attachment.name)?t('Voice message'):t('Audio');
 return attachment.name;
}
