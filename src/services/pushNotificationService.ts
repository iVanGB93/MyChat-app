/* ------------------------------------------------------------------ */
/*  Push Notification Service — expo-notifications setup               */
/*  Registers for push tokens, configures channels,                    */
/*  and exposes helpers for local + incoming WS notifications          */
/* ------------------------------------------------------------------ */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getFcmToken } from './fcmService';
import { getInstallationId } from './installationIdentity';
export { getInstallationId } from './installationIdentity';

export type PushRegistrationPayload = {
  token: string;
  fcm_token?: string;
  installation_id: string;
  platform: 'android' | 'ios' | 'web' | 'unknown';
  device_name: string;
  app_version: string;
};

/* ---- Default notification handler (show when app is foreground) ---- */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/* ---- Android notification channels ---- */
export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
    });

    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 500, 500],
      lightColor: '#7C3AED',
    });

    await Notifications.setNotificationChannelAsync('general', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#7C3AED',
    });
  }
}

/* ---- Register for push notifications ---- */
export async function registerForPushNotifications(): Promise<string | null> {
  // NOTE (emulator testing): we intentionally allow non-physical devices here.
  // Google Play system images (e.g. sdk_gphone64) can receive FCM pushes, so we
  // attempt token registration anyway. getExpoPushTokenAsync() below is wrapped
  // in try/catch and fails gracefully on images without FCM support.
  // TODO: restore the strict guard if emulator push tokens cause issues:
  //   if (!Device.isDevice) {
  //     console.log('[PushNotifications] Must use physical device for push');
  //     return null;
  //   }
  if (!Device.isDevice) {
    console.log('[PushNotifications] Non-physical device — attempting push registration anyway (emulator FCM)');
  }

  // Check / request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[PushNotifications] Permission not granted');
    return null;
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
      ?? Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    console.log('[PushNotifications] Expo push token:', tokenData.data);
    return tokenData.data;
  } catch (error) {
    console.warn('[PushNotifications] Failed to get push token:', error);
    return null;
  }
}

export async function getPushRegistrationPayload(): Promise<PushRegistrationPayload | null> {
  const token = await registerForPushNotifications();
  // Raw FCM token powers the WhatsApp-style background data pipeline. It can
  // succeed even when the Expo token does not (and vice-versa), so fetch it
  // independently and register whichever token(s) we obtained.
  const fcm_token = await getFcmToken();
  if (!token && !fcm_token) return null;

  const installation_id = await getInstallationId();
  const platform = Platform.OS === 'android'
    ? 'android'
    : Platform.OS === 'ios'
      ? 'ios'
      : Platform.OS === 'web'
        ? 'web'
        : 'unknown';

  return {
    token: token ?? '',
    fcm_token: fcm_token ?? undefined,
    installation_id,
    platform,
    device_name: Device.deviceName ?? `${Device.brand ?? 'Unknown'} ${Device.modelName ?? ''}`.trim(),
    app_version: Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '',
  };
}

/* ---- Schedule a local notification (used for incoming WS events) ---- */
export async function showLocalNotification({
  title,
  body,
  data,
  channelId = 'messages',
  identifier,
  groupKey,
  isGroupSummary = false,
}: {
  title: string;
  body: string;
  data?: Record<string, any>;
  channelId?: string;
  /** Stable id so repeated calls update an existing notification instead of stacking. */
  identifier?: string;
  /** Android grouping key. Notifications sharing a key collapse into one entry. */
  groupKey?: string;
  /** Marks the group summary notification on Android. */
  isGroupSummary?: boolean;
}) {
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title,
      body,
      data: data ?? {},
      sound: 'default',
      ...(Platform.OS === 'android'
        ? {
            channelId,
            ...(groupKey ? { groupKey } : {}),
            ...(isGroupSummary ? { groupSummary: true } : {}),
          }
        : {}),
    },
    trigger: null, // immediate
  });
}

/* ---- Show call notification ---- */
export async function showCallNotification({
  callerName,
  callType,
  callId,
  callerId,
  roomName,
}: {
  callerName: string;
  callType: 'voice' | 'video';
  callId: string;
  callerId: number;
  roomName: string;
}) {
  const icon = callType === 'video' ? '📹' : '📞';
  await showLocalNotification({
    title: `${icon} Incoming ${callType} call`,
    body: `${callerName} is calling you`,
    data: { type: 'incoming_call', callId, callerName, callType, callerId, roomName },
    channelId: 'calls',
  });
}

