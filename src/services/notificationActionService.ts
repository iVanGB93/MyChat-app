/* ------------------------------------------------------------------ */
/*  Notification Action Service — "Mark as read"                        */
/*                                                                      */
/*  Handles the "Mark as read" action on a chat-message notification:   */
/*    1. mark the room's received messages read locally,                */
/*    2. queue + send read receipts so the sender's ticks flip to ✓✓,   */
/*    3. clear the unread badge and dismiss the notification.           */
/*                                                                      */
/*  All cross-module imports are dynamic so this stays safe to call     */
/*  from the single Notifee background dispatcher (headless task) and    */
/*  the foreground handler alike.                                        */
/* ------------------------------------------------------------------ */

import { EventType, type Event } from '@notifee/react-native';

const MARK_READ_ACTION_ID = 'mark_read';

/**
 * Mark a room's conversation as read from a notification action and notify the
 * sender. Best-effort at every step so a failure in one part never blocks the
 * rest (e.g. the notification still gets dismissed even if the WS is down).
 *
 * `dismiss` (default true) cancels the notification afterwards. A reply passes
 * `dismiss: false` so the conversation notification (with the echoed reply)
 * stays visible while still sending read receipts + clearing the badge.
 */
export async function markRoomReadFromNotification(
  roomId: string,
  opts?: { dismiss?: boolean },
): Promise<void> {
  if (!roomId) return;
  const dismiss = opts?.dismiss ?? true;

  try {
    const { getUnreadReceivedIds } = await import('./localMessageStore');
    const ids = await getUnreadReceivedIds(roomId);
    if (ids.length > 0) {
      const chatWs = await import('./chatWsManager');
      // Marks the messages read locally, persists the read updates to the
      // outbox and applies them; sends immediately if Axion is connected.
      // Await durable persistence before this Android headless task is allowed
      // to finish; otherwise the notification disappears but the sender never
      // receives the read receipt.
      await chatWs.markRoomAsRead(roomId, ids);
      // Register the logical room so the queued read receipts flush now
      // (on auth_ok) instead of waiting for the user to open the chat. If the
      // app is fully killed this is best-effort; the outbox flushes on the next
      // connection regardless.
      try { await chatWs.connectRoom(roomId); } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn('[NotifMarkRead] mark read failed:', err);
  }

  // Clear the unread badge for the room.
  try {
    const { useAppStore } = await import('../store/appStore');
    useAppStore.getState().clearRoomUnread(roomId);
  } catch { /* store not ready */ }

  if (!dismiss) return;

  // The consolidated helper also removes any legacy Expo room card.
  try {
    const { cancelMessageNotification } = await import('./messageNotificationService');
    await cancelMessageNotification(roomId);
  } catch { /* ignore */ }
}

/**
 * Notifee event handler for the "Mark as read" action. Wired into the unified
 * background dispatcher (index.ts) and the foreground handler (App.tsx).
 * Returns true when it consumed the event.
 */
export async function handleMarkReadEvent(event: Event): Promise<boolean> {
  const { type, detail } = event;
  if (type !== EventType.ACTION_PRESS) return false;
  if (detail.pressAction?.id !== MARK_READ_ACTION_ID) return false;

  const data = (detail.notification?.data ?? {}) as Record<string, any>;
  const roomId = String(data.roomId ?? data.room_id ?? '');
  if (roomId) await markRoomReadFromNotification(roomId);
  return true;
}
