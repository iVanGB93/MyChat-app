/**
 * pushMessageStore.ts
 *
 * Saves a message that arrived via Expo push notification to the local
 * SQLite database.  This lets users see messages in the chat history even
 * when the WS was not connected when the message was sent.
 *
 * Called from App.tsx on:
 *   - notification tap (response listener)
 *   - notification received while app is backgrounded (received listener)
 */

import { saveMessage, messageExists } from './localMessageStore';
import { useAppStore } from '../store/appStore';
import { sendOrQueueMessageAck } from './notificationWsManager';

/**
 * Parse push notification data and persist the message to SQLite.
 * Safe to call with incomplete data — missing fields are silently skipped.
 */
export async function savePushMessage(
  data: Record<string, string | undefined> | null | undefined,
): Promise<boolean> {
  if (!data) return false;

  const messageId = data.message_id ?? data.messageId;
  const roomId    = data.room_id    ?? data.roomId;
  const senderId  = data.sender_id  ?? data.senderId;
  const content   = data.content;

  // Minimum fields required to store a message row
  if (!messageId || !roomId || !senderId || !content) {
    console.log(
      '[PushStore] skipped — missing fields',
      { messageId: !!messageId, roomId: !!roomId, senderId: !!senderId, content: !!content },
    );
    return false;
  }

  // Avoid duplicate rows (WS may have already delivered it)
  const exists = await messageExists(messageId);
  if (exists) return false;

  const senderIdNum  = Number(senderId);
  const senderName   = data.sender ?? '';
  const messageType  = data.message_type ?? data.messageType ?? 'text';
  const createdAt    = data.created_at   ?? data.createdAt   ?? new Date().toISOString();

  // Determine if this message belongs to the current user (should be false for
  // push — only the recipient receives the push)
  const currentUserId = (() => {
    try { return useAppStore.getState().user?.id; } catch { return undefined; }
  })();
  const isMine = currentUserId != null && senderIdNum === currentUserId;

  await saveMessage({
    id:          messageId,
    room_id:     roomId,
    sender_id:   senderIdNum,
    sender_name: senderName,
    content:     content,
    type:        messageType,
    file_uri:    null,
    created_at:  createdAt,
    is_mine:     isMine,
    sync:        true,          // came from server, no need to re-sync
    status:      'delivered',
    reactions:   {},
    is_deleted:  false,
    is_read:     false,
    reply_to:    null,
    duration_ms: null,
  });

  // Update the chat list last-message preview in the store
  try {
    useAppStore.getState().setRoomLastMessage(roomId, {
      id:         messageId,
      content:    content,
      created_at: createdAt,
      sender:     senderName,
      sender_id:  senderIdNum,
    });
    // Bump unread if the user isn't currently viewing this room
    const store = useAppStore.getState();
    if (store.activeRoomId !== roomId && !store.mutedRooms[roomId]) {
      store.incrementRoomUnread(roomId, 1);
    }
  } catch { /* store may not be ready yet on cold launch */ }

  console.log('[PushStore] saved message', messageId, 'room', roomId);

  // Tell the server the message was delivered so it clears PendingDelivery
  // and marks MessageDelivery as delivered. Works even if WS is not open —
  // the ack is queued in AsyncStorage and flushed on the next auth_ok.
  const senderIdForAck = Number(senderId);
  if (senderIdForAck > 0) {
    sendOrQueueMessageAck({
      message_id: messageId,
      sender_id:  senderIdForAck,
      room_id:    roomId,
    }).catch(() => {});
  }

  return true;
}
