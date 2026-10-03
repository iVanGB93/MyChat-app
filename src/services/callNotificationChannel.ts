import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { Platform } from 'react-native';
const CHANNEL_ID='incoming-calls-v2';

export async function ensureCallChannel() {
  if (Platform.OS !== 'android') return;
  // Remove the pre-v2 channel so upgraded users don't see two "Incoming Calls"
  // entries in system settings (the old one may be stuck at a lower importance).
  await notifee.deleteChannel('incoming-calls').catch(() => {});
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Incoming Calls',
    importance: AndroidImportance.HIGH, // highest Notifee level; triggers heads-up display
    visibility: AndroidVisibility.PUBLIC,
    sound: 'ringtone', // resolves to res/raw/ringtone.mp3 (bundled in /assets/sounds)
    vibration: true,
    // Phone ring-like pattern: 1s on, 0.5s off, 1s on, 0.5s off
    vibrationPattern: [1000, 500, 1000, 500],
    bypassDnd: true,
    lightColor: '#FF0000', // Red LED light for call urgency
  });
}

