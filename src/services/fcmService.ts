/* ------------------------------------------------------------------ */
/*  FCM Service — raw Firebase Cloud Messaging device token            */
/*                                                                      */
/*  Powers the WhatsApp-style background pipeline. The backend sends    */
/*  high-priority HYBRID FCM messages (a `notification` block so Google */
/*  Play Services draws the banner even when the app is fully killed,   */
/*  plus a `data` payload). When the app IS alive the handlers below    */
/*  persist the message + send the delivery ack; for pure data messages */
/*  they also render the banner via notifee. Distinct from the Expo     */
/*  push token.                                                         */
/* ------------------------------------------------------------------ */

import messaging, {
  type FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import { savePushMessage } from './pushMessageStore';
import {
  ensureMessageChannel,
  displayMessageNotification,
  parseMessageNotifData,
} from './messageNotificationService';

/**
 * Ensure the device is registered for remote messages and return its raw FCM
 * token. Returns null on failure (e.g. Play Services unavailable) so callers
 * can fall back to the Expo push token without throwing.
 */
export async function getFcmToken(): Promise<string | null> {
  try {
    // iOS needs explicit registration before a token is available; on Android
    // this is a no-op but safe to call.
    if (Platform.OS === 'ios') {
      await messaging().registerDeviceForRemoteMessages();
    }
    const token = await messaging().getToken();
    return token || null;
  } catch (err) {
    console.warn('[FCM] failed to get token:', err);
    return null;
  }
}

/**
 * Subscribe to FCM token refreshes. The callback receives the new token so the
 * caller can re-register it with the backend. Returns an unsubscribe function.
 */
export function onFcmTokenRefresh(cb: (token: string) => void): () => void {
  return messaging().onTokenRefresh((token) => {
    if (token) cb(token);
  });
}

/**
 * Shared handling for an FCM message carrying a chat message:
 *   1. persist it to SQLite + send the delivery ack (via the central ingress
 *      router) — runs whenever this handler fires;
 *   2. render the WhatsApp-style MessagingStyle notification, but ONLY for a
 *      pure data message. When the message carries a `notification` block the
 *      banner is drawn by Google Play Services itself (this is what lets a
 *      fully-killed app show a notification without starting its process), so
 *      drawing our own here would produce a DUPLICATE.
 */
async function handleDataMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
  const data = (remoteMessage?.data ?? {}) as Record<string, string>;
  if (!data || (data.type && data.type !== 'new_message')) return;
  // Persist + ack first so the delivered receipt fires regardless of whether
  // the notification renders.
  try {
    await savePushMessage(data);
  } catch (err) {
    console.warn('[FCM] savePushMessage failed:', err);
  }
  // GPS already drew the banner for notification-block messages — don't double it.
  if (remoteMessage?.notification) return;
  try {
    const parsed = parseMessageNotifData(data);
    if (parsed) {
      await ensureMessageChannel();
      await displayMessageNotification(parsed);
    }
  } catch (err) {
    console.warn('[FCM] displayMessageNotification failed:', err);
  }
}

/**
 * Register the background data-message handler. MUST be called at the module
 * top-level of `index.ts` (outside React) so it fires when the app is killed.
 */
export function registerFcmBackgroundHandler(): void {
  messaging().setBackgroundMessageHandler(handleDataMessage);
}

/**
 * Foreground data-message handler. Persists the message so the local DB stays
 * current; the in-app UI / notification policy handles on-screen display, so we
 * do not show a Notifee notification here to avoid duplicates. Returns an
 * unsubscribe function. Call from React after auth.
 */
export function registerFcmForegroundHandler(): () => void {
  return messaging().onMessage(async (remoteMessage) => {
    const data = (remoteMessage?.data ?? {}) as Record<string, string>;
    if (!data || (data.type && data.type !== 'new_message')) return;
    try {
      await savePushMessage(data);
    } catch (err) {
      console.warn('[FCM] foreground savePushMessage failed:', err);
    }
  });
}
