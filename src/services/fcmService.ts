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

import {
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  setBackgroundMessageHandler,
  registerDeviceForRemoteMessages,
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
      await registerDeviceForRemoteMessages(getMessaging());
    }
    const token = await getToken(getMessaging());
    if (token) console.log('[FCM] device token ready', `…${token.slice(-12)}`);
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
  return onTokenRefresh(getMessaging(), (token) => {
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

  // Incoming call: render the proper CallStyle notification (full-screen,
  // Accept/Decline, ringtone) so a killed/backgrounded call looks like a CALL,
  // not a plain message banner. Stable per-callId id dedupes with the WS path.
  if (data.type === 'incoming_call') {
    const callNav = {
      callId: String(data.callId ?? data.call_id ?? ''),
      callerId: Number(data.callerId ?? data.caller_id ?? 0),
      callerName: String(data.callerName ?? data.caller_name ?? 'Unknown'),
      callType: (data.callType === 'video' || data.call_type === 'video' ? 'video' : 'voice') as
        | 'voice'
        | 'video',
      roomName: String(data.roomName ?? data.room_name ?? ''),
    };
    try {
      // Stash the call so that when the full-screen intent launches (or wakes)
      // the app, App.tsx navigates straight to the full-screen IncomingCall
      // screen instead of leaving the user on a heads-up banner.
      const { setPendingCallNav } = await import('./pendingCallNav');
      setPendingCallNav(callNav);
    } catch { /* ignore */ }
    try {
      const { displayIncomingCallNotification } = await import('./callNotificationService');
      await displayIncomingCallNotification(callNav);
    } catch (err) {
      console.warn('[FCM] displayIncomingCallNotification failed:', err);
    }
    return;
  }

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
  setBackgroundMessageHandler(getMessaging(), handleDataMessage);
}

/**
 * Foreground data-message handler. Persists the message so the local DB stays
 * current; the in-app UI / notification policy handles on-screen display, so we
 * do not show a Notifee notification here to avoid duplicates. Returns an
 * unsubscribe function. Call from React after auth.
 */
export function registerFcmForegroundHandler(): () => void {
  return onMessage(getMessaging(), async (remoteMessage) => {
    const data = (remoteMessage?.data ?? {}) as Record<string, string>;
    if (!data || (data.type && data.type !== 'new_message')) return;
    try {
      await savePushMessage(data);
    } catch (err) {
      console.warn('[FCM] foreground savePushMessage failed:', err);
    }
  });
}
