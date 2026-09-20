import { AppState, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { getMediaDeletionJobs, finishMediaDeletionJob, hasLiveMediaReference } from './localMessageStore';
import { deleteGalleryAsset } from './local-media-actions';
import { getDownloadsDirectoryUri } from './media-export-service';
import { androidMediaStore, hasAutomaticDeviceStorage, isMediaStoreUri } from './android-media-store';

let running: Promise<void> | null = null;
const retryAfter = new Map<string, number>();

function isPrivateFile(uri: string): boolean {
  // Match a file below an app directory, not the directory itself or a sibling.
  return [Paths.cache.uri, Paths.document.uri].some((root) =>
    uri.startsWith(root.replace(/\/$/, '') + '/') && !uri.includes('/../'));
}

/** Only exact locally recorded Axonic files are eligible; never trust a wire URI. */
export function flushDeletedMedia(interactive = false): Promise<void> {
  if (running) return running;
  if (AppState.currentState !== 'active') return Promise.resolve();
  running = (async () => {
    let consentAttempted = false;
    for (const job of await getMediaDeletionJobs()) {
      if (AppState.currentState !== 'active') break;
      const key = `${job.message_id}:${job.uri}`;
      if (!interactive && (retryAfter.get(key) ?? 0) > Date.now()) continue;
      try {
        if (await hasLiveMediaReference(job.uri)) {
          // A forwarded message owns its surviving reference.
          await finishMediaDeletionJob(job.message_id, job.uri);
          continue;
        }
        if (isPrivateFile(job.uri)) {
          const file = new File(job.uri);
          if (file.exists) file.delete();
        } else if (job.exported) {
          // Legacy exported file:// paths cannot prove MediaStore ownership.
          // Never run an OS consent flow from unattended Android cleanup.
          if (Platform.OS === 'android' && !interactive && (!hasAutomaticDeviceStorage() || !isMediaStoreUri(job.uri))) {
            throw new Error('Legacy file requires user-initiated cleanup');
          }
          if (hasAutomaticDeviceStorage() && isMediaStoreUri(job.uri)) {
            const result = await androidMediaStore!.deleteOwned(job.uri, job.message_id);
            if (result === 'needs-confirmation') {
              if (!interactive || consentAttempted) throw new Error('Storage confirmation required');
              consentAttempted = true;
              if (!await androidMediaStore!.requestDelete(job.uri, job.message_id)) {
                throw new Error('Storage confirmation required');
              }
            }
          } else if (job.type === 'image' || job.type === 'video') {
            if (interactive && consentAttempted) throw new Error('Storage confirmation required');
            if (interactive) consentAttempted = true;
            // This lookup is restricted to Gallery's Axonic album.
            const removed = await deleteGalleryAsset(job.message_id, job.uri, interactive);
            if (!removed && (await FileSystem.getInfoAsync(job.uri)).exists) {
              throw new Error('Asset not removed');
            }
          } else {
            const directory = await getDownloadsDirectoryUri();
            if (!directory) throw new Error('Downloads access unavailable');
            const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(directory);
            // The URI must still be a direct child of the selected Axonic folder.
            if (entries.includes(job.uri)) {
              await FileSystem.StorageAccessFramework.deleteAsync(job.uri, { idempotent: true });
            } else if ((await FileSystem.getInfoAsync(job.uri)).exists) {
              throw new Error('File is outside the selected folder');
            }
          }
        }
        // Picker originals or separately saved copies are detached, never deleted.
        await finishMediaDeletionJob(job.message_id, job.uri);
        retryAfter.delete(key);
      } catch {
        // SQLite keeps the job across restarts. Avoid repeated permission dialogs.
        retryAfter.set(key, Date.now() + 5 * 60_000);
      }
    }
  })().finally(() => { running = null; });
  return running;
}
