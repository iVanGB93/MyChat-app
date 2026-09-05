/* ------------------------------------------------------------------ */
/*  Notification Background Dispatcher                                  */
/*                                                                      */
/*  Notifee allows exactly ONE `onBackgroundEvent` handler per app, so  */
/*  every feature that needs background notification events (incoming   */
/*  calls, message direct-reply) must funnel through this single        */
/*  registration. Registered once at the top level of `index.ts`.       */
/* ------------------------------------------------------------------ */

import notifee, { EventType } from '@notifee/react-native';

import { handleCallNotificationEvent } from './callNotificationService';
import { handleMessageReplyEvent } from './notificationReplyService';
import { handleMarkReadEvent } from './notificationActionService';
import { setPendingRoomNav } from './pendingRoomNav';
import { debugLog } from './diagnostics';

export function registerNotificationBackgroundHandler() {
  notifee.onBackgroundEvent(async (event) => {
    // Call accept/decline/press (synchronous, ignores non-call events).
    try {
      handleCallNotificationEvent(event);
    } catch (err) {
      console.warn('[BgEvent] call handler error:', err);
    }
    // Message "Reply" action (async HTTP relay; ignores non-reply events).
    try {
      await handleMessageReplyEvent(event);
    } catch (err) {
      console.warn('[BgEvent] reply handler error:', err);
    }
    // Message "Mark as read" action (ignores non-mark-read events).
    try {
      await handleMarkReadEvent(event);
    } catch (err) {
      console.warn('[BgEvent] mark-read handler error:', err);
    }
    // Plain PRESS on a message notification while backgrounded → stash the
    // target so the app navigates to the room when it comes to the foreground
    // (navigation can't run from this headless handler).
    try {
      const { type, detail } = event;
      const data = (detail.notification?.data ?? {}) as Record<string, any>;
      if (
        type === EventType.PRESS &&
        !detail.pressAction?.id?.match(/^(reply|mark_read)$/) &&
        data.type === 'new_message' &&
        data.roomId
      ) {
        debugLog('[BgEvent] message notification pressed → pending nav', data.roomId);
        await setPendingRoomNav({
          roomId: String(data.roomId),
          roomName: String(data.roomName ?? ''),
          senderId: data.senderId != null ? String(data.senderId) : undefined,
        });
      }
    } catch (err) {
      console.warn('[BgEvent] press-nav handler error:', err);
    }
  });
}
