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
import { debugLog } from './diagnostics';
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
    debugLog('[PushNotifications] Non-physical device — attempting push registration anyway (emulator FCM)');
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

    debugLog('[PushNotifications] Expo push token ready', `…${tokenData.data.slice(-12)}`);
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
