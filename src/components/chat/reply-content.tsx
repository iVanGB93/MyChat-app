import React, { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { parseSticker } from '../../services/stickers';
import { IMPORTED_STICKER_CONTENT } from '../../services/sticker-file-format';
import { getMessagesByIds } from '../../services/localMessageStore';
import StickerArt from './sticker-art';

/** Resolve custom stickers from this device, never share a sender's local URI. */
export default function ReplyContent({ id, content, type, uri, style }: {
  id: string; content?: string | null; type?: string; uri?: string | null;
  style?: StyleProp<TextStyle>;
}) {
  const sticker = type === 'text' ? parseSticker(content || '') : undefined;
  const imported = type === 'image' && content === IMPORTED_STICKER_CONTENT;
  const [local, setLocal] = useState<{ id: string; uri: string } | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLocal(null);
    setFailedUri(null);
    if (imported && !uri) {
      void getMessagesByIds([id]).then((rows) => {
        const row = rows[0];
        if (active && row && !row.is_deleted && row.file_uri) setLocal({ id, uri: row.file_uri });
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [id, imported, uri]);
  if (sticker) return <StickerArt sticker={sticker} size={48} animate loop />;
  const source = uri || (local?.id === id ? local.uri : null);
  if (imported && source && source !== failedUri) return (
    <Image source={{ uri: source }} style={{ width: 48, height: 48 }} contentFit="contain"
      autoplay accessibilityLabel="Sticker being replied to" onError={() => setFailedUri(source)} />
  );
  return <Text style={style} numberOfLines={2}>{imported ? 'Sticker unavailable' : content || (type && type !== 'text' ? `[${type}]` : '')}</Text>;
}
