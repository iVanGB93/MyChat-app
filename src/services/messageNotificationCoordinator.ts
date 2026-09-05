/* ------------------------------------------------------------------ */
/* Durable incoming-message notification coordinator                  */
/*                                                                    */
/* Axion, FCM and Expo can all carry the same message. This module is  */
/* the single presentation gate: SQLite atomically chooses one path,  */
/* and remembers the decision after the Android card is dismissed.    */
/* ------------------------------------------------------------------ */

import type { IncomingMessageNotif } from './messageNotificationService';
import {
  claimMessageNotificationPresentation,
  finishMessageNotificationPresentation,
  recordMessageNotificationDisposition,
  type MessageNotificationState,
} from './localMessageStore';

const NOTIFICATION_ID_PREFIX = 'message:';
const MAX_NOTIFICATION_AGE_MS = 24 * 60 * 60 * 1000;

export type MessageNotificationSource = 'axion' | 'fcm' | 'expo_os';

export type MessageNotificationOutcome =
  | 'displayed'
  | 'duplicate'
  | 'suppressed'
  | 'failed'
  | 'invalid';

function identity(data: IncomingMessageNotif): { messageId: string; roomId: string } | null {
  const messageId = String(data.messageId ?? '').trim();
  const roomId = String(data.roomId ?? '').trim();
  return messageId && roomId ? { messageId, roomId } : null;
}

/** Record that another notification surface or policy already handled it. */
export async function recordIncomingMessageNotificationDisposition(
  data: IncomingMessageNotif,
  source: MessageNotificationSource,
  state: Extract<MessageNotificationState, 'suppressed' | 'covered_by_push'>,
  reason: string,
): Promise<boolean> {
  const id = identity(data);
  if (!id) return false;
  return recordMessageNotificationDisposition({
    ...id,
    state,
    reason,
    source,
    notificationId: NOTIFICATION_ID_PREFIX + id.roomId,
  });
}

/**
 * Display one incoming message at most once on this installation. The visible
 * Notifee card still keeps shownIds as a second line of defence, but SQLite is
 * authoritative because it survives dismissal and process death.
 */
export async function presentIncomingMessageNotification(
  data: IncomingMessageNotif,
  source: Exclude<MessageNotificationSource, 'expo_os'>,
): Promise<MessageNotificationOutcome> {
  const id = identity(data);
  if (!id) return 'invalid';

  const timestamp = Number(data.timestamp ?? 0);
  if (timestamp > 0 && timestamp < Date.now() - MAX_NOTIFICATION_AGE_MS) {
    await recordIncomingMessageNotificationDisposition(data, source, 'suppressed', 'stale_message');
    return 'suppressed';
  }

  const notificationId = NOTIFICATION_ID_PREFIX + id.roomId;
  const claimed = await claimMessageNotificationPresentation({
    ...id,
    source,
    notificationId,
  });
  if (!claimed) return 'duplicate';

  try {
    const { ensureMessageChannel, displayMessageNotification } = await import('./messageNotificationService');
    await ensureMessageChannel();
    await displayMessageNotification(data);
    await finishMessageNotificationPresentation({ messageId: id.messageId, displayed: true });
    return 'displayed';
  } catch (error) {
    await finishMessageNotificationPresentation({
      messageId: id.messageId,
      displayed: false,
      reason: String((error as any)?.message ?? error ?? 'notification_display_failed').slice(0, 240),
    }).catch(() => {});
    return 'failed';
  }
}

