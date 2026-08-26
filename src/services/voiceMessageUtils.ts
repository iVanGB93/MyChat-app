/* ------------------------------------------------------------------ */
/*  Media Message Utils                                                 */
/*                                                                      */
/*  Helpers to persist recorded/picked media locally and to support     */
/*  legacy base64 messages that may still exist on older clients.       */
/*                                                                      */
/*  New media bytes upload through the HTTP media lane; Axion carries   */
/*  only a pointer. Each phone keeps a local copy for fast rendering.    */
/* ------------------------------------------------------------------ */

import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const VOICE_DIR_NAME = 'voice';
const IMAGES_DIR_NAME = 'images';

/** Longest edge (px) an outgoing photo is scaled down to before sending. */
const MAX_IMAGE_DIMENSION = 1600;
/** JPEG quality (0–1) for outgoing photos. */
const IMAGE_COMPRESS_QUALITY = 0.6;

/**
 * Downscale + re-encode a picked/captured photo before HTTP upload. This keeps
 * transfers fast and reduces storage and mobile-data use.
 * Returns a new local URI + mime; falls back to the original on any failure.
 */
export async function compressImageForSend(
  uri: string,
  width?: number | null,
  height?: number | null,
): Promise<{ uri: string; mime: string }> {
  try {
    const maxDim = Math.max(width ?? 0, height ?? 0);
    const actions =
      maxDim > MAX_IMAGE_DIMENSION
        ? [
            (width ?? 0) >= (height ?? 0)
              ? { resize: { width: MAX_IMAGE_DIMENSION } }
              : { resize: { height: MAX_IMAGE_DIMENSION } },
          ]
        : [];
    const result = await manipulateAsync(uri, actions, {
      compress: IMAGE_COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { uri: result.uri, mime: 'image/jpeg' };
  } catch (err) {
    console.warn('[media] image compression failed, sending original:', err);
    return { uri, mime: 'image/jpeg' };
  }
}

function cachedDir(name: string): Directory {
  const dir = new Directory(Paths.cache, name);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Pick a file extension matching the given audio MIME (best-effort). */
function extForAudioMime(mime: string | null | undefined): string {
  if (!mime) return 'm4a';
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('3gp')) return '3gp';
  return 'm4a';
}

/** Pick a file extension matching the given image MIME (best-effort). */
function extForImageMime(mime: string | null | undefined): string {
  if (!mime) return 'jpg';
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('heic')) return 'heic';
  return 'jpg';
}

/** Read a local file URI and return its base64 contents. */
export async function readFileAsBase64(fileUri: string): Promise<string> {
  const f = new File(fileUri);
  if (!f.exists) throw new Error(`File does not exist: ${fileUri}`);
  return await f.base64();
}

/** Alias kept for backwards compatibility with the voice-only path. */
export const readAudioAsBase64 = readFileAsBase64;

/**
 * Persist an incoming base64-encoded audio payload to a local file inside
 * the app's cache/voice/ directory. Returns the local file URI.
 */
export async function saveIncomingAudio(
  messageId: string,
  b64: string,
  mime?: string | null,
): Promise<string> {
  const dir = cachedDir(VOICE_DIR_NAME);
  const ext = extForAudioMime(mime);
  const f = new File(dir, `${messageId}.${ext}`);
  if (f.exists) return f.uri;
  f.create({ overwrite: false, intermediates: true });
  f.write(b64, { encoding: 'base64' });
  return f.uri;
}

/**
 * Persist an incoming base64-encoded image payload to a local file inside
 * the app's cache/images/ directory. Returns the local file URI.
 */
export async function saveIncomingImage(
  messageId: string,
  b64: string,
  mime?: string | null,
): Promise<string> {
  const dir = cachedDir(IMAGES_DIR_NAME);
  const ext = extForImageMime(mime);
  const f = new File(dir, `${messageId}.${ext}`);
  if (f.exists) return f.uri;
  f.create({ overwrite: false, intermediates: true });
  f.write(b64, { encoding: 'base64' });
  return f.uri;
}

/**
 * Copy an outgoing picked/captured image into our own cache so it survives
 * picker cleanup and is available for retries. Returns the persistent URI.
 */
export async function persistOutgoingImage(
  messageId: string,
  sourceUri: string,
  mime?: string | null,
): Promise<string> {
  const src = new File(sourceUri);
  if (!src.exists) throw new Error(`Source image does not exist: ${sourceUri}`);
  const dir = cachedDir(IMAGES_DIR_NAME);
  const ext = extForImageMime(mime) || (src.extension?.replace(/^\./, '') || 'jpg');
  const dest = new File(dir, `${messageId}.${ext}`);
  if (dest.exists) return dest.uri;
  src.copy(dest);
  return dest.uri;
}

/** Best-effort cleanup of a media file when a message is permanently deleted. */
export function deleteVoiceFile(fileUri: string | null | undefined): void {
  if (!fileUri) return;
  try {
    const f = new File(fileUri);
    if (f.exists) f.delete();
  } catch {
    /* ignore */
  }
}

/** Copy a shared video or document into Axonic-owned cache before Android
 * revokes the temporary content URI supplied by the system share sheet. */
export function persistSharedFile(messageId: string, sourceUri: string, filename?: string | null): string {
  const src = new File(sourceUri);
  if (!src.exists) throw new Error(`Shared file does not exist: ${sourceUri}`);
  const ext = filename?.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || src.extension?.replace(/^\./, '') || 'bin';
  const dir = cachedDir('shared');
  const dest = new File(dir, `${messageId}.${ext}`);
  if (!dest.exists) src.copy(dest);
  return dest.uri;
}

