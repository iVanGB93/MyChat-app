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
import { fetch } from 'expo/fetch';
import api, { BASE_URL, getTokens } from './api';
import { getInstallationId } from './installationIdentity';
import {
  classifyMediaHttpFailure,
  MEDIA_UPLOAD_TIMEOUT_MS,
  mapWithConcurrency,
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

interface DirectUploadPreparation extends UploadedMedia {
  uploaded: boolean;
  upload_mode?: 'single' | 'multipart';
  upload_url?: string;
  upload_headers?: Record<string, string>;
  part_size?: number;
  parts?: Array<{ part_number: number; uploaded: boolean; upload_url?: string }>;
  direct_upload?: boolean;
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

// Document mimeType detection from content-provider-backed pickers (Google
// Drive, Files app, etc.) is unreliable and often generic/missing, which used
// to make every such document fall back to a useless `.bin` extension that
// Android has no app registered for. The transmitted filename (the message's
// `content`) usually still carries the real extension, so prefer that for
// document type when the mime sniff comes up empty. Allowlisted to avoid
// treating a stray dot in a filename as a bogus "extension".
const KNOWN_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'txt', 'csv',
  'rtf', 'odt', 'ods', 'odp', 'json', 'xml', 'html', 'md',
]);

function extFromFileName(fileName?: string | null): string | null {
  const match = /\.([a-zA-Z0-9]{1,6})$/.exec(fileName ?? '');
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return KNOWN_DOCUMENT_EXTENSIONS.has(ext) ? ext : null;
}

function extFor(mediaType: MediaType, mime?: string | null, fileName?: string | null): string {
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
    return extFromFileName(fileName) ?? 'bin';
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

  const md5 = fileMd5(fileUri);
  if (md5) {
    try {
      const prepared = await api.post<DirectUploadPreparation>(
        '/api/chat/media/initiate/',
        {
          room_id: roomId,
          media_type: mediaType,
          mime,
          message_id: messageId,
          size_bytes: localFile.size,
          md5,
          ...(durationMs != null ? { duration_ms: durationMs } : {}),
          ...(width != null ? { width } : {}),
          ...(height != null ? { height } : {}),
        },
        { timeout: 30_000 },
      );

      if (prepared.data.uploaded) return prepared.data;
      if (prepared.data.upload_mode === 'multipart') {
        const partSize = Number(prepared.data.part_size ?? 0);
        const parts = prepared.data.parts ?? [];
        if (partSize <= 0 || parts.length === 0) {
          throw new MediaTransferError({
            code: 'server_error',
            message: 'The server did not prepare the resumable attachment upload.',
            retryable: true,
            status: 500,
          });
        }
        await mapWithConcurrency(
          parts.filter((part) => !part.uploaded),
          3,
          async (part) => {
            if (!part.upload_url) {
              throw new MediaTransferError({
                code: 'server_error',
                message: `Upload part ${part.part_number} was not prepared.`,
                retryable: true,
                status: 500,
              });
            }
            const start = (part.part_number - 1) * partSize;
            const body = localFile.slice(start, Math.min(start + partSize, localFile.size), mime);
            let lastStatus = 0;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), MEDIA_UPLOAD_TIMEOUT_MS);
              try {
                const response = await fetch(part.upload_url, {
                  method: 'PUT',
                  body,
                  signal: controller.signal,
                });
                lastStatus = response.status;
                if (response.ok) return;
                if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
              } catch (error) {
                if (attempt === 2) throw error;
              } finally {
                clearTimeout(timeout);
              }
            }
            throw new MediaTransferError({
              code: lastStatus === 403 ? 'network' : 'server_error',
              message: 'A resumable upload part was interrupted. Retry to continue from completed parts.',
              retryable: true,
              status: lastStatus,
            });
          },
        );
      } else {
        if (!prepared.data.upload_url || !prepared.data.upload_headers) {
          throw new MediaTransferError({
            code: 'server_error',
            message: 'The server did not prepare the attachment upload.',
            retryable: true,
            status: 500,
          });
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), MEDIA_UPLOAD_TIMEOUT_MS);
        try {
          // The signed URL is intentionally unauthenticated: the signature grants
          // access to this one object for a few minutes. File implements Blob, so
          // React Native streams it without constructing a 250 MB JS byte array.
          const uploaded = await fetch(prepared.data.upload_url, {
            method: 'PUT',
            headers: prepared.data.upload_headers,
            body: localFile as unknown as BodyInit,
            signal: controller.signal,
          });
          if (!uploaded.ok) {
            throw new MediaTransferError(classifyMediaHttpFailure(uploaded.status));
          }
        } finally {
          clearTimeout(timeout);
        }
      }

      const completed = await api.post<UploadedMedia>(
        `/api/chat/media/${prepared.data.media_id}/complete/`,
        {},
        { timeout: 30_000 },
      );
      return completed.data;
    } catch (error: any) {
      if (error instanceof MediaTransferError) throw error;
      const status = Number(error?.response?.status || 0);
      const payload = error?.response?.data as {
        error?: string;
        max_bytes?: number;
        direct_upload?: boolean;
      } | undefined;
      // Local/older servers keep using the original multipart endpoint.
      if (status === 404 || (status === 409 && payload?.direct_upload === false)) {
        return uploadMediaViaBackend(params, localFile, md5);
      }
      if (status > 0) {
        throw new MediaTransferError(
          classifyMediaHttpFailure(status, payload?.error, payload?.max_bytes),
        );
      }
      throw new MediaTransferError(toMediaTransferFailure(error));
    }
  }

  // MD5 is native and normally available. Keep the compatibility path for
  // unusual content providers that do not expose it.
  return uploadMediaViaBackend(params, localFile, null);
}

async function uploadMediaViaBackend(
  params: {
    roomId: string;
    fileUri: string;
    mediaType: MediaType;
    mime: string;
    messageId: string;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
  },
  localFile: File,
  knownMd5: string | null,
): Promise<UploadedMedia> {
  const { roomId, fileUri, mediaType, mime, messageId, durationMs, width, height } = params;

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
  const md5 = knownMd5 ?? fileMd5(fileUri);
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
  /** Original filename (e.g. the document's message content), used as an
   *  extension fallback when `mime` is missing or too generic to sniff. */
  fileName?: string | null;
}): Promise<string> {
  const { mediaId, mediaType, mime, md5, messageId, fileName } = params;
  const dir = persistentDir(mediaType);
  const dest = new File(dir, `${messageId}.${extFor(mediaType, mime, fileName)}`);

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
