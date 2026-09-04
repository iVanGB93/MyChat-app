import { Linking, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  getLocalMediaRemovalTarget,
  markLocalMediaRemoved,
  type LocalChatMediaType,
} from './localMessageStore';
import { parseDeviceMediaFileName } from './media-export-service';

function extensionOf(fileName: string, uri: string): string {
  const source = fileName || uri.split(/[?#]/, 1)[0];
  return source.split('.').pop()?.toLowerCase() ?? '';
}

export function localMediaMime(type: LocalChatMediaType, fileName: string, uri: string): string {
  const extension = extensionOf(fileName, uri);
  const known: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac',
    pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return known[extension]
    ?? (type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : type === 'voice' ? 'audio/*' : '*/*');
}

export async function openLocalMediaFile(
  uri: string,
  type: LocalChatMediaType,
  fileName: string,
): Promise<void> {
  if (Platform.OS === 'android') {
    const data = uri.startsWith('content://') ? uri : new File(uri).contentUri;
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data,
      type: localMediaMime(type, fileName, uri),
      flags: 1,
    });
    return;
  }
  await Linking.openURL(uri);
}

function isAppOwnedUri(uri: string): boolean {
  return uri.startsWith(Paths.cache.uri) || uri.startsWith(Paths.document.uri);
}

async function deleteGalleryAsset(messageId: string, uri: string): Promise<boolean> {
  const MediaLibrary = await import('expo-media-library');
  let permission = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
  if (!permission.granted) {
    permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  }
  if (!permission.granted) {
    throw new Error('Axonic needs photo and video access to remove this item from the Gallery.');
  }

  const album = await MediaLibrary.getAlbumAsync('Axonic');
  if (!album) return false;
  let after: string | undefined;
  do {
    const page = await MediaLibrary.getAssetsAsync({ album, first: 250, after });
    const asset = page.assets.find((candidate) => (
      candidate.uri === uri || parseDeviceMediaFileName(candidate.filename) === messageId
    ));
    if (asset) return MediaLibrary.deleteAssetsAsync(asset.id);
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);
  return false;
}

async function deletePhysicalFile(
  messageId: string,
  uri: string,
  type: LocalChatMediaType,
): Promise<void> {
  if (isAppOwnedUri(uri)) {
    const file = new File(uri);
    if (file.exists) file.delete();
    return;
  }

  if (type === 'image' || type === 'video') {
    const removed = await deleteGalleryAsset(messageId, uri);
    if (removed) return;
    // If this is not in Axonic's own Gallery album, it may be the user's
    // original picker source. Detach it from this message, but never erase an
    // unrelated personal photo or video.
    return;
  }

  // Documents and voice notes use the persisted Downloads-folder permission.
  await LegacyFileSystem.deleteAsync(uri, { idempotent: true });
}

export type DeleteLocalMediaResult = 'deleted' | 'already-missing' | 'changed';

/** Delete one attachment from this device without deleting its chat message. */
export async function deleteLocalMediaItem(
  messageId: string,
  type: LocalChatMediaType,
): Promise<DeleteLocalMediaResult> {
  const target = await getLocalMediaRemovalTarget(messageId);
  if (!target) return 'already-missing';

  // A forwarded/reused file remains until its final local reference is removed.
  if (target.otherReferences === 0) {
    await deletePhysicalFile(messageId, target.fileUri, type);
  }
  const marked = await markLocalMediaRemoved(messageId, target.fileUri);
  return marked ? 'deleted' : 'changed';
}
