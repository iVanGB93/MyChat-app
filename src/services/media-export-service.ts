import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import {
  getPendingMediaExports,
  getUntrackedReceivedMediaExports,
  getExportedMediaUri,
  initDB,
  markMediaExported,
  queueMediaExport,
  recordRecoveredMediaExport,
  setMessageFileUri,
  type MediaExportType,
  type PendingMediaExport,
} from './localMessageStore';

const AUTO_SAVE_KEY = '@axonic/auto-save-received-media';
const DOWNLOADS_DIR_KEY = '@axonic/downloads-directory-uri';
const ALBUM_NAME = 'Axonic';
const PRIVATE_RECEIVED_DIR = 'received-media';
const DOWNLOAD_COPY_CHUNK_BYTES = 2 * 1024 * 1024;

let autoSaveCache: boolean | null = null;
let downloadsDirectoryCache: string | null | undefined;
const activeExports = new Map<string, Promise<MediaExportResult>>();
const activeMoves = new Map<string, Promise<MediaExportResult>>();

export type MediaExportResult =
  | { state: 'saved'; destination: 'gallery' | 'downloads'; uri: string }
  | { state: 'already-saved'; uri: string }
  | { state: 'needs-downloads-folder' }
  | { state: 'permission-denied' }
  | { state: 'disabled' }
  | { state: 'unsupported' }
  | { state: 'failed'; message: string };

export interface MediaExportRequest {
  messageId: string;
  mediaType: MediaExportType;
  localUri: string;
  fileName?: string | null;
  mime?: string | null;
}

export async function getAutoSaveReceivedMedia(): Promise<boolean> {
  if (autoSaveCache != null) return autoSaveCache;
  const value = await AsyncStorage.getItem(AUTO_SAVE_KEY);
  autoSaveCache = value !== 'false';
  return autoSaveCache;
}

export async function setAutoSaveReceivedMedia(enabled: boolean): Promise<void> {
  autoSaveCache = enabled;
  await AsyncStorage.setItem(AUTO_SAVE_KEY, enabled ? 'true' : 'false');
  if (enabled) void retryPendingMediaExports();
}

export async function getDownloadsDirectoryUri(): Promise<string | null> {
  if (downloadsDirectoryCache !== undefined) return downloadsDirectoryCache;
  downloadsDirectoryCache = await AsyncStorage.getItem(DOWNLOADS_DIR_KEY);
  return downloadsDirectoryCache;
}

function isAxonicDirectory(uri: string): boolean {
  try {
    const decoded = decodeURIComponent(uri).replace(/\/+$/, '').toLowerCase();
    return decoded.endsWith('/axonic') || decoded.endsWith(':axonic');
  } catch {
    return false;
  }
}

/**
 * Android requires the user to grant access to a shared directory once. The
 * picker opens at Downloads; Axonic then creates/reuses Downloads/Axonic.
 */
export async function setupDownloadsDirectory(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const startAt = LegacyFileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
  const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(startAt);
  if (!permission.granted || !permission.directoryUri) return null;

  let axonicUri = permission.directoryUri;
  if (!isAxonicDirectory(axonicUri)) {
    const children = await LegacyFileSystem.StorageAccessFramework.readDirectoryAsync(permission.directoryUri).catch(() => []);
    axonicUri = children.find(isAxonicDirectory)
      ?? await LegacyFileSystem.StorageAccessFramework.makeDirectoryAsync(permission.directoryUri, ALBUM_NAME);
  }

  downloadsDirectoryCache = axonicUri;
  await AsyncStorage.setItem(DOWNLOADS_DIR_KEY, axonicUri);
  return axonicUri;
}

function extensionFor(type: MediaExportType, mime?: string | null): string {
  const normalized = String(mime ?? '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg') || normalized.includes('opus')) return 'ogg';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('zip')) return 'zip';
  if (normalized.includes('wordprocessingml')) return 'docx';
  if (normalized.includes('spreadsheetml')) return 'xlsx';
  if (normalized.includes('presentationml')) return 'pptx';
  if (type === 'image') return 'jpg';
  if (type === 'video') return 'mp4';
  if (type === 'voice') return 'm4a';
  return 'bin';
}

