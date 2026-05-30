/* ------------------------------------------------------------------ */
/*  Push Notification Service — expo-notifications setup               */
/*  Registers for push tokens, configures channels,                    */
/*  and exposes helpers for local + incoming WS notifications          */
/* ------------------------------------------------------------------ */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 500, 500],
      lightColor: '#7C3AED',
      sound: 'default',
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
  if (!Device.isDevice) {
    console.log('[PushNotifications] Must use physical device for push');
    return null;
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

/* ---- Schedule a local notification (used for incoming WS events) ---- */
export async function showLocalNotification({
  title,
  body,
  data,
  channelId = 'messages',
}: {
  title: string;
  body: string;
  data?: Record<string, any>;
  channelId?: string;
}) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId } : {}),
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
export async function showMessageNotification({
  senderName,
  content,
  roomId,
  roomName,
}: {
  senderName: string;
  content: string;
  roomId: string;
  roomName: string;
}) {
  await showLocalNotification({
    title: senderName,
    body: content,
    data: { type: 'new_message', roomId, roomName },
    channelId: 'messages',
  });
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
