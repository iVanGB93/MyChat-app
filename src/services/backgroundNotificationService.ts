/* ------------------------------------------------------------------ */
/*  Background Notification Service                                     */
/*  Polls the server for unread messages & incoming calls when the      */
/*  app is in the background or closed, and shows local notifications.  */
/* ------------------------------------------------------------------ */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import api, { getTokens } from './api';
import { displayIncomingCallNotification } from './callNotificationService';
import { useAppStore } from '../store/appStore';
import { flushPendingAcks as flushHttpAckRetryQueue } from './messageAckRetryQueue';
import { debugLog } from './diagnostics';

const TASK_NAME = 'BACKGROUND_NOTIFICATION_CHECK';
const PUSH_RECEIVE_TASK = 'PUSH_NOTIFICATION_RECEIVE';

interface PendingMessage {
  room_id: string;
  room_name: string;
  sender: string;
  sender_id?: number;
  content: string;
  created_at: string;
  id?: string; // available in newer API versions
  correlation_id?: string;
  route_reason?: string;
}

interface PendingCall {
  call_id: string;
  caller: string;
  caller_id: number;
  call_type: 'voice' | 'video';
  room_name: string;
  correlation_id?: string;
  route_reason?: string;
}

interface PendingNotifications {
  messages: PendingMessage[];
  calls: PendingCall[];
}

// Track which call notifications we've already shown to avoid duplicates.
let lastShownCallIds = new Set<string>();

/**
 * Fetch pending notifications from the server and show local notifications.
 * Called both by the background task and can be called manually.
 */
async function checkPendingNotifications(): Promise<boolean> {
  try {
    const tokens = await getTokens();
    if (!tokens?.access) {
      debugLog('[BackgroundTask] No auth tokens, skipping');
      return false;
    }

    const { data } = await api.get<PendingNotifications>(
      '/api/users/notifications/pending/',
    );

    let hasNew = false;

    // NOTE: We intentionally do NOT show local notifications for unread
    // messages here. The backend is a WS relay with no stored content, so this
    // endpoint can only return a generic "New messages waiting" placeholder —
    // showing that would overwrite the real per-conversation notification (from
    // the Expo push / WS path) with text-less noise. Real message notifications
    // come from the push (killed app) or the notification-WS path (alive app).
    void data.messages;

    // Show notifications for incoming calls
    for (const call of data.calls) {
      const active = useAppStore.getState().activeCall;
      const alreadyInThisCall = !!active && active.callId === call.call_id && active.state !== 'ended';
      const callInProgress = !!active && (active.state === 'connecting' || active.state === 'connected');
      if (alreadyInThisCall || callInProgress) {
        continue;
      }
      if (!lastShownCallIds.has(call.call_id)) {
        debugLog('[BackgroundTask] local_call', {
          call_id: call.call_id,
          correlation_id: call.correlation_id ?? '',
          route_reason: call.route_reason ?? '',
        });
        await displayIncomingCallNotification({
          callId: call.call_id,
          callerId: call.caller_id,
          callerName: call.caller,
          callType: call.call_type,
          roomName: call.room_name,
        });
        lastShownCallIds.add(call.call_id);
        hasNew = true;
      }
    }

    // Clear old call IDs
    const currentCallIds = new Set(data.calls.map((c) => c.call_id));
    lastShownCallIds = currentCallIds;

    debugLog(
      `[BackgroundTask] checked: ${data.messages.length} unread rooms, ${data.calls.length} calls, hasNew=${hasNew}`,
    );

    return hasNew;
  } catch (err) {
    console.warn('[BackgroundTask] error:', err);
    return false;
  }
}

// ---- Define the background task ----
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await checkPendingNotifications();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Register the background task.
 * Should be called once when the app starts.
 */
export async function registerBackgroundTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      console.warn('[BackgroundTask] Background task API is restricted');
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundTask.registerTaskAsync(TASK_NAME, {
        // Interval is in MINUTES for expo-background-task.
        minimumInterval: 15,
      });
      debugLog('[BackgroundTask] Task registered successfully');
    } else {
      debugLog('[BackgroundTask] Task already registered');
    }
  } catch (err) {
    console.warn('[BackgroundTask] Registration failed:', err);
  }
}

/**
 * Unregister the background task (e.g. on logout).
 */
export async function unregisterBackgroundTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (isRegistered) {
      await BackgroundTask.unregisterTaskAsync(TASK_NAME);
      debugLog('[BackgroundTask] Task unregistered');
    }
  } catch (err) {
    console.warn('[BackgroundTask] Unregister failed:', err);
  }
}

/** Manually trigger a check (useful when app comes to foreground) */
export { checkPendingNotifications };

// ---- Background push-receive task -------------------------------------------
// Registered with Expo Notifications so it fires immediately when FCM delivers
// a push, even when the app is completely killed.  The message is saved to
// SQLite right away — the user gets the content whether they tap the
// notification, dismiss it, or never see it at all.
TaskManager.defineTask(PUSH_RECEIVE_TASK, async ({ data, error }: { data: any; error: any }) => {
  if (error) {
    console.warn('[PushReceiveTask] error:', error);
    return;
  }
  try {
    const notification: Notifications.Notification | undefined = data?.notification;
    const pushData = notification?.request?.content?.data as Record<string, string> | undefined;
    if (pushData?.type === 'new_message') {
      const { savePushMessage } = await import('./pushMessageStore');
      await savePushMessage(pushData);
      // After saving, try to flush any pending ACK retries (over HTTP or WS)
      flushHttpAckRetryQueue().catch(() => {});
    }
  } catch (err) {
    console.warn('[PushReceiveTask] failed to save message:', err);
  }
});

export async function registerPushReceiveTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(PUSH_RECEIVE_TASK);
    debugLog('[PushReceiveTask] registered');
  } catch (err) {
    // Fails silently on platforms that don\'t support it (web, old SDK)
    console.warn('[PushReceiveTask] registration failed (may not be supported):', err);
  }
}

export async function unregisterPushReceiveTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(PUSH_RECEIVE_TASK);
    if (isRegistered) {
      await Notifications.unregisterTaskAsync(PUSH_RECEIVE_TASK);
      debugLog('[PushReceiveTask] unregistered');
    }
  } catch (err) {
    console.warn('[PushReceiveTask] unregister failed:', err);
  }
}

// Backward-compatible aliases for older imports.
export const registerBackgroundFetch = registerBackgroundTask;
export const unregisterBackgroundFetch = unregisterBackgroundTask;