export function safeExportFileName(request: MediaExportRequest): string {
  const supplied = String(request.fileName ?? '')
    .replace(/^[^a-zA-Z0-9._-]+/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim();
  const ext = extensionFor(request.mediaType, request.mime);
  const suppliedExt = supplied.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase();
  const base = (suppliedExt ? supplied.slice(0, -(suppliedExt.length + 1)) : supplied)
    .replace(/\.+$/, '')
    .trim()
    || `${request.mediaType}-${request.messageId.slice(0, 8)}`;
  const encodedMessageId = encodeURIComponent(request.messageId);
  return `AXN_${encodedMessageId}__${base.slice(0, 80)}.${suppliedExt || ext}`;
}

/** Extract the stable message identity without contacting Axonic's backend. */
export function parseDeviceMediaFileName(fileName: string): string | null {
  const match = /^AXN_(.+?)__.+\.[a-zA-Z0-9]{1,10}$/.exec(fileName);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function inferredMime(request: MediaExportRequest): string {
  if (request.mime) return request.mime;
  const ext = safeExportFileName(request).split('.').pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  };
  return (ext && byExt[ext]) || (request.mediaType === 'voice' ? 'audio/mp4' : 'application/octet-stream');
}

async function saveToGallery(request: MediaExportRequest): Promise<string> {
  const MediaLibrary = await import('expo-media-library');
  let permission = await MediaLibrary.getPermissionsAsync(true, ['photo', 'video']);
  if (!permission.granted) {
    permission = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
  }
  if (!permission.granted) throw new Error('MEDIA_PERMISSION_DENIED');

  const source = new File(request.localUri);
  const desiredName = safeExportFileName(request);
  let staging = source;
  if (source.name !== desiredName) {
    staging = new File(source.parentDirectory, desiredName);
    if (staging.exists) staging.delete();
    source.copy(staging);
  }

  try {
    const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
    if (album) {
      const asset = await MediaLibrary.createAssetAsync(staging.uri, album);
      return asset.uri;
    }

    // On Android, creating an asset in the default Gallery and then moving it
    // into a new album triggers a second, item-specific "modify this photo?"
    // system dialog. Create the first asset directly from Axonic's private
    // file in the new album instead, so the normal media permission is enough.
    const createdAlbum = await MediaLibrary.createAlbumAsync(
      ALBUM_NAME,
      undefined,
      true,
      staging.uri,
    );
    const page = await MediaLibrary.getAssetsAsync({ album: createdAlbum, first: 1 });
    const asset = page.assets[0];
    if (!asset) throw new Error('The Axonic Gallery album was created without its media file.');
    return asset.uri;
  } finally {
    if (staging.uri !== source.uri && staging.exists) staging.delete();
  }
}

async function saveToDownloads(request: MediaExportRequest): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const directoryUri = await getDownloadsDirectoryUri();
  if (!directoryUri) return null;
  const fullName = safeExportFileName(request);
  const extension = fullName.match(/\.([a-zA-Z0-9]{1,10})$/)?.[0] ?? '';
  const displayName = extension ? fullName.slice(0, -extension.length) : fullName;
  const destinationUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
    directoryUri,
    displayName,
    inferredMime(request),
  );
  try {
    // Legacy copyAsync cannot stream from a file:// source into a SAF
    // content:// destination. Copy in bounded chunks instead so even a 250 MB
    // attachment never becomes one enormous JS string or byte array.
    const source = new File(request.localUri);
    const size = Number(source.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) throw new Error('The attachment is empty or unavailable.');
    for (let position = 0; position < size; position += DOWNLOAD_COPY_CHUNK_BYTES) {
      const length = Math.min(DOWNLOAD_COPY_CHUNK_BYTES, size - position);
      const base64 = await LegacyFileSystem.readAsStringAsync(request.localUri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
        position,
        length,
      });
      await LegacyFileSystem.StorageAccessFramework.writeAsStringAsync(destinationUri, base64, {
        encoding: LegacyFileSystem.EncodingType.Base64,
        append: position > 0,
      });
    }
    return destinationUri;
  } catch (error) {
    await LegacyFileSystem.StorageAccessFramework.deleteAsync(destinationUri, { idempotent: true }).catch(() => {});
    throw error;
  }
}

