/* ------------------------------------------------------------------ */
/*  Media Lane — out-of-band media transfer (Phase 2)                   */
/*                                                                      */
/*  Large media (image / voice / video) is uploaded to / downloaded     */
/*  from the backend over HTTP, so it NEVER rides the chat WebSocket.    */
/*  The chat message carries only a lightweight pointer                  */
/*  (media_id + md5 + metadata); this module moves the actual bytes.     */
/*                                                                      */
/*  Reliability contract:                                                */
/*   - Sender uploads, gets a media_id, then sends the pointer message.  */
/*   - Receiver downloads to PERSISTENT storage (documents dir, NOT the  */
/*     OS-evictable cache), verifies the md5, then confirms the download */
/*     so the server can safely delete the blob after the grace window.  */
/* ------------------------------------------------------------------ */

import { Directory, File, Paths } from 'expo-file-system';
import api, { BASE_URL, getTokens } from './api';
import { getInstallationId } from './installationIdentity';
import {
  classifyMediaHttpFailure,
  MEDIA_UPLOAD_TIMEOUT_MS,
  validateMediaSize,
  type MediaTransferFailure,
} from './mediaTransferPolicy';

export type MediaType = 'image' | 'voice' | 'video' | 'document';

export interface UploadedMedia {
  media_id: string;
  sha256: string;
  md5: string;
  size_bytes: number;
  mime: string;
}

export class MediaTransferError extends Error {
  readonly failure: MediaTransferFailure;

  constructor(failure: MediaTransferFailure) {
    super(failure.message);
    this.name = 'MediaTransferError';
    this.failure = failure;
  }
}

export function toMediaTransferFailure(error: unknown): MediaTransferFailure {
  if (error instanceof MediaTransferError) return error.failure;
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'timeout', message: 'The transfer timed out and will be retried.', retryable: true, status: 0 };
  }
  return {
    code: 'network',
    message: 'The transfer was interrupted. Axonic will retry when the connection is available.',
    retryable: true,
    status: 0,
  };
}

const MEDIA_ROOT = 'media';

function subdirFor(mediaType: MediaType): string {
  return mediaType === 'voice' ? 'voice' : mediaType === 'video' ? 'video' : mediaType === 'document' ? 'documents' : 'images';
}

function extFor(mediaType: MediaType, mime?: string | null): string {
  const m = (mime || '').toLowerCase();
  if (mediaType === 'voice') {
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('wav')) return 'wav';
    if (m.includes('ogg')) return 'ogg';
    return 'm4a';
  }
  if (mediaType === 'video') {
    if (m.includes('quicktime') || m.includes('mov')) return 'mov';
    return 'mp4';
  }
  if (mediaType === 'document') {
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('wordprocessingml')) return 'docx';
    if (m.includes('msword')) return 'doc';
    if (m.includes('spreadsheetml')) return 'xlsx';
    if (m.includes('ms-excel')) return 'xls';
    if (m.includes('presentationml')) return 'pptx';
    if (m.includes('ms-powerpoint')) return 'ppt';
    if (m.includes('zip')) return 'zip';
    if (m.includes('plain')) return 'txt';
    return 'bin';
  }
  // image
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Persistent (non-cache) directory for a media type. Downloaded media MUST live
 * here — not in Paths.cache — because the server deletes its copy once all
 * recipients confirm, and Android can evict cache dirs at any time.
 */