/* ---- Show message notification ---- */
//
// Each notification gets a unique sender+timestamp identifier so messages from
// the same sender stack as separate entries in the tray. Different senders are
// naturally separated by their name in the notification title.
// iOS groups by threadIdentifier (sender-based); Android stacks per channel.
/**
 * Per-conversation notification accumulator (in-memory).
 *
 * WhatsApp-style grouping: instead of stacking one OS notification per message,
 * we keep a SINGLE notification per room and update it in place. We remember the
 * recent message lines + a running unread count so the collapsed notification
 * shows the latest message and the count, while the expanded ("dropdown") view
 * shows the last few messages.
 *
 * Reset via `dismissRoomNotification(roomId)` when the user opens/reads the room.
 */
type RoomNotifState = { count: number; lines: string[]; roomName: string; seen: Set<string> };
const _roomNotifState = new Map<string, RoomNotifState>();
const MAX_NOTIF_LINES = 6;
const MAX_SEEN_IDS = 50;

/** Stable identifier so repeated messages update one notification per room. */
function roomNotificationId(roomId: string): string {
  return `msg-room-${roomId || 'unknown'}`;
}

export async function showMessageNotification({
  senderName,
  senderId,
  content,
  roomId,
  roomName,
  messageId,
}: {
  senderName: string;
  senderId?: number | null;
  content: string;
  roomId: string;
  roomName: string;
  /** When provided, prevents double-counting if the same message is delivered
   *  via more than one path (e.g. WS + push). */
  messageId?: string | null;
}) {
  const safeRoomId = roomId || 'unknown';
  const data: Record<string, string> = { type: 'new_message', roomId, roomName };
  if (senderId != null) data.senderId = String(senderId);

  const displayRoomName = roomName || senderName;

  // Accumulate this message into the room's notification state.
  const prev = _roomNotifState.get(safeRoomId)
    ?? { count: 0, lines: [], roomName: displayRoomName, seen: new Set<string>() };

  // Skip if we've already shown this exact message (deduplicate across paths).
  if (messageId) {
    if (prev.seen.has(messageId)) return;
    prev.seen.add(messageId);
    if (prev.seen.size > MAX_SEEN_IDS) {
      // Trim oldest entries to bound memory.
      const trimmed = Array.from(prev.seen).slice(-MAX_SEEN_IDS);
      prev.seen = new Set(trimmed);
    }
  }

  // In a group chat the room name differs from the sender — prefix the line so
  // the dropdown shows who said what (WhatsApp style). For 1:1 chats the names
  // match, so we keep the line clean.
  const isGroup = displayRoomName !== senderName;
  const line = isGroup ? `${senderName}: ${content}` : content;
  // Keep chronological order in the expanded notification so each message
  // appears on its own line and the newest message is at the bottom.
  const lines = [...prev.lines, line].slice(-MAX_NOTIF_LINES);
  const count = prev.count + 1;
  _roomNotifState.set(safeRoomId, { count, lines, roomName: displayRoomName, seen: prev.seen });

  // Title carries the conversation name + unread count (e.g. "Alice (3)").
  const title = count > 1 ? `${displayRoomName} (${count})` : displayRoomName;
  // Body: latest message collapsed; full recent list when expanded. The blank
  // line between messages uses a non-breaking space (U+00A0) so Android doesn't
  // collapse it.
  const body = lines.join('\n\u00A0\n');

  await showLocalNotification({
    title,
    body,
    data,
    channelId: 'messages',
    // Stable id → updates the SAME notification instead of stacking.
    identifier: roomNotificationId(safeRoomId),
  });
}

/**
 * Clear the grouped notification for a room (call when the user opens/reads it)
 * and reset its accumulator so the next message starts a fresh count.
 */
export async function dismissRoomNotification(roomId: string) {
  const safeRoomId = roomId || 'unknown';
  _roomNotifState.delete(safeRoomId);
  try {
    await Notifications.dismissNotificationAsync(roomNotificationId(safeRoomId));
  } catch { /* notification may already be gone */ }
}

/* ---- Get badge count ---- */
export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}

/* ---- Cancel all notifications ---- */
export async function cancelAllNotifications() {
  await Notifications.dismissAllNotificationsAsync();
}

/* ---- Listeners (for navigation on tap in App.tsx) ---- */
export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void,
) {
  return Notifications.addNotificationReceivedListener(handler);
}
