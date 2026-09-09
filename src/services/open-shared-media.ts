import { Linking, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { getMessagesByIds } from './localMessageStore';

/** Resolve again at tap time: Gallery export may have moved the original file. */
export async function openSharedMedia(uri: string, type: string, messageId?: string): Promise<void> {
  const stored = messageId ? (await getMessagesByIds([messageId]))[0] : null;
  const currentUri = stored?.file_uri || uri;
  if (Platform.OS !== 'android') {
    await Linking.openURL(currentUri);
    return;
  }
  const file = new File(currentUri);
  let contentUri = currentUri;
  if (!currentUri.startsWith('content://')) {
    if (!file.exists) throw new Error('This file is no longer available on this phone.');
    try { contentUri = file.contentUri; }
    catch {
      // Gallery file paths can live outside our FileProvider roots. A bounded
      // cache copy grants the viewer access without moving the user's original.
      const copy = new File(Paths.cache, `open-${file.name}`);
      if (copy.exists) copy.delete();
      file.copy(copy);
      contentUri = copy.contentUri;
    }
  }
  let mime = '';
  try { mime = file.type; } catch { /* Some providers omit MIME metadata. */ }
  if (type === 'video' && !mime.startsWith('video/')) mime = 'video/*';
  if (!mime || mime === 'application/octet-stream') mime = type === 'video' ? 'video/*' : '*/*';
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri, type: mime, flags: 1,
  });
}
