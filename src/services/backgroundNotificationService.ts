/* ------------------------------------------------------------------ */
/*  Background Notification Service                                     */
/*  Polls the server for unread messages & incoming calls when the      */
/*  app is in the background or closed, and shows local notifications.  */
/* ------------------------------------------------------------------ */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import api, { getTokens } from './api';
import {
  showMessageNotification,
  showCallNotification,
} from './pushNotificationService';

const TASK_NAME = 'BACKGROUND_NOTIFICATION_CHECK';

interface PendingMessage {
  room_id: string;
  room_name: string;
  sender: string;
  content: string;
  created_at: string;
  id?: string; // available in newer API versions
}

interface PendingCall {
  call_id: string;
  caller: string;
  caller_id: number;
  call_type: 'voice' | 'video';
  room_name: string;
}

interface PendingNotifications {
  messages: PendingMessage[];
  calls: PendingCall[];
}

// Track which notifications we've already shown to avoid duplicates.
// Key: room_id  Value: composite deduplication key (id or created_at|sender|content-prefix)
// Using a composite key avoids false-skips when two messages share the same timestamp.
let lastNotifiedRoomKey = new Map<string, string>();
let lastShownCallIds = new Set<string>();

function makeMessageKey(msg: PendingMessage): string {
  // Prefer message ID when the API provides it; fall back to composite
  if (msg.id) return msg.id;
  return `${msg.created_at}|${msg.sender}|${msg.content.slice(0, 40)}`;
}

/**
 * Fetch pending notifications from the server and show local notifications.
 * Called both by the background task and can be called manually.
 */
async function checkPendingNotifications(): Promise<boolean> {
  try {
    const tokens = await getTokens();
    if (!tokens?.access) {
      console.log('[BackgroundFetch] No auth tokens, skipping');
      return false;
    }

    const { data } = await api.get<PendingNotifications>(
      '/api/users/notifications/pending/',
    );

    let hasNew = false;

    // Show notifications for unread messages (one per room, re-notify if
    // the deduplication key changed — i.e. a NEW message arrived).
    for (const msg of data.messages) {
      const key = makeMessageKey(msg);
      const prevKey = lastNotifiedRoomKey.get(msg.room_id);
      if (!prevKey || key !== prevKey) {
        await showMessageNotification({
          senderName: msg.sender,
          content: msg.content,
          roomId: msg.room_id,
          roomName: msg.room_name,
        });
        lastNotifiedRoomKey.set(msg.room_id, key);
        hasNew = true;
      }
    }

    // Clear rooms that no longer have unread messages
    const currentRoomIds = new Set(data.messages.map((m) => m.room_id));
    for (const key of lastNotifiedRoomKey.keys()) {
      if (!currentRoomIds.has(key)) {
        lastNotifiedRoomKey.delete(key);
      }
    }

    // Show notifications for incoming calls
    for (const call of data.calls) {
      if (!lastShownCallIds.has(call.call_id)) {
        await showCallNotification({
          callerName: call.caller,
          callType: call.call_type,
          callId: call.call_id,
          callerId: call.caller_id,
          roomName: call.room_name,
        });
        lastShownCallIds.add(call.call_id);
        hasNew = true;
      }
    }

    // Clear old call IDs
    const currentCallIds = new Set(data.calls.map((c) => c.call_id));
    lastShownCallIds = currentCallIds;

    console.log(
      `[BackgroundFetch] checked: ${data.messages.length} unread rooms, ${data.calls.length} calls, hasNew=${hasNew}`,
    );

    return hasNew;
  } catch (err) {
    console.warn('[BackgroundFetch] error:', err);
    return false;
  }
}

// ---- Define the background task ----
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const hasNew = await checkPendingNotifications();
    return hasNew
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register the background fetch task.
 * Should be called once when the app starts.
 */
export async function registerBackgroundFetch(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.warn('[BackgroundFetch] Background fetch is restricted/denied');
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 60, // Check every ~60 seconds (OS may throttle)
        stopOnTerminate: false, // Continue after app is closed
        startOnBoot: true, // Start after device reboot
      });
      console.log('[BackgroundFetch] Task registered successfully');
    } else {
      console.log('[BackgroundFetch] Task already registered');
    }
  } catch (err) {
    console.warn('[BackgroundFetch] Registration failed:', err);
  }
}

/**
 * Unregister the background fetch task (e.g. on logout).
 */
export async function unregisterBackgroundFetch(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
      console.log('[BackgroundFetch] Task unregistered');
    }
  } catch (err) {
    console.warn('[BackgroundFetch] Unregister failed:', err);
  }
}

/** Manually trigger a check (useful when app comes to foreground) */
export { checkPendingNotifications };
