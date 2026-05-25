/* ------------------------------------------------------------------ */
/*  Sound Service — load & play app sounds using expo-audio             */
/* ------------------------------------------------------------------ */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

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
  ringtone: require('../../assets/sounds/ringtone.wav'),
  ringback: require('../../assets/sounds/ringback.wav'),
  call_connect: require('../../assets/sounds/call_connect.wav'),
  call_end: require('../../assets/sounds/call_end.wav'),
};

let loopingPlayer: AudioPlayer | null = null;

/** Pre-configure audio session for playback */
async function ensureAudioMode() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
  } catch { /* ignore */ }
}

/** Play a one-shot sound effect (non-looping) */
export async function playSound(name: SoundName): Promise<void> {
  try {
    await ensureAudioMode();
    const player = createAudioPlayer(SOUND_FILES[name]);
    player.play();
  } catch (err) {
    console.warn(`[SoundService] Failed to play ${name}:`, err);
  }
}

/** Start playing a sound in a loop (e.g. ringtone, ringback) */
export async function playLooping(name: SoundName): Promise<void> {
  try {
    await stopLooping();
    await ensureAudioMode();
    const player = createAudioPlayer(SOUND_FILES[name]);
    player.loop = true;
    player.play();
    loopingPlayer = player;
  } catch (err) {
    console.warn(`[SoundService] Failed to loop ${name}:`, err);
  }
}

/** Stop and release the currently looping sound */
export async function stopLooping(): Promise<void> {
  if (loopingPlayer) {
    try {
      loopingPlayer.pause();
      loopingPlayer.remove();
    } catch { /* ignore */ }
    loopingPlayer = null;
  }
}
