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
import { createUploadTask, getInfoAsync, FileSystemUploadType, type FileSystemUploadOptions } from 'expo-file-system/legacy';
import { fetch } from 'expo/fetch';
import api, { BASE_URL } from './api';
import { getValidAccessToken, refreshAccessToken } from './tokenRefresh';
import { getInstallationId } from './installationIdentity';
import {
  classifyMediaHttpFailure,
  MEDIA_UPLOAD_TIMEOUT_MS,
  MEDIA_BATCH_CONCURRENCY,
  MEDIA_PART_CONCURRENCY,
  createTransferScheduler,
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

const scheduleUpload = createTransferScheduler<UploadedMedia>(MEDIA_BATCH_CONCURRENCY);

function httpStatus(error: unknown): number {
  if (error instanceof MediaTransferError) return error.failure.status;
  const value = error as { status?: number; response?: { status?: number }; message?: string } | null;
  // Expo's native downloader reports HTTP errors as exception messages on both
  // Android ("response has status: 401") and iOS ("response has status 401").
  return Number(value?.response?.status ?? value?.status
    ?? /response has status:?\s*(\d{3})\b/i.exec(value?.message ?? '')?.[1] ?? 0);
}

async function withMediaAuthentication<T>(operation: (access: string) => Promise<T>): Promise<T> {
  const access = await getValidAccessToken();
  if (!access) throw new MediaTransferError(classifyMediaHttpFailure(401));
  try {
    return await operation(access);
  } catch (error) {
    if (httpStatus(error) !== 401) throw error;
    // Another request may already have refreshed this token. Share its result
    // instead of rotating the session again. Never retry a 403/404 as auth.
    const current = await getValidAccessToken();
    if (!current) throw new MediaTransferError(classifyMediaHttpFailure(401));
    const refreshed = current !== access ? current : (await refreshAccessToken()).access;
    return operation(refreshed);
  }
}

/** Native file-backed body: unlike expo/fetch's Blob/FormData normalization,
 * this does not copy an entire file into JavaScript memory. */
async function uploadFileNative(url: string, fileUri: string, options: FileSystemUploadOptions) {
  const task = createUploadTask(url, fileUri, options);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void task.cancelAsync().catch(() => {});
  }, MEDIA_UPLOAD_TIMEOUT_MS);
  try {
    const response = await task.uploadAsync();
    if (timedOut || !response) {
      throw new MediaTransferError(classifyMediaHttpFailure(408));
    }
    return response;
  } catch (error) {
    if (timedOut) throw new MediaTransferError(classifyMediaHttpFailure(408));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function toMediaTransferFailure(error: unknown): MediaTransferFailure {
  if (error instanceof MediaTransferError) return error.failure;
  const status = httpStatus(error);
  if (status) return classifyMediaHttpFailure(status);
  if (/Creating blobs from|Unsupported BodyInit type/.test((error as Error | null)?.message ?? '')) {
    return { code: 'invalid_file', message: 'The attachment could not be prepared. Please select it again.', retryable: false, status: 0 };
  }
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

/** Stream the native checksum off the JS thread. Expo 55's File.md5 getter
 * reads the entire file into a native byte array, which can exhaust Android's
 * heap on large attachments even though the transfer itself is streamed. */
export async function fileMd5(fileUri: string): Promise<string | null> {
  try {
    const info = await getInfoAsync(fileUri, { md5: true });
    return info.exists ? info.md5 ?? null : null;
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
export interface UploadMediaParams {
  roomId: string;
  fileUri: string;
  mediaType: MediaType;
  mime: string;
  messageId: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}

export function uploadMedia(params: UploadMediaParams): Promise<UploadedMedia> {
  return scheduleUpload(`${params.roomId}:${params.messageId}`, () => uploadMediaOnce(params));
}

async function uploadMediaOnce(params: UploadMediaParams): Promise<UploadedMedia> {
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

  const md5 = await fileMd5(fileUri);
  if (md5) {
    let preparedUpload = false;
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
      preparedUpload = true;

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
          MEDIA_PART_CONCURRENCY,
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
            const length = Math.min(partSize, localFile.size - start);
            if (start < 0 || length <= 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(length)) {
              throw new MediaTransferError(classifyMediaHttpFailure(500, 'The server returned an invalid upload part.'));
            }
            // File.slice() in Expo 55 reads the WHOLE file and constructs a Blob
            // from a Uint8Array, unsupported by React Native. Read only this
            // range and pass its bytes directly to expo/fetch (no Blob).
            const handle = localFile.open();
            let body: Uint8Array;
            try {
              handle.offset = start;
              body = handle.readBytes(length);
            } finally {
              handle.close();
            }
            if (body.byteLength !== length) {
              throw new MediaTransferError(classifyMediaHttpFailure(400, 'The attachment changed or could not be fully read. Please select it again.'));
            }
            let lastStatus = 0;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), MEDIA_UPLOAD_TIMEOUT_MS);
              try {
                const response = await fetch(part.upload_url, {
                  method: 'PUT',
                  body: body as unknown as BodyInit,
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
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
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
        // Never attach a bearer token to the signed object-storage URL.
        const uploaded = await uploadFileNative(prepared.data.upload_url, localFile.uri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: prepared.data.upload_headers,
        });
        if (uploaded.status < 200 || uploaded.status >= 300) {
          if (uploaded.status === 403) {
            throw new MediaTransferError({ code: 'network', message: 'The upload link was rejected or expired. Retry to obtain a fresh link.', retryable: true, status: 403 });
          }
          throw new MediaTransferError(classifyMediaHttpFailure(uploaded.status));
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
      if (!preparedUpload && (status === 404 || (status === 409 && payload?.direct_upload === false))) {
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
  params: UploadMediaParams,
  localFile: File,
  knownMd5: string | null,
): Promise<UploadedMedia> {
  const { roomId, fileUri, mediaType, mime, messageId, durationMs, width, height } = params;

  const parameters: Record<string, string> = { room_id: roomId, media_type: mediaType, mime, message_id: messageId };
  const md5 = knownMd5 ?? await fileMd5(fileUri);
  if (md5) parameters.md5 = md5;
  if (durationMs != null) parameters.duration_ms = String(durationMs);
  if (width != null) parameters.width = String(width);
  if (height != null) parameters.height = String(height);

  try {
    return await withMediaAuthentication(async (access) => {
      const res = await uploadFileNative(`${BASE_URL}/api/chat/media/`, localFile.uri, {
        httpMethod: 'POST',
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: mime,
        parameters,
        headers: { Authorization: `Bearer ${access}` },
      });
      let payload: (UploadedMedia & { error?: string; max_bytes?: number }) | null = null;
      try { payload = JSON.parse(res.body); } catch { /* classified below */ }
      if (res.status < 200 || res.status >= 300) {
        throw new MediaTransferError(classifyMediaHttpFailure(res.status, payload?.error, payload?.max_bytes));
      }
      if (!payload?.media_id) throw new MediaTransferError(classifyMediaHttpFailure(502));
      return payload;
    });
  } catch (error) {
    if (error instanceof MediaTransferError) throw error;
    throw new MediaTransferError(toMediaTransferFailure(error));
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
  sizeBytes?: number | null;
  /** Original filename (e.g. the document's message content), used as an
   *  extension fallback when `mime` is missing or too generic to sniff. */
  fileName?: string | null;
}): Promise<string> {
  const { mediaId, mediaType, mime, md5, messageId, fileName, sizeBytes } = params;
  const dir = persistentDir(mediaType);
  const dest = new File(dir, `${messageId}.${extFor(mediaType, mime, fileName)}`);

  // Already have a verified copy? Reuse it.
  if (dest.exists) {
    if ((!md5 || await fileMd5(dest.uri) === md5) && (sizeBytes == null || dest.size === sizeBytes)) return dest.uri;
    try { dest.delete(); } catch { /* re-download below */ }
  }

  const url = `${BASE_URL}/api/chat/media/${mediaId}/`;
  const partial = new File(dir, `${messageId}.${extFor(mediaType, mime, fileName)}.partial`);
  try {
    const downloaded = await withMediaAuthentication((access) => File.downloadFileAsync(url, partial, {
      headers: { Authorization: `Bearer ${access}` },
      idempotent: true,
    }));
    if ((md5 && await fileMd5(downloaded.uri) !== md5) || (sizeBytes != null && downloaded.size !== sizeBytes)) {
      throw new MediaTransferError({ code: 'network', message: 'The attachment download was incomplete. Axonic will retry.', retryable: true, status: 0 });
    }
    downloaded.move(dest);
    return dest.uri;
  } catch (error) {
    throw new MediaTransferError(toMediaTransferFailure(error));
  } finally {
    try { if (partial.exists) partial.delete(); } catch { /* stale partial is overwritten on retry */ }
  }
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
