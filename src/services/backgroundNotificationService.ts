/* ------------------------------------------------------------------ */
/*  Background Notification Service                                     */
/*  Polls the server for unread messages & incoming calls when the      */
/*  app is in the background or closed, and shows local notifications.  */
/* ------------------------------------------------------------------ */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import api, { getTokens } from './api';
import {
  showMessageNotification,
} from './pushNotificationService';
import { displayIncomingCallNotification } from './callNotificationService';

const TASK_NAME = 'BACKGROUND_NOTIFICATION_CHECK';

interface PendingMessage {
  room_id: string;
  room_name: string;
  sender: string;
  sender_id?: number;
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
      console.log('[BackgroundTask] No auth tokens, skipping');
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
          senderId: msg.sender_id ?? null,
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

    console.log(
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
      console.log('[BackgroundTask] Task registered successfully');
    } else {
      console.log('[BackgroundTask] Task already registered');
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
      console.log('[BackgroundTask] Task unregistered');
    }
  } catch (err) {
    console.warn('[BackgroundTask] Unregister failed:', err);
  }
}

/** Manually trigger a check (useful when app comes to foreground) */
export { checkPendingNotifications };

// Backward-compatible aliases for older imports.
export const registerBackgroundFetch = registerBackgroundTask;
export const unregisterBackgroundFetch = unregisterBackgroundTask;