async function performExport(request: MediaExportRequest): Promise<MediaExportResult> {
  await initDB();
  const file = new File(request.localUri);
  if (!file.exists) return { state: 'failed', message: 'The local attachment is no longer available.' };
  const queued = await queueMediaExport({
    message_id: request.messageId,
    media_type: request.mediaType,
    local_uri: request.localUri,
    file_name: request.fileName ?? null,
    mime: request.mime ?? null,
  });
  if (queued === 'exported') {
    const uri = await getExportedMediaUri(request.messageId);
    if (uri) return { state: 'already-saved', uri };
  }

  try {
    if (request.mediaType === 'image' || request.mediaType === 'video') {
      const uri = await saveToGallery(request);
      await markMediaExported(request.messageId, uri);
      return { state: 'saved', destination: 'gallery', uri };
    }
    if (Platform.OS !== 'android') return { state: 'unsupported' };
    const uri = await saveToDownloads(request);
    if (!uri) return { state: 'needs-downloads-folder' };
    await markMediaExported(request.messageId, uri);
    return { state: 'saved', destination: 'downloads', uri };
  } catch (error) {
    if (String((error as Error)?.message ?? error).includes('MEDIA_PERMISSION_DENIED')) {
      return { state: 'permission-denied' };
    }
    return { state: 'failed', message: String((error as Error)?.message ?? 'Could not save the attachment.') };
  }
}

export function exportMediaToDevice(request: MediaExportRequest): Promise<MediaExportResult> {
  const running = activeExports.get(request.messageId);
  if (running) return running;
  const work = performExport(request);
  activeExports.set(request.messageId, work);
  return work.finally(() => activeExports.delete(request.messageId));
}

function isAppOwnedUri(uri: string): boolean {
  return uri.startsWith(Paths.cache.uri) || uri.startsWith(Paths.document.uri);
}

/**
 * Legacy inline media used Axonic's cache directory. Cache can be reclaimed by
 * Android, so promote it to app documents before waiting for the user to pick
 * a public Downloads folder or grant Gallery access.
 */
async function preserveInsideAxonic(request: MediaExportRequest): Promise<MediaExportRequest> {
  if (!request.localUri.startsWith(Paths.cache.uri)) return request;
  const source = new File(request.localUri);
  if (!source.exists) return request;

  const directory = new Directory(Paths.document, PRIVATE_RECEIVED_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  const destination = new File(directory, safeExportFileName(request));
  if (destination.exists && destination.size !== source.size) destination.delete();
  if (!destination.exists) source.copy(destination);

  // Switch SQLite first. If this write fails, the original cache file remains
  // valid and the extra document copy can be safely reused on the next retry.
  await setMessageFileUri(request.messageId, destination.uri);
  if (source.uri !== destination.uri && source.exists) source.delete();
  return { ...request, localUri: destination.uri };
}

async function moveMediaToDeviceStorageOnce(request: MediaExportRequest): Promise<MediaExportResult> {
  const durableRequest = await preserveInsideAxonic(request);
  const result = await exportMediaToDevice(durableRequest);
  if (result.state !== 'saved' && result.state !== 'already-saved') return result;
  await setMessageFileUri(durableRequest.messageId, result.uri);
  if (result.uri !== durableRequest.localUri && isAppOwnedUri(durableRequest.localUri)) {
    try {
      const source = new File(durableRequest.localUri);
      if (source.exists) source.delete();
    } catch {
      // Relinking succeeded; stale private cleanup can be handled later.
    }
  }
  return result;
}

/**
 * Make public device storage authoritative for this message. The private copy
 * is removed only after the message row points at the verified public file.
 */
export async function moveMediaToDeviceStorage(request: MediaExportRequest): Promise<MediaExportResult> {
  const running = activeMoves.get(request.messageId);
  if (running) return running;
  const work = moveMediaToDeviceStorageOnce(request);
  activeMoves.set(request.messageId, work);
  return work.finally(() => activeMoves.delete(request.messageId));
}

/** Called only for received messages; outgoing media remains under app control. */
export async function autoExportReceivedMedia(request: MediaExportRequest): Promise<MediaExportResult> {
  if (!await getAutoSaveReceivedMedia()) return { state: 'disabled' };
  return moveMediaToDeviceStorage(request);
}

export async function retryPendingMediaExports(): Promise<void> {
  if (!await getAutoSaveReceivedMedia()) return;
  await initDB();

  // Upgrade media received before the export ledger existed. The message and
  // its private file remain usable in Axonic until a public copy succeeds.
  const untracked = await getUntrackedReceivedMediaExports();
  for (const item of untracked) await queueMediaExport(item);

  // Read one complete snapshot. Failed items remain pending for the next app
  // start/setup attempt, without preventing later items from being tried now.
  const pending = await getPendingMediaExports();
  for (const row of pending) {
    await moveMediaToDeviceStorage({
      messageId: row.message_id,
      mediaType: row.media_type,
      localUri: row.local_uri,
      fileName: row.file_name,
      mime: row.mime,
    });
  }
}

function fileNameFromSafUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri).replace(/\/+$/, '');
    return decoded.slice(decoded.lastIndexOf('/') + 1);
  } catch {
    return '';
  }
}