function persistentDir(mediaType: MediaType): Directory {
  const root = new Directory(Paths.document, MEDIA_ROOT);
  if (!root.exists) root.create({ intermediates: true });
  const dir = new Directory(root, subdirFor(mediaType));
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Local md5 of a file (native, free via expo-file-system). Null on failure. */
export function fileMd5(fileUri: string): string | null {
  try {
    return new File(fileUri).md5 ?? null;
  } catch {
    return null;
  }
}

export function mediaFileSize(fileUri: string): number | null {
  try {
    const size = new File(fileUri).size;
    return typeof size === 'number' && Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

/**
 * Upload a local media file. Returns the server-assigned media_id + hashes.
 * Throws on failure (caller keeps the message pending and retries later).
 */
export async function uploadMedia(params: {
  roomId: string;
  fileUri: string;
  mediaType: MediaType;
  mime: string;
  messageId: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}): Promise<UploadedMedia> {
  const { roomId, fileUri, mediaType, mime, messageId, durationMs, width, height } = params;

  let localFile: File;
  try {
    localFile = new File(fileUri);
    if (!localFile.exists) throw new Error('missing');
  } catch {
    throw new MediaTransferError({
      code: 'invalid_file',
      message: 'The attachment is no longer available on this phone.',
      retryable: false,
      status: 0,
    });
  }
  const sizeFailure = validateMediaSize(localFile.size);
  if (sizeFailure) throw new MediaTransferError(sizeFailure);

  const form = new FormData();
  form.append('file', {
    uri: fileUri,
    name: `${messageId}.${extFor(mediaType, mime)}`,
    type: mime,
  } as any);
  form.append('room_id', roomId);
  form.append('media_type', mediaType);
  form.append('mime', mime);
  form.append('message_id', messageId);
  const md5 = fileMd5(fileUri);
  if (md5) form.append('md5', md5);
  if (durationMs != null) form.append('duration_ms', String(durationMs));
  if (width != null) form.append('width', String(width));
  if (height != null) form.append('height', String(height));

  const tokens = await getTokens();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_UPLOAD_TIMEOUT_MS);
  try {
    // Use fetch (not axios) so React Native sets the multipart boundary itself.
    const res = await fetch(`${BASE_URL}/api/chat/media/`, {
      method: 'POST',
      headers: tokens?.access ? { Authorization: `Bearer ${tokens.access}` } : undefined,
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string; max_bytes?: number } | null;
      throw new MediaTransferError(classifyMediaHttpFailure(
        res.status,
        payload?.error,
        payload?.max_bytes,
      ));
    }
    return (await res.json()) as UploadedMedia;
  } catch (error) {
    if (error instanceof MediaTransferError) throw error;
    throw new MediaTransferError(toMediaTransferFailure(error));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Download a media blob to PERSISTENT storage and verify its md5.
 * Returns the local file URI. Throws on failure / integrity mismatch.
 */
export async function downloadAndPersistMedia(params: {
  mediaId: string;
  mediaType: MediaType;
  mime: string;
  md5?: string | null;
  messageId: string;
}): Promise<string> {
  const { mediaId, mediaType, mime, md5, messageId } = params;
  const dir = persistentDir(mediaType);
  const dest = new File(dir, `${messageId}.${extFor(mediaType, mime)}`);

  // Already have a verified copy? Reuse it.
  if (dest.exists) {
    if (!md5 || dest.md5 === md5) return dest.uri;
    try { dest.delete(); } catch { /* re-download below */ }
  }

  const tokens = await getTokens();
  const url = `${BASE_URL}/api/chat/media/${mediaId}/`;
  const downloaded = await File.downloadFileAsync(url, dest, {
    headers: tokens?.access ? { Authorization: `Bearer ${tokens.access}` } : undefined,
    idempotent: true,
  });

  if (md5 && downloaded.md5 && downloaded.md5 !== md5) {
    try { downloaded.delete(); } catch { /* ignore */ }
    throw new Error('[mediaLane] downloaded md5 mismatch');
  }
  return downloaded.uri;
}

/**
 * Confirm to the server that this device downloaded + persisted the blob.
 * Once all recipients confirm, the server schedules deletion after the grace
 * window. Best-effort: failures are retried by the caller.
 */
export async function confirmDownloaded(mediaId: string): Promise<boolean> {
  const installation_id = await getInstallationId();
  const res = await api.post(`/api/chat/media/${mediaId}/downloaded/`, { installation_id });
  return !!res.data?.all_confirmed;
}
