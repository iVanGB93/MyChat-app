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
  sendTyping,
  subscribeRoom,
} from '../services/chatWsManager';
import { useAppStore } from '../store/appStore';

// Re-export WsMessage so existing imports (e.g. ChatRoomScreen) keep working
export type { WsMessage } from '../services/chatWsManager';

export function useChat(roomId: string, currentUserId?: number) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(() => getSnapshot(roomId));

  // Read store-level chat room status — single source of truth for connectivity.
  const roomStatus = useAppStore((s) => s.chatRooms[roomId]?.status ?? 'disconnected');
  const roomAuthenticated = useAppStore((s) => s.chatRooms[roomId]?.authenticated ?? false);

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
      // Media whose bytes haven't been downloaded yet (file_uri null) is a
      // placeholder. Marking a placeholder read would tell the sender ✓✓ read
      // even though the file never arrived (false read/delivered). Skip it here;
      // once the media hydrates, loadFromDB re-runs and sends the receipt.
      const isIncompleteMedia = (m: typeof msgs[number]) =>
        (m.message_type === 'voice' || m.message_type === 'image' || m.message_type === 'video' || m.message_type === 'document')
        && !m.file_uri;
      const unreadIds = currentUserId
        ? newMsgs
            .filter((m) => m.sender_id !== currentUserId && !isIncompleteMedia(m))
            .map((m) => m.id)
        : [];
      if (unreadIds.length > 0) {
        markRoomAsRead(roomId, unreadIds); // queued if WS not open
      }
    }
    prevMsgCountRef.current = msgs.length;
  }, [snapshot.messages, roomId, currentUserId]);

  const sendMessage = useCallback(
    (
      content: string,
      messageType = 'text',
      replyTo: import('../services/localMessageStore').ReplyRef | null = null,
      extras: import('../services/chatWsManager').SendExtras | null = null,
    ) => sendChatMessage(roomId, content, messageType, replyTo, extras),
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

  // ---- Typing indicator ----
  // List of OTHER users currently typing in this room (current user excluded).
  // IMPORTANT: subscribe to the per-room slot directly (a stable reference when
  // empty: `undefined`) and derive the array outside the selector. Using
  // `(s) => s.typingByRoom[roomId] ?? []` returns a fresh `[]` every call and
  // triggers infinite re-renders.
  const typingEntry = useAppStore((s) => s.typingByRoom[roomId]);
  const typers = (typingEntry ?? []).filter((t) => t.userId !== currentUserId);

  // Throttled typing emitter. Caller can fire `notifyTyping()` on every keystroke;
  // we send `is_typing=true` at most once every 3s, and schedule a `false` 4s after
  // the last keystroke. The server-side TTL in the store is 5s, so missed `false`
  // pings auto-expire too.
  const typingStateRef = useRef<{
    lastSentAt: number;
    sentTrue: boolean;
    stopTimer: ReturnType<typeof setTimeout> | null;
  }>({ lastSentAt: 0, sentTrue: false, stopTimer: null });

  const notifyTyping = useCallback(() => {
    const st = typingStateRef.current;
    const now = Date.now();
    if (!st.sentTrue || now - st.lastSentAt > 3000) {
      sendTyping(roomId, true);
      st.sentTrue = true;
      st.lastSentAt = now;
    }
    if (st.stopTimer) clearTimeout(st.stopTimer);
    st.stopTimer = setTimeout(() => {
      if (st.sentTrue) {
        sendTyping(roomId, false);
        st.sentTrue = false;
      }
    }, 4000);
  }, [roomId]);

  // Cleanup any pending stop-timer on unmount and emit a final 'false' so peers
  // don't see a stuck typing indicator if we navigate away mid-typing.
  useEffect(() => {
    return () => {
      const st = typingStateRef.current;
      if (st.stopTimer) clearTimeout(st.stopTimer);
      if (st.sentTrue) {
        try { sendTyping(roomId, false); } catch {}
      }
    };
  }, [roomId]);

  return {
    messages: snapshot.messages,
    // setMessages kept for API compatibility (no-op; state is managed by singleton)
    setMessages: (_: any) => {},
    // `connected` reflects the global store's truth (status=connected AND authenticated).
    // Falls back to the snapshot status while the store hasn't been populated yet.
    connected: roomAuthenticated && roomStatus === 'connected',
    sendMessage,
    markAsRead,
    readIds: snapshot.readIds,
    pendingIds: snapshot.pendingIds,
    sendingIds: snapshot.sendingIds,
    deliveredIds: snapshot.deliveredIds,
    markIdsAsRead,
    markIdsAsDelivered,
    reconnectCount: snapshot.reconnectCount,
    lastMutationAt: snapshot.lastMutationAt,
    lastMutationIds: snapshot.lastMutationIds,
    typers,
    notifyTyping,
  };
}