function mediaTypeFromFileName(fileName: string): MediaExportType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext ?? '')) return 'image';
  if (['mp4', 'mov', 'mkv', 'webm', '3gp'].includes(ext ?? '')) return 'video';
  if (['m4a', 'mp3', 'wav', 'ogg', 'opus', 'aac'].includes(ext ?? '')) return 'voice';
  return 'document';
}

async function recoverDownloadsIndex(): Promise<number> {
  const directoryUri = await getDownloadsDirectoryUri();
  if (!directoryUri || Platform.OS !== 'android') return 0;
  const entries = await LegacyFileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri).catch(() => []);
  let recovered = 0;
  for (const uri of entries) {
    const fileName = fileNameFromSafUri(uri);
    const messageId = parseDeviceMediaFileName(fileName);
    if (!messageId) continue;
    const mediaType = mediaTypeFromFileName(fileName);
    await recordRecoveredMediaExport({
      message_id: messageId,
      media_type: mediaType,
      local_uri: uri,
      file_name: fileName,
      mime: null,
      exported_uri: uri,
    });
    recovered += 1;
  }
  return recovered;
}

async function recoverGalleryIndex(requestPermission: boolean): Promise<number> {
  const MediaLibrary = await import('expo-media-library');
  let permission = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
  if (!permission.granted && requestPermission) {
    permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  }
  if (!permission.granted) return 0;
  const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
  if (!album) return 0;

  let after: string | undefined;
  let recovered = 0;
  do {
    const page = await MediaLibrary.getAssetsAsync({ album, first: 250, after });
    for (const asset of page.assets) {
      const messageId = parseDeviceMediaFileName(asset.filename);
      if (!messageId) continue;
      const mediaType: MediaExportType = asset.mediaType === 'video' ? 'video' : 'image';
      await recordRecoveredMediaExport({
        message_id: messageId,
        media_type: mediaType,
        local_uri: asset.uri,
        file_name: asset.filename,
        mime: null,
        exported_uri: asset.uri,
      });
      recovered += 1;
    }
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);
  return recovered;
}

/** Reconstruct message-id → public-file mappings after local app data is gone. */
export async function recoverMediaIndexFromDevice(requestGalleryPermission = false): Promise<number> {
  await initDB();
  const downloads = await recoverDownloadsIndex();
  const gallery = await recoverGalleryIndex(requestGalleryPermission).catch(() => 0);
  return downloads + gallery;
}

/** Return a recovered public file only while it is still present and readable. */
export async function getAvailableRecoveredMediaUri(messageId: string): Promise<string | null> {
  await initDB();
  const uri = await getExportedMediaUri(messageId);
  if (!uri) return null;
  return await isLocalMediaUriAvailable(uri) ? uri : null;
}

/**
 * Verify a message attachment at interaction time. Gallery thumbnails may stay
 * in Expo Image's disk cache after the user deletes the underlying asset, so a
 * successful render alone is not proof that the original file is still there.
 */
export async function isLocalMediaUriAvailable(uri: string | null | undefined): Promise<boolean> {
  if (!uri) return false;

  // Fast path for Axonic-owned files and Android Gallery file URIs.
  try {
    if (new File(uri).exists) return true;
  } catch {
    // Some MediaStore/Photos providers do not expose File metadata directly.
  }

  // Handles Android content:// providers where the modern File wrapper cannot
  // stat the item. getInfoAsync returns exists=false for a deleted asset.
  try {
    const info = await LegacyFileSystem.getInfoAsync(uri);
    if (info.exists) return true;
  } catch {
    // Fall through to the media-library identity check below.
  }

  // iOS Gallery assets use ph:// identities; Android may also retain a
  // content:// MediaStore id. Looking up a deleted id rejects or returns no
  // usable identity. Do not request permission here—the tap should never
  // surprise the user with a system permission prompt.
  if (uri.startsWith('ph://') || uri.startsWith('content://')) {
    try {
      const MediaLibrary = await import('expo-media-library');
      const info = await MediaLibrary.getAssetInfoAsync(uri, { shouldDownloadFromNetwork: false });
      return Boolean(info?.id && info?.uri);
    } catch {
      return false;
    }
  }

  return false;
}
