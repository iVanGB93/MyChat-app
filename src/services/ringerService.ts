/* ------------------------------------------------------------------ */
/*  ringerService — exposes the device ringer state to the rest of    */
/*  the app so we can mute / vibrate sounds when the user has flipped */
/*  their phone to silent or vibrate.                                  */
/*                                                                     */
/*  Android: react-native-volume-manager wraps `AudioManager.          */
/*    getRingerMode()` which gives us silent / vibrate / normal.       */
/*  iOS:     `addSilentListener` reports the hardware mute switch.     */
/*           iOS has no public API for vibrate-only, so we model it    */
/*           as silent vs normal.                                      */
/* ------------------------------------------------------------------ */

import { Platform } from 'react-native';
import {
  VolumeManager,
  RINGER_MODE,
  type RingerSilentStatus,
} from 'react-native-volume-manager';

export type RingerMode = 'silent' | 'vibrate' | 'normal';

// Cached so callers don't need to await on every play call. We hydrate
// the cache at startup (startRingerModeListener) and update it on every
// system event \u2014 in practice reads are always live within a few ms.
let cachedMode: RingerMode = 'normal';
let started = false;
let removeListener: (() => void) | null = null;

function fromAndroidEvent(event: RingerSilentStatus | undefined): RingerMode {
  if (!event) return cachedMode;
  // Library reports Mode.SILENT|VIBRATE|NORMAL|MUTED on the event.
  switch (event.mode) {
    case 'SILENT':
    case 'MUTED':
      return 'silent';
    case 'VIBRATE':
      return 'vibrate';
    case 'NORMAL':
    default:
      return 'normal';
  }
}

async function refreshFromSystem(): Promise<RingerMode> {
  try {
    if (Platform.OS === 'android') {
      const raw = await VolumeManager.getRingerMode();
      if (raw === RINGER_MODE.silent) cachedMode = 'silent';
      else if (raw === RINGER_MODE.vibrate) cachedMode = 'vibrate';
      else cachedMode = 'normal';
    } else if (Platform.OS === 'ios') {
      // iOS doesn't expose a synchronous getter; the value gets
      // populated by addSilentListener as soon as the switch changes
      // (or after the first call). Leave cache as-is on first read.
    }
  } catch {
    /* swallow \u2014 worst case we play sound when we shouldn't */
  }
  return cachedMode;
}

/** Synchronous getter for the last-known ringer mode. */
export function getRingerModeSync(): RingerMode {
  return cachedMode;
}

/** Async refresh-then-return; useful for forced re-reads. */
export async function getRingerMode(): Promise<RingerMode> {
  return refreshFromSystem();
}

/**
 * Begin listening to ringer / mute-switch changes. Idempotent.
 * Call once from app bootstrap (e.g. AppNavigator or App.tsx).
 */
export function startRingerModeListener(): void {
  if (started) return;
  started = true;

  // Prime the cache with the current value.
  refreshFromSystem();

  if (Platform.OS === 'android') {
    const sub = VolumeManager.addRingerListener((event) => {
      cachedMode = fromAndroidEvent(event);
    });
    removeListener = () => {
      try { VolumeManager.removeRingerListener(sub); } catch { /* noop */ }
    };
  } else if (Platform.OS === 'ios') {
    const sub = VolumeManager.addSilentListener((event) => {
      // iOS event shape: { isMuted: boolean, initialQuery?: boolean }
      cachedMode = event.isMuted ? 'silent' : 'normal';
    });
    removeListener = () => {
      try { sub.remove(); } catch { /* noop */ }
    };
  }
}

/** Stop the listener. Currently unused, here for symmetry / hot-reload. */
export function stopRingerModeListener(): void {
  if (removeListener) removeListener();
  removeListener = null;
  started = false;
}
