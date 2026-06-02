/* ------------------------------------------------------------------ */
/*  Call Notification Service — Notifee (Android CallStyle + iOS)      */
/*                                                                      */
/*  Replaces `expo-notifications` for the *incoming-call* notification  */
/*  so we get a real call notification experience:                      */
/*    - Android: CallStyle layout, full-screen intent (lockscreen       */
/*      takeover), Accept / Decline action buttons, ongoing/persistent  */
/*      until answered, custom ringtone, MAX importance.                */
/*    - iOS: time-sensitive interruption level, Accept / Decline action */
/*      buttons via notification category, custom sound. Apple does not */
/*      allow full-screen takeover from third-party apps — for that we  */
/*      would need CallKit + PushKit (planned for later).               */
/*                                                                      */
/*  Action events (Accept / Decline) are dispatched through `actionBus` */
/*  so app-level code can react (join / reject the call, navigate, …)   */
/* ------------------------------------------------------------------ */

import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
  type Event,
} from '@notifee/react-native';
import { Platform } from 'react-native';

const CHANNEL_ID = 'incoming-calls';
const NOTIFICATION_ID_PREFIX = 'incoming-call:';

const ACTION_ACCEPT = 'accept';
const ACTION_DECLINE = 'decline';
const IOS_CATEGORY_ID = 'incoming-call';

export interface IncomingCallData {
  callId: string;
  callerId: number;
  callerName: string;
  callType: 'voice' | 'video';
  roomName: string;
}

export type CallActionType = 'accept' | 'decline' | 'press';

export interface CallAction {
  type: CallActionType;
  data: IncomingCallData;
}

type Listener = (action: CallAction) => void;
const listeners = new Set<Listener>();

/** Subscribe to Accept / Decline / Press events from call notifications. */
export function subscribeCallActions(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(action: CallAction) {
  listeners.forEach((fn) => {
    try { fn(action); } catch (err) { console.warn('[CallNotif] listener error:', err); }
  });
}

function parseData(raw: Record<string, any> | undefined): IncomingCallData | null {
  if (!raw || !raw.callId) return null;
  return {
    callId: String(raw.callId),
    callerId: Number(raw.callerId ?? 0),
    callerName: String(raw.callerName ?? 'Unknown'),
    callType: (raw.callType === 'video' ? 'video' : 'voice'),
    roomName: String(raw.roomName ?? ''),
  };
}

function handleEvent({ type, detail }: Event) {
  // Notifee fires the same set of events for both foreground and background
  // dispatchers, so we centralise the parsing/dispatch logic here.
  if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;
  const data = parseData(detail.notification?.data as any);
  if (!data) return;

  if (type === EventType.PRESS) {
    emit({ type: 'press', data });
    return;
  }

  const actionId = detail.pressAction?.id;
  if (actionId === ACTION_ACCEPT) emit({ type: 'accept', data });
  else if (actionId === ACTION_DECLINE) emit({ type: 'decline', data });
}

/**
 * Register foreground + background event listeners. Must be called once on
 * app startup (foreground) and once at the module top-level of `index.ts`
 * (background — see Notifee docs).
 */
export function registerCallNotificationListeners() {
  notifee.onForegroundEvent(handleEvent);
}

/** Background-event registration. Call from `index.ts` *outside* React. */
export function registerCallNotificationBackgroundHandler() {
  notifee.onBackgroundEvent(async (event) => {
    handleEvent(event);
  });
}

/**
 * Create the high-importance Android channel used for call notifications.
 * Safe to call multiple times — Android dedupes by channel id.
 */
export async function ensureCallChannel() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Incoming Calls',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'ringtone', // resolves to res/raw/ringtone.mp3 (bundled in /assets/sounds)
    vibration: true,
    vibrationPattern: [300, 500, 300, 500],
    bypassDnd: true,
  });
}

/** Register the iOS notification category with Accept / Decline buttons. */
export async function ensureIosCallCategory() {
  if (Platform.OS !== 'ios') return;
  await notifee.setNotificationCategories([
    {
      id: IOS_CATEGORY_ID,
      actions: [
        { id: ACTION_DECLINE, title: 'Decline', destructive: true },
        { id: ACTION_ACCEPT, title: 'Accept', foreground: true },
      ],
    },
  ]);
}

/** Request notification permission (no-op if already granted). */
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission({
    criticalAlert: false, // requires Apple entitlement; we use time-sensitive instead
  });
  return (
    settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
  );
}

/** One-shot setup — call once on app boot after auth. */
export async function setupCallNotifications() {
  await requestNotificationPermission();
  await ensureCallChannel();
  await ensureIosCallCategory();
  registerCallNotificationListeners();
}

/**
 * Display a CallStyle (Android) / category notification (iOS) for an
 * incoming call. Safe to call repeatedly with the same `callId` — the
 * notification is updated in-place.
 */
export async function displayIncomingCallNotification(data: IncomingCallData) {
  const notifId = NOTIFICATION_ID_PREFIX + data.callId;
  const title = data.callerName;
  const body = `Incoming ${data.callType} call`;

  await notifee.displayNotification({
    id: notifId,
    title,
    body,
    data: data as unknown as Record<string, string>,
    android: {
      channelId: CHANNEL_ID,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      ongoing: true,
      autoCancel: false,
      smallIcon: 'ic_launcher',
      // Wake the screen and route to the app when the user taps the body.
      pressAction: { id: 'default', launchActivity: 'default' },
      // Full-screen takeover on locked devices. Requires
      // USE_FULL_SCREEN_INTENT (Android 14+) which we added to app.json.
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: 'Decline',
          pressAction: { id: ACTION_DECLINE },
        },
        {
          title: 'Accept',
          pressAction: { id: ACTION_ACCEPT, launchActivity: 'default' },
        },
      ],
      // Loop the ringtone for the entire notification lifetime instead of
      // the brief default one-shot.
      loopSound: true,
    },
    ios: {
      categoryId: IOS_CATEGORY_ID,
      sound: 'ringtone.mp3',
      // Time-sensitive bypasses Focus / Do Not Disturb when the user has
      // allowed it for the app. Critical alerts would always bypass DND but
      // need a special Apple entitlement.
      interruptionLevel: 'timeSensitive',
    },
  });
}

/** Cancel the incoming-call notification for a given callId (or all). */
export async function cancelIncomingCallNotification(callId?: string) {
  if (callId) {
    await notifee.cancelNotification(NOTIFICATION_ID_PREFIX + callId);
  } else {
    // Cancel everything in the calls channel.
    const displayed = await notifee.getDisplayedNotifications();
    await Promise.all(
      displayed
        .filter((d) => d.id?.startsWith(NOTIFICATION_ID_PREFIX))
        .map((d) => notifee.cancelNotification(d.id!)),
    );
  }
}
