/* ------------------------------------------------------------------ */
/*  useChat — thin React wrapper over the chatWsManager singleton      */
/*                                                                     */
/*  The WebSocket connection lives at MODULE level in chatWsManager    */
/*  and survives component unmounts. This hook subscribes to the       */
/*  room's state and forwards actions, exposing the same interface     */
/*  as the previous hook-based implementation.                         */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSnapshot,
  markIdsAsDeliveredInRoom,
  markIdsAsReadInRoom,
  markRoomAsRead,
  RoomSnapshot,
  sendChatMessage,
  subscribeRoom,
} from '../services/chatWsManager';

// Re-export WsMessage so existing imports (e.g. ChatRoomScreen) keep working
export type { WsMessage } from '../services/chatWsManager';

export function useChat(roomId: string, currentUserId?: number) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(() => getSnapshot(roomId));

  // Subscribe to the singleton on mount; unsubscribe (NOT disconnect) on unmount
  useEffect(() => {
    // Immediately sync with latest state in case the singleton already has data
    setSnapshot(getSnapshot(roomId));

    const unsub = subscribeRoom(roomId, (next) => {
      setSnapshot(next);
    });

    return unsub; // does NOT close the WebSocket
  }, [roomId]);

  // Auto-mark incoming messages from the other user as read
  const prevMsgCountRef = useRef(snapshot.messages.length);
  useEffect(() => {
    const msgs = snapshot.messages;
    if (msgs.length > prevMsgCountRef.current) {
      const newMsgs = msgs.slice(prevMsgCountRef.current);
      const unreadIds = currentUserId
        ? newMsgs.filter((m) => m.sender_id !== currentUserId).map((m) => m.id)
        : [];
      if (unreadIds.length > 0) {
        markRoomAsRead(roomId, unreadIds); // queued if WS not open
      }
    }
    prevMsgCountRef.current = msgs.length;
  }, [snapshot.messages, roomId, currentUserId]);

  const sendMessage = useCallback(
    (content: string, messageType = 'text') => {
      sendChatMessage(roomId, content, messageType);
    },
    [roomId],
  );

  const markAsRead = useCallback(
    (messageIds?: string[]) => {
      markRoomAsRead(roomId, messageIds);
    },
    [roomId],
  );

  const markIdsAsDelivered = useCallback(
    (ids: string[]) => {
      markIdsAsDeliveredInRoom(roomId, ids);
    },
    [roomId],
  );

  const markIdsAsRead = useCallback(
    (ids: string[]) => {
      markIdsAsReadInRoom(roomId, ids);
    },
    [roomId],
  );

  return {
    messages: snapshot.messages,
    // setMessages kept for API compatibility (no-op; state is managed by singleton)
    setMessages: (_: any) => {},
    connected: snapshot.status === 'connected',
    sendMessage,
    markAsRead,
    readIds: snapshot.readIds,
    pendingIds: snapshot.pendingIds,
    deliveredIds: snapshot.deliveredIds,
    markIdsAsRead,
    markIdsAsDelivered,
    reconnectCount: snapshot.reconnectCount,
  };
}
