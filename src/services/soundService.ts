/* ------------------------------------------------------------------ */
/*  Sound Service — load & play app sounds using expo-audio             */
/*                                                                       */
/*  All playback respects the device ringer mode:                       */
/*    silent  → no sound, no vibration                                  */
/*    vibrate → short vibration instead of one-shot sound; ringtones    */
/*              are skipped (callers handle the call-style vibration    */
/*              pattern themselves)                                      */
/*    normal  → play as usual                                           */
/* ------------------------------------------------------------------ */

import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { getRingerModeSync } from './ringerService';

type SoundName =
  | 'message_sent'
  | 'message_received'
  | 'ringtone'
  | 'ringback'
  | 'call_connect'
  | 'call_end';

/* eslint-disable @typescript-eslint/no-var-requires */
const SOUND_FILES: Record<SoundName, number> = {
  message_sent: require('../../assets/sounds/message_sent.wav'),
  message_received: require('../../assets/sounds/message_received.wav'),
  ringtone: require('../../assets/sounds/ringtone.mp3'),
  ringback: require('../../assets/sounds/ringback.wav'),
  call_connect: require('../../assets/sounds/call_connect.wav'),
  call_end: require('../../assets/sounds/call_end.wav'),
};

let loopingPlayer: AudioPlayer | null = null;
/**
 * Monotonic token to defeat the race where stopLooping() is called *while*
 * playLooping() is still awaiting ensureAudioMode(). Without this the new
 * player would be created after stopLooping ran, and the ringtone would
 * play forever with no reference held.
 */
let loopingToken = 0;

/** Pre-configure audio session for playback */
async function ensureAudioMode() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
  } catch { /* ignore */ }
}

/** Play a one-shot sound effect (non-looping). Respects ringer mode. */
export async function playSound(name: SoundName): Promise<void> {
  const mode = getRingerModeSync();
  if (mode === 'silent') return;
  if (mode === 'vibrate') {
    // Short blip so the user gets *some* feedback without audio.
    try { Vibration.vibrate(40); } catch { /* ignore */ }
    return;
  }
  try {
    await ensureAudioMode();
    const player = createAudioPlayer(SOUND_FILES[name]);
    player.play();
  } catch (err) {
    console.warn(`[SoundService] Failed to play ${name}:`, err);
  }
}

/** Start playing a sound in a loop (e.g. ringtone, ringback). Respects ringer mode. */
export async function playLooping(name: SoundName): Promise<void> {
  const mode = getRingerModeSync();
  // In silent/vibrate we never play audio. The caller is responsible
  // for vibrating in vibrate mode (so we don't double-vibrate when
  // both ringtone + vibration interval are running).
  if (mode !== 'normal') return;

  const myToken = ++loopingToken;
  try {
    await stopLooping();
    await ensureAudioMode();
    // If a stopLooping() happened during the awaits above, abandon this start.
    if (myToken !== loopingToken) return;
    const player = createAudioPlayer(SOUND_FILES[name]);
    player.loop = true;
    player.play();
    // Final race check — if stop landed between createAudioPlayer and now,
    // tear down immediately so we don't leak an orphan looping player.
    if (myToken !== loopingToken) {
      try { player.pause(); player.remove(); } catch { /* ignore */ }
      return;
    }
    loopingPlayer = player;
  } catch (err) {
    console.warn(`[SoundService] Failed to loop ${name}:`, err);
  }
}

/** Stop and release the currently looping sound */
export async function stopLooping(): Promise<void> {
  // Invalidate any in-flight playLooping() so it aborts before assigning.
  loopingToken++;
  if (loopingPlayer) {
    try {
      loopingPlayer.pause();
      loopingPlayer.remove();
    } catch { /* ignore */ }
    loopingPlayer = null;
  }
}
