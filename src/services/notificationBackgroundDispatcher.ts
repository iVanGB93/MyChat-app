/* ------------------------------------------------------------------ */
/*  Notification Background Dispatcher                                  */
/*                                                                      */
/*  Notifee allows exactly ONE `onBackgroundEvent` handler per app, so  */
/*  every feature that needs background notification events (incoming   */
/*  calls, message direct-reply) must funnel through this single        */
/*  registration. Registered once at the top level of `index.ts`.       */
/* ------------------------------------------------------------------ */

import notifee from '@notifee/react-native';

import { handleCallNotificationEvent } from './callNotificationService';
import { handleMessageReplyEvent } from './notificationReplyService';

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
  });
}
