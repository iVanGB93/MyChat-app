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

const CHANNEL_ID = 'messages';
const NOTIFICATION_ID_PREFIX = 'message:';

export interface IncomingMessageNotif {
  roomId: string;
  roomName: string;
  senderName: string;
  /** User id of the message sender (the reply recipient), if known. */
  senderId?: number;
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
  return {
    roomId,
    roomName,
    senderName,
    senderId: Number.isFinite(senderId) && senderId > 0 ? senderId : undefined,
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

type MessagingMessage = {
  text: string;
  timestamp: number;
  person?: { name: string };
};

/**
 * Read the messages already shown for this room so a new message appends to the
 * existing conversation (MessagingStyle) instead of replacing it. Best-effort:
 * returns [] if nothing is displayed or the platform doesn't expose it.
 */
async function getExistingMessages(notifId: string): Promise<MessagingMessage[]> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    const match = displayed.find((d) => d.id === notifId);
    const style = match?.notification?.android?.style as
      | { type: AndroidStyle.MESSAGING; messages?: MessagingMessage[] }
      | undefined;
    if (style && style.type === AndroidStyle.MESSAGING && Array.isArray(style.messages)) {
      // Keep the conversation bounded so the payload stays small.
      return style.messages.slice(-9);
    }
  } catch {
    // ignore — fall back to a fresh conversation
  }
  return [];
}

/**
 * Display (or update) the MessagingStyle notification for an incoming message.
 * Safe to call from the killed-app background handler.
 */
export async function displayMessageNotification(data: IncomingMessageNotif) {
  const notifId = NOTIFICATION_ID_PREFIX + data.roomId;

  if (Platform.OS !== 'android') {
    // iOS: plain notification (MessagingStyle is Android-only).
    await notifee.displayNotification({
      id: notifId,
      title: data.senderName,
      body: data.text,
      data: { roomId: data.roomId, roomName: data.roomName, type: 'new_message' },
      ios: { sound: 'default' },
    });
    return;
  }

  const previous = await getExistingMessages(notifId);
  const messages: MessagingMessage[] = [
    ...previous,
    {
      text: data.text,
      timestamp: data.timestamp ?? Date.now(),
      // Omitting `person` makes MessagingStyle render the message as sent by
      // the conversation owner (the local user) — used for reply echoes.
      ...(data.fromMe ? {} : { person: { name: data.senderName } }),
    },
  ];

  await notifee.displayNotification({
    id: notifId,
    title: data.roomName,
    body: data.text,
    data: {
      roomId: data.roomId,
      roomName: data.roomName,
      type: 'new_message',
      ...(data.senderId != null ? { senderId: String(data.senderId) } : {}),
    },
    android: {
      channelId: CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: 'ic_launcher',
      color: '#7C3AED',
      pressAction: { id: 'default', launchActivity: 'default' },
      // Direct-reply action — lets the user reply from the notification shade
      // without opening the app. Handled in the Notifee background event
      // handler (registered in index.ts), which POSTs to /api/chat/messages/send/.
      actions: [
        {
          title: 'Reply',
          pressAction: { id: 'reply' },
          input: {
            allowFreeFormInput: true,
            placeholder: 'Reply\u2026',
          },
        },
      ],
      style: {
        type: AndroidStyle.MESSAGING,
        person: { name: 'You' },
        title: data.roomName,
        group: messages.length > 1,
        messages,
      },
    },
  });
}

/** Cancel the message notification for a room (e.g. after the chat is read). */
export async function cancelMessageNotification(roomId: string) {
  await notifee.cancelNotification(NOTIFICATION_ID_PREFIX + roomId);
}
