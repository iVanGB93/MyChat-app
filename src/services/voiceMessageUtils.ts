/* ------------------------------------------------------------------ */
/*  Media Message Utils                                                 */
/*                                                                      */
/*  Helpers to read recorded/picked local files as base64 (for          */
/*  sending over the chat WS) and to materialize an incoming base64     */
/*  payload back into a local file so the receiver can play/view it.    */
/*                                                                      */
/*  Media bytes never touch the server's storage: the backend is a      */
/*  dumb relay, the bytes ride in the WS frame as base64, both sides    */
/*  keep their own copy on disk under cache/voice/ or cache/images/.    */
/* ------------------------------------------------------------------ */

import { Directory, File, Paths } from 'expo-file-system';

const VOICE_DIR_NAME = 'voice';
const IMAGES_DIR_NAME = 'images';

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

