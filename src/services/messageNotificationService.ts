/* ------------------------------------------------------------------ */
/*  Message Notification Service — Notifee (Android MessagingStyle)    */
/*                                                                      */
/*  Renders chat-message notifications from the FCM background data     */
/*  handler so they display the WhatsApp-style conversation layout      */
/*  (sender name + stacked messages) even when the app is killed.       */
/*  One notification per room (stable id) so new messages accumulate    */
/*  into the same conversation instead of stacking separate entries.    */
/* ------------------------------------------------------------------ */

import notifee, {
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { resolveMediaUrl } from './api';

const CHANNEL_ID = 'messages';
const NOTIFICATION_ID_PREFIX = 'message:';

export interface IncomingMessageNotif {
  roomId: string;
  roomName: string;
  senderName: string;
  /** User id of the message sender (the reply recipient), if known. */
  senderId?: number;
  /** Message id — used to dedupe when the same message is delivered via more
   *  than one path (WS + FCM) or FCM delivers a duplicate. */
  messageId?: string;
  /** Absolute URL of the sender's avatar, shown as the notification's large
   *  (person) icon. Omitted → Android shows a generated monogram. */
  avatar?: string | null;
  text: string;
  /** Epoch millis for the message; defaults to now. */
  timestamp?: number;
  /** When true the message is rendered as sent by the local user (outgoing). */
  fromMe?: boolean;
}

/** Normalise the FCM/push data payload into an IncomingMessageNotif. */
export function parseMessageNotifData(
  raw: Record<string, any> | undefined | null,
): IncomingMessageNotif | null {
  if (!raw) return null;
  const roomId = String(raw.roomId ?? raw.room_id ?? '');
  if (!roomId) return null;
  const senderName = String(raw.sender ?? raw.title ?? 'New message');
  const text = String(raw.body ?? raw.content ?? '');
  const roomName = String(raw.roomName ?? raw.room_name ?? senderName);
  const ts = Number(raw.timestamp ?? 0);
  const senderIdRaw = raw.senderId ?? raw.sender_id;
  const senderId = Number(senderIdRaw);
  const messageId = String(raw.messageId ?? raw.message_id ?? '');
  const avatarRaw = raw.senderAvatar ?? raw.sender_avatar ?? null;
  const avatar = avatarRaw ? resolveMediaUrl(String(avatarRaw)) : null;
  return {
    roomId,
    roomName,
    senderName,
    senderId: Number.isFinite(senderId) && senderId > 0 ? senderId : undefined,
    messageId: messageId || undefined,
    avatar,
    text,
    timestamp: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
  };
}

/** Create the Android channel used for message notifications (idempotent). */
export async function ensureMessageChannel() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
    vibration: true,
    // Notifee requires an even number of POSITIVE values (no leading 0, unlike
    // expo-notifications) — otherwise createChannel throws and the
    // notification never renders.
    vibrationPattern: [250, 250],
    lightColor: '#7C3AED',
  });
}

/**
 * Read the accumulated lines + already-shown message ids for a room's
 * notification so new messages append (grouping) and the same message is never
 * added twice. Best-effort. Stored in the notification's own `data` so it
 * survives across app process restarts (killed-app FCM handler).
 */
async function getExisting(
  notifId: string,
): Promise<{ lines: string[]; shownIds: string[]; count: number }> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    const match = displayed.find((d) => d.id === notifId);
    const data = (match?.notification?.data ?? {}) as Record<string, unknown>;
    let lines: string[] = [];
    if (typeof data.lines === 'string') {
      try {
        const parsed = JSON.parse(data.lines);
        if (Array.isArray(parsed)) lines = parsed.map((l) => String(l));
      } catch { /* ignore */ }
    }
    const shownIds =
      typeof data.shownIds === 'string' ? data.shownIds.split(',').filter(Boolean) : [];
    const count = Number(data.count) || lines.length;
    return { lines, shownIds, count };
  } catch {
    // ignore — fall back to a fresh conversation
  }
  return { lines: [], shownIds: [], count: 0 };
}

/**
 * Display (or update) the grouped message notification for a room. Uses a
 * BigText style so it arrives COLLAPSED (sender + latest message) and expands
 * to show the recent messages. One stable notification per room accumulates
 * new messages. Safe to call from the killed-app background handler.
 */
export async function displayMessageNotification(data: IncomingMessageNotif) {
  const notifId = NOTIFICATION_ID_PREFIX + data.roomId;

  if (Platform.OS !== 'android') {
    // iOS: plain notification.
    await notifee.displayNotification({
      id: notifId,
      title: data.senderName,
      body: data.text,
      data: { roomId: data.roomId, roomName: data.roomName, type: 'new_message' },
      ios: { sound: 'default' },
    });
    return;
  }

  const { lines: prevLines, shownIds, count: prevCount } = await getExisting(notifId);

  // Dedupe: same message delivered via WS + FCM, or a duplicate FCM.
  if (data.messageId && shownIds.includes(data.messageId)) return;

  // A real group chat has a room name distinct from the sender; a 1:1 doesn't.
  const isGroup = !!data.roomName && data.roomName !== data.senderName;
  // Prefix the line with the speaker for group chats / reply echoes so the
  // expanded list shows who said what; a 1:1 line is just the message text.
  const speaker = data.fromMe ? 'You' : data.senderName;
  const line = isGroup || data.fromMe ? `${speaker}: ${data.text}` : data.text;
  const lines = [line, ...prevLines].slice(0, 8); // newest first, bounded
  const count = prevCount + 1;
  const nextShownIds = (data.messageId ? [...shownIds, data.messageId] : shownIds).slice(-20);

  const name = isGroup ? data.roomName : data.senderName;
  // Title carries an unread count when more than one message is stacked.
  const title = count > 1 ? `${name} (${count})` : name;
  const body = lines[0]; // collapsed → latest message
  // Separate stacked messages with a blank line. A bare "\n\n" gets collapsed
  // by Android's BigText renderer, so the middle line carries a non-breaking
  // space (U+00A0) to force a visible gap.
  const bigText = lines.join('\n\u00A0\n'); // expanded → recent history

  await notifee.displayNotification({
    id: notifId,
    title,
    body,
    data: {
      roomId: data.roomId,
      roomName: data.roomName,
      type: 'new_message',
      lines: JSON.stringify(lines),
      count: String(count),
      shownIds: nextShownIds.join(','),
      ...(data.senderId != null ? { senderId: String(data.senderId) } : {}),
    },
    android: {
      channelId: CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: 'ic_launcher',
      color: '#7C3AED',
      // Sender's avatar as the large icon (falls back to nothing / app icon).
      ...(data.avatar ? { largeIcon: data.avatar } : {}),
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: 'Reply',
          pressAction: { id: 'reply' },
          input: { allowFreeFormInput: true, placeholder: 'Reply\u2026' },
        },
        {
          // Dismisses the notification and sends read receipts to the sender.
          title: 'Mark as read',
          pressAction: { id: 'mark_read' },
        },
      ],
      // BigText collapses to title + body and expands to the recent lines.
      style: { type: AndroidStyle.BIGTEXT, text: bigText },
    },
  });
}

/** Cancel the message notification for a room (e.g. after the chat is read). */
export async function cancelMessageNotification(roomId: string) {
  await notifee.cancelNotification(NOTIFICATION_ID_PREFIX + roomId);
}
