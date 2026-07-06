/* ------------------------------------------------------------------ */
/*  Notification Reply Service                                          */
/*                                                                      */
/*  Handles direct-reply ("Reply") actions on chat-message             */
/*  notifications. Because the backend is a pure WebSocket relay with   */
/*  no message persistence, a reply sent from a killed app must:        */
/*    1. persist locally (so the sender's own copy survives), and       */
/*    2. relay to the room via the HTTP /api/chat/messages/send/        */
/*       endpoint (the WS is not connected in a headless task).         */
/* ------------------------------------------------------------------ */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventType, type Event } from '@notifee/react-native';

import api from './api';
import { saveMessage } from './localMessageStore';
import {
  ensureMessageChannel,
  displayMessageNotification,
} from './messageNotificationService';

const USER_CACHE_KEY = '@axonic_user_cache';
const REPLY_ACTION_ID = 'reply';

/** RFC4122 v4 UUID — uses crypto.randomUUID when available, else a fallback. */
function generateUUID(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getCachedUser(): Promise<{ id: number; username: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.id != null ? { id: Number(u.id), username: String(u.username ?? '') } : null;
  } catch {
    return null;
  }
}

export interface NotificationReplyArgs {
  roomId: string;
  roomName: string;
  text: string;
}

/**
 * Persist + relay a reply typed directly into a message notification.
 * Safe to call from the killed-app background event handler.
 */
export async function sendReplyFromNotification(
  args: NotificationReplyArgs,
): Promise<boolean> {
  const text = (args.text ?? '').trim();
  if (!args.roomId || !text) return false;

  const me = await getCachedUser();
  const msgId = generateUUID();
  const createdAt = new Date().toISOString();

  // 1. Persist locally first — the backend is a pure relay, so our own sent
  //    message only lives on this device. Best-effort.
  if (me) {
    try {
      await saveMessage({
        id: msgId,
        room_id: args.roomId,
        sender_id: me.id,
        sender_name: me.username,
        content: text,
        type: 'text',
        file_uri: null,
        created_at: createdAt,
        is_mine: true,
        sync: false,
        status: 'pending',
        reactions: {},
        is_deleted: false,
        is_read: true,
        reply_to: null,
        duration_ms: null,
      });
    } catch (err) {
      console.warn('[NotifReply] local persist failed:', err);
    }
  }

  // 2. Relay via HTTP (works without a live WS, even when the app is killed).
  try {
    await api.post('/api/chat/messages/send/', {
      room_id: args.roomId,
      id: msgId,
      message: text,
      message_type: 'text',
      created_at: createdAt,
    });
  } catch (err) {
    console.warn('[NotifReply] HTTP send failed:', err);
    return false;
  }

  // 3. Echo the sent reply back into the notification shade so the user sees
  //    it was delivered and the conversation stays open. Best-effort.
  try {
    await ensureMessageChannel();
    await displayMessageNotification({
      roomId: args.roomId,
      roomName: args.roomName,
      senderName: me?.username ?? 'You',
      text,
      timestamp: Date.now(),
      fromMe: true,
    });
  } catch {
    /* notification echo is best-effort */
  }

  // 4. Replying implies you've read the conversation — send read receipts and
  //    clear the unread badge (but keep the notification, which now shows your
  //    reply echo).
  try {
    const { markRoomReadFromNotification } = await import('./notificationActionService');
    await markRoomReadFromNotification(args.roomId, { dismiss: false });
  } catch {
    /* best-effort */
  }

  return true;
}

/**
 * Notifee event handler for the message "Reply" action. Wired into the unified
 * background dispatcher (index.ts) and the foreground handler (App.tsx).
 * Returns true when it consumed the event.
 */
export async function handleMessageReplyEvent(event: Event): Promise<boolean> {
  const { type, detail } = event;
  if (type !== EventType.ACTION_PRESS) return false;
  if (detail.pressAction?.id !== REPLY_ACTION_ID) return false;

  const text = String(detail.input ?? '').trim();
  const data = (detail.notification?.data ?? {}) as Record<string, any>;
  const roomId = String(data.roomId ?? data.room_id ?? '');
  const roomName = String(data.roomName ?? data.room_name ?? '');
  if (!roomId || !text) return true; // consumed, but nothing to send

  await sendReplyFromNotification({ roomId, roomName, text });
  return true;
}
