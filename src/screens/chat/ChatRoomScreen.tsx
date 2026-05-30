/* ------------------------------------------------------------------ */
/*  Chat Room Screen                                                   */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Alert,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import dayjs from 'dayjs';
import { Font, Spacing, Radius } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useChat, WsMessage } from '../../hooks/useChat';
import { initDB, saveMessage, getMessages, deleteMessage, toggleReaction, LocalMessage } from '../../services/localMessageStore';
import { markRoomAsRead, sendMessageUpdate, markIdsAsReadInRoom, sendChatMessage } from '../../services/chatWsManager';
import { getRooms } from '../../services/chatService';
import { initiateCall } from '../../services/callService';
import { playSound } from '../../services/soundService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { useAppStore } from '../../store/appStore';
import type { Message, RootStackParamList, ChatRoom } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '👏'];

/* Convert a LocalMessage row to the shared Message type */
function toMsg(m: LocalMessage): Message {
  return {
    id: m.id,
    room: m.room_id,
    sender: m.sender_id,
    sender_username: m.sender_name,
    content: m.content ?? '',
    message_type: m.type as Message['message_type'],
    file: m.file_uri,
    is_read: false,
    created_at: m.created_at,
    reactions: m.reactions,
    is_deleted: m.is_deleted,
    reply_to: m.reply_to,
  };
}

/* Convert a WsMessage to the shared Message type */
function wsToMsg(m: WsMessage, roomId: string): Message {
  return {
    id: m.id,
    room: roomId,
    sender: m.sender_id,
    sender_username: m.sender,
    content: m.content,
    message_type: m.message_type as Message['message_type'],
    file: null,
    is_read: m.is_read ?? false,
    created_at: m.created_at,
    reactions: m.reactions ?? {},
    is_deleted: m.is_deleted ?? false,
    reply_to: m.reply_to ?? null,
  };
}

export default function ChatRoomScreen({ route, navigation }: Props) {
  const { roomId, otherUserId } = route.params;
  const { user } = useAuth();
  const { messages: wsMessages, sendMessage, connected, readIds, pendingIds, deliveredIds, markIdsAsRead, markIdsAsDelivered, reconnectCount, lastMutationAt, typers, notifyTyping } = useChat(roomId, user?.id);
  const isMuted = useAppStore((s) => !!s.mutedRooms[roomId]);
  const { subscribe } = useNotificationContext();
  const { colors: Colors } = useTheme();

  // Mark this room as the active one in the global store while the screen is mounted.
  // Other systems (notification routing, foreground service, etc.) read this to
  // decide whether to show in-app vs. push notifications.
  useEffect(() => {
    useAppStore.getState().setActiveRoom(roomId);
    return () => {
      if (useAppStore.getState().activeRoomId === roomId) {
        useAppStore.getState().setActiveRoom(null);
      }
    };
  }, [roomId]);

  /* SQLite-sourced messages — only updated by load/reload calls */
  const [sqliteMessages, setSqliteMessages] = useState<Message[]>([]);
  const [contextMsg, setContextMsg] = useState<Message | null>(null);
  const [contextY,   setContextY]   = useState(0);
  /** Message currently being forwarded — when set, the room-picker modal is shown. */
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [forwardRooms, setForwardRooms] = useState<ChatRoom[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  /** Message currently being replied to — when set, shows a preview strip above the input. */
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const { height: winHeight } = useWindowDimensions();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  /* Load (or reload) messages from the local SQLite DB */
  const loadFromDB = useCallback(async (cancelled?: { current: boolean }) => {
    const dbMsgs = await getMessages(roomId);
    console.log('[ChatRoom] SQLite →', dbMsgs.length, 'msgs for room', roomId);
    if (cancelled?.current) return;
    setSqliteMessages(dbMsgs.map(toMsg));
    // Pre-populate readIds from is_read=1 rows persisted in SQLite (survives app restarts).
    const persistedReadIds = dbMsgs.filter(m => m.is_mine && m.is_read).map(m => m.id);
    if (persistedReadIds.length > 0) markIdsAsReadInRoom(roomId, persistedReadIds);
    // Send read receipts only for messages not yet marked read in SQLite.
    // Filtering out already-read messages prevents re-sending on every reload.
    const idsFromOthers = dbMsgs.filter(m => !m.is_mine && !m.is_read).map(m => m.id);
    if (idsFromOthers.length > 0) {
      markRoomAsRead(roomId, idsFromOthers);
    }
  }, [roomId]);

  /* ── Initial load from SQLite ── */
  useEffect(() => {
    const cancel = { current: false };
    (async () => {
      try {
        await initDB();
        await loadFromDB(cancel);
      } catch { /* ignore */ } finally {
        if (!cancel.current) setLoading(false);
      }
    })();
    return () => { cancel.current = true; };
  }, [roomId, loadFromDB]);

  /* ── Reload SQLite after WS reconnect (picks up any messages saved while disconnected) ── */
  useEffect(() => {
    if (reconnectCount === 0) return;
    loadFromDB().catch(() => {});
  }, [reconnectCount, loadFromDB]);

  /* ── Reload SQLite when a remote message_update arrives (reactions, is_read, etc.) ── */
  const prevMutationRef = useRef(0);
  useEffect(() => {
    if (!lastMutationAt || lastMutationAt === prevMutationRef.current) return;
    prevMutationRef.current = lastMutationAt;
    loadFromDB().catch(() => {});
  }, [lastMutationAt, loadFromDB]);

  /* ── Merge SQLite messages + live WS messages (dedup by ID, WS wins for freshness) ── */
  const allMessages = useMemo(() => {
    const byId = new Map<string, Message>();
    const sqliteById = new Map(sqliteMessages.map((m) => [m.id, m]));
    // IDs present in the live WS session — these carry the most current mutations
    const wsIdSet = new Set(wsMessages.map(m => m.id));
    // SQLite messages first (historical base)
    for (const m of sqliteMessages) byId.set(m.id, m);
    // WS messages overlay — wsToMsg now copies reactions and is_deleted
    for (const m of wsMessages) byId.set(m.id, wsToMsg(m, roomId));
    // For historical-only messages (not in WS session), re-apply SQLite reactions/is_deleted
    // which may have been updated by a remote message_update received in a previous session.
    for (const [id, msg] of byId) {
      if (wsIdSet.has(id)) continue; // WS copy is more current — skip
      const sql = sqliteById.get(id);
      if (sql && (sql.is_deleted || Object.keys(sql.reactions ?? {}).length > 0)) {
        byId.set(id, { ...msg, reactions: sql.reactions, is_deleted: sql.is_deleted });
      }
    }
    console.log('[ChatRoom] allMessages:', byId.size, '(sqlite:', sqliteMessages.length, 'ws:', wsMessages.length, ')');
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [sqliteMessages, wsMessages, roomId]);

  /* ── Apply read-receipt overlay ── */
  const displayedMsgs = useMemo(
    () => allMessages.map(m => ({ ...m, is_read: m.is_read || readIds.has(m.id) })),
    [allMessages, readIds],
  );

  /* ── Auto-scroll and keyboard scroll removed — FlatList is inverted, newest messages
     always appear at the bottom automatically ── */

  /* ── Sound for incoming messages ── */
  const prevWsCount = useRef(wsMessages.length);
  useEffect(() => {
    if (wsMessages.length > prevWsCount.current) {
      const last = wsMessages[wsMessages.length - 1];
      if (last && last.sender_id !== user?.id) playSound('message_received');
    }
    prevWsCount.current = wsMessages.length;
  }, [wsMessages.length]);

  /* ── Listen for read receipts + delivery acks from notification channel ── */
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (payload.event === 'messages_read' && payload.room_id === roomId && payload.message_ids) {
        markIdsAsRead(payload.message_ids as string[]);
      }
      if (payload.event === 'message_delivery_ack' && payload.room_id === roomId && payload.message_id) {
        markIdsAsDelivered([payload.message_id as string]);
      }
    });
    return unsub;
  }, [subscribe, roomId, markIdsAsRead, markIdsAsDelivered]);

  /* ── Call header buttons ── */
  const handleCall = async (callType: 'voice' | 'video') => {
    if (!otherUserId) { Alert.alert('Info', 'Calls are only available in direct chats'); return; }
    try {
      const res = await initiateCall(otherUserId, callType);
      navigation.navigate('ActiveCall', {
        callId: res.call_id, otherName: route.params.roomName,
        callType, roomName: res.room_name, isOutgoing: true, peerUserId: otherUserId,
      });
    } catch { Alert.alert('Error', 'Failed to start call'); }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 8, marginRight: 8 }}>
          <TouchableOpacity
            onPress={() => useAppStore.getState().toggleRoomMuted(roomId)}
            activeOpacity={0.7}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: isMuted ? 'rgba(255,80,80,0.15)' : 'rgba(0,229,255,0.10)',
              borderWidth: 1, borderColor: isMuted ? 'rgba(255,80,80,0.35)' : 'rgba(0,229,255,0.30)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons
              name={isMuted ? 'notifications-off-outline' : 'notifications-outline'}
              size={18}
              color={isMuted ? '#FF5050' : '#00E5FF'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleCall('video')}
            activeOpacity={0.7}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(0,229,255,0.10)',
              borderWidth: 1, borderColor: 'rgba(0,229,255,0.30)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="videocam-outline" size={18} color="#00E5FF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleCall('voice')}
            activeOpacity={0.7}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(0,229,255,0.10)',
              borderWidth: 1, borderColor: 'rgba(0,229,255,0.30)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="call-outline" size={18} color="#00E5FF" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, otherUserId, roomId, isMuted]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    console.log('[ChatRoom] sending:', trimmed.slice(0, 30));
    const reply = replyingTo
      ? {
          id: replyingTo.id,
          sender_name: replyingTo.sender_username || '',
          // Truncate to keep WS frames small and the bubble preview manageable
          content: (replyingTo.content ?? '').slice(0, 140),
          type: replyingTo.message_type,
        }
      : null;
    sendMessage(trimmed, 'text', reply);
    setText('');
    setReplyingTo(null);
    playSound('message_sent');
  };

  const handleReaction = useCallback(async (emoji: string) => {
    if (!contextMsg || !user) return;
    const msgId = contextMsg.id;
    setContextMsg(null);
    const newReactions = await toggleReaction(msgId, emoji, String(user.id));
    // Update in-memory WS state + relay to other members (reacted_emoji is a display hint)
    sendMessageUpdate(roomId, msgId, { reactions: newReactions, reacted_emoji: emoji });
  }, [contextMsg, user, roomId, loadFromDB]);

  const handleDelete = useCallback(() => {
    if (!contextMsg) return;
    const msgId = contextMsg.id;
    setContextMsg(null);
    Alert.alert(
      'Delete message',
      'This message will be removed for you only.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteMessage(msgId);
          // Update in-memory WS state + relay to other members
          sendMessageUpdate(roomId, msgId, { is_deleted: true });
        }},
      ],
    );
  }, [contextMsg, roomId, loadFromDB]);

  /** Open the forward picker. Fetches the room list on demand. */
  const handleForward = useCallback(async () => {
    if (!contextMsg) return;
    const target = contextMsg;
    setContextMsg(null);
    setForwardMsg(target);
    setForwardLoading(true);
    try {
      const data = await getRooms();
      // Exclude the source room — forwarding to self is rarely useful.
      setForwardRooms(data.filter((r) => r.id !== roomId));
    } catch {
      setForwardRooms([]);
    } finally {
      setForwardLoading(false);
    }
  }, [contextMsg, roomId]);

  /** Send the forwarded message to the selected room. */
  const doForwardTo = useCallback(async (targetRoomId: string) => {
    if (!forwardMsg) return;
    const msg = forwardMsg;
    setForwardMsg(null);
    try {
      await sendChatMessage(
        targetRoomId,
        msg.content ?? '',
        (msg.message_type as string) || 'text',
      );
      playSound('message_sent');
    } catch { /* ignore — saved locally */ }
  }, [forwardMsg]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine    = item.sender === user?.id;
    const isPending = isMine && pendingIds.has(item.id);
    const isRead    = isMine && (item.is_read || readIds.has(item.id));

    let statusIcon: string;
    let statusColor: string;
    if (isPending) {
      statusIcon  = '⏱';
      statusColor = Colors.textTertiary;
    } else if (isRead) {
      statusIcon  = '✓✓';
      statusColor = Colors.checkBlue;
    } else {
      // single ✓ = sent/delivered (server received it, or receiver stored it)
      statusIcon  = '✓';
      statusColor = Colors.textTertiary;
    }
    return (
      <Swipeable
        renderLeftActions={() => (
          <View style={styles.swipeReplyHint}>
            <Ionicons name="arrow-undo" size={22} color={Colors.primary} />
          </View>
        )}
        leftThreshold={40}
        friction={2}
        overshootLeft={false}
        enabled={!item.is_deleted}
        onSwipeableOpen={(direction, swipeable) => {
          if (direction === 'left') {
            setReplyingTo(item);
            swipeable.close();
          }
        }}
      >
        <View style={[styles.bubbleRow, isMine ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
          <TouchableOpacity
            onLongPress={(e) => {
              if (!item.is_deleted) {
                setContextY(e.nativeEvent.pageY);
                setContextMsg(item);
              }
            }}
            delayLongPress={350}
            activeOpacity={0.85}
          >
            <View style={[
              styles.bubble,
              isMine
                ? [styles.bubbleSent, { backgroundColor: Colors.bubbleSent, borderColor: Colors.neonBorder }]
                : [styles.bubbleReceived, { backgroundColor: Colors.bubbleReceived, borderColor: Colors.divider }],
            ]}>
              {!isMine && (
                <Text style={[styles.senderName, { color: Colors.primary }]}>{item.sender_username}</Text>
              )}
              {item.reply_to && !item.is_deleted && (
                <View style={[styles.quoteBlock, {
                  borderLeftColor: Colors.primary,
                  backgroundColor: Colors.surfaceVariant,
                }]}>
                  <Text style={[styles.quoteName, { color: Colors.primary }]} numberOfLines={1}>
                    {item.reply_to.sender_name || 'Unknown'}
                  </Text>
                  <Text style={[styles.quoteText, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {item.reply_to.content
                      || (item.reply_to.type && item.reply_to.type !== 'text'
                        ? `[${item.reply_to.type}]`
                        : '')}
                  </Text>
                </View>
              )}
              {item.is_deleted ? (
                <Text style={[styles.deletedText, { color: Colors.textTertiary }]}>
                  🚫 This message was deleted.
                </Text>
              ) : (
                <Text style={[styles.messageText, { color: Colors.text }]}>{item.content}</Text>
              )}
              {!item.is_deleted && item.reactions && Object.keys(item.reactions).length > 0 && (
                <View style={styles.reactionsDisplay}>
                  {Object.entries(item.reactions).map(([emoji, users]) => (
                    <TouchableOpacity
                      key={emoji}
                      onPress={async () => {
                        const newReactions = await toggleReaction(item.id, emoji, String(user?.id ?? ''));
                        sendMessageUpdate(roomId, item.id, { reactions: newReactions, reacted_emoji: emoji });
                      }}
                      style={[styles.reactionBadge, {
                        backgroundColor: users.includes(String(user?.id))
                          ? Colors.neonGlow : Colors.surfaceVariant,
                        borderColor: users.includes(String(user?.id))
                          ? Colors.primary : Colors.border,
                      }]}
                    >
                      <Text style={styles.reactionBadgeText}>{emoji} {users.length}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.metaRow}>
                <Text style={[styles.timeText, { color: Colors.textTertiary }]}>
                  {dayjs(item.created_at).format('HH:mm')}
                </Text>
                {isMine && !item.is_deleted && (
                  <Text style={[styles.statusIcon, { color: statusColor }]}>{statusIcon}</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </Swipeable>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.chatBg }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    /* On Android, windowSoftInputMode=adjustResize in manifest handles keyboard natively.
       On iOS, KeyboardAvoidingView with behavior="padding" is needed. */
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.chatBg }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
    >
      {!connected && (
        <View style={[styles.connectionBar, { backgroundColor: Colors.surface, borderBottomColor: Colors.warning }]}>
          <Text style={[styles.connectionText, { color: Colors.warning }]}>◈ SYNCING…</Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={[...displayedMsgs].reverse()}
        extraData={displayedMsgs.length}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.messageList}
        contentContainerStyle={styles.messagesList}
        inverted
        keyboardShouldPersistTaps="handled"
      />

      <View style={[styles.inputBar, { backgroundColor: Colors.chatBg, borderTopColor: Colors.neonBorder, paddingBottom: insets.bottom + Spacing.sm }]}>
        {typers.length > 0 && (
          <Text style={[styles.typingHint, { color: Colors.textSecondary }]}>
            {typers.length === 1
              ? `${typers[0].username} is typing…`
              : `${typers.map(t => t.username).join(', ')} are typing…`}
          </Text>
        )}
        {replyingTo && (
          <View style={[styles.replyPreview, {
            backgroundColor: Colors.surface,
            borderLeftColor: Colors.primary,
            borderColor: Colors.neonBorder,
          }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyPreviewName, { color: Colors.primary }]} numberOfLines={1}>
                ↩ Replying to {replyingTo.sender_username || 'Unknown'}
              </Text>
              <Text style={[styles.replyPreviewText, { color: Colors.textSecondary }]} numberOfLines={1}>
                {replyingTo.content || (replyingTo.message_type !== 'text' ? `[${replyingTo.message_type}]` : '')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyingTo(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.replyPreviewClose}
            >
              <Ionicons name="close" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRowWrap}>
          <View style={[styles.inputRow, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
            <TextInput
              style={[styles.textInput, { color: Colors.text }]}
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (t.length > 0) notifyTyping();
              }}
              placeholder="Compose message…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={2000}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.sendBtn,
              {
                backgroundColor: text.trim() ? Colors.primary : Colors.surface,
                borderColor: Colors.neonBorder,
                shadowColor: Colors.primary,
              },
            ]}
            onPress={handleSend}
            disabled={!text.trim()}
            activeOpacity={0.75}
          >
            <Text style={[styles.sendIcon, { color: text.trim() ? Colors.textInverse : Colors.textTertiary }]}>▶</Text>
          </TouchableOpacity>
        </View>
      </View>
      {/* Long-press context menu */}
      <Modal
        visible={contextMsg !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setContextMsg(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setContextMsg(null)}>
          <Pressable
            style={[styles.contextPanel, {
              backgroundColor: Colors.surface,
              borderColor: Colors.neonBorder,
              top: Math.min(Math.max(contextY - 70, 60), winHeight - 200),
            }]}
            onPress={() => {}}
          >
            <View style={styles.reactionsRow}>
              {REACTION_EMOJIS.map((emoji) => {
                const mine = contextMsg?.reactions?.[emoji]?.includes(String(user?.id));
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => handleReaction(emoji)}
                    style={[styles.reactionBtn, {
                      backgroundColor: mine ? Colors.neonGlow : Colors.surfaceVariant,
                      borderWidth: mine ? 1 : 0,
                      borderColor: Colors.primary,
                    }]}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {contextMsg && !contextMsg.is_deleted && (contextMsg.message_type === 'text' || !contextMsg.message_type) && (
              <>
                <View style={[styles.contextDivider, { backgroundColor: Colors.divider }]} />
                <TouchableOpacity onPress={handleForward} style={styles.contextOption}>
                  <Text style={[styles.contextOptionText, { color: Colors.text }]}>↪  Forward message</Text>
                </TouchableOpacity>
              </>
            )}
            {contextMsg?.sender === user?.id && (
              <>
                <View style={[styles.contextDivider, { backgroundColor: Colors.divider }]} />
                <TouchableOpacity onPress={handleDelete} style={styles.contextOption}>
                  <Text style={[styles.contextOptionText, { color: Colors.error }]}>🗑  Delete message</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Forward picker */}
      <Modal
        visible={forwardMsg !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setForwardMsg(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setForwardMsg(null)}>
          <Pressable
            style={[styles.forwardPanel, {
              backgroundColor: Colors.surface,
              borderColor: Colors.neonBorder,
            }]}
            onPress={() => {}}
          >
            <Text style={[styles.forwardTitle, { color: Colors.text }]}>Forward to…</Text>
            <Text style={[styles.forwardPreview, { color: Colors.textSecondary }]} numberOfLines={2}>
              {forwardMsg?.content}
            </Text>
            <View style={[styles.contextDivider, { backgroundColor: Colors.divider }]} />
            {forwardLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ paddingVertical: Spacing.lg }} />
            ) : forwardRooms.length === 0 ? (
              <Text style={[styles.forwardEmpty, { color: Colors.textTertiary }]}>
                No other rooms available.
              </Text>
            ) : (
              <FlatList
                data={forwardRooms}
                keyExtractor={(r) => r.id}
                style={{ maxHeight: winHeight * 0.5 }}
                renderItem={({ item }) => {
                  const label = item.name
                    ?? item.members_detail
                      .filter((m) => m.id !== user?.id)
                      .map((m) => m.username)
                      .join(', ');
                  return (
                    <TouchableOpacity
                      onPress={() => doForwardTo(item.id)}
                      style={styles.forwardRow}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.forwardRowText, { color: Colors.text }]} numberOfLines={1}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  connectionBar: {
    paddingVertical: Spacing.xs,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  connectionText: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 2 },

  messageList: { flex: 1 },
  messagesList: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, flexGrow: 1 },

  bubbleRow: { marginBottom: Spacing.sm },
  bubbleRowRight: { alignItems: 'flex-end' },
  bubbleRowLeft: { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    elevation: 2,
  },
  bubbleSent: {
    borderBottomRightRadius: Radius.xs ?? 4,
  },
  bubbleReceived: {
    borderBottomLeftRadius: Radius.xs ?? 4,
  },

  senderName: {
    fontSize: Font.size.xs,
    marginBottom: 2,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  messageText: {
    fontSize: Font.size.md,
    lineHeight: 22,
    letterSpacing: 0.2,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 3,
    gap: 4,
  },
  timeText: { fontSize: 10, letterSpacing: 0.3 },
  statusIcon: { fontSize: 10 },

  inputBar: {
    flexDirection: 'column',
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    // paddingBottom is set dynamically via insets.bottom
    borderTopWidth: 1,
  },
  inputRowWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  inputRow: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
  },
  typingHint: {
    position: 'absolute',
    top: -18,
    left: Spacing.md,
    fontSize: Font.size.xs,
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },
  textInput: {
    fontSize: Font.size.md,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? Spacing.md : Spacing.sm,
    letterSpacing: 0.2,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  sendIcon: { fontSize: 16, fontWeight: '700' },

  deletedText: {
    fontSize: Font.size.sm,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  reactionsDisplay: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginBottom: 2,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  reactionBadgeText: { fontSize: 13, lineHeight: 18 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  contextPanel: {
    position: 'absolute',
    left: '4%',
    width: '92%',
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    elevation: 24,
    shadowColor: '#00E5FF',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
  },
  reactionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  reactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 26 },
  contextDivider: { height: 1, marginVertical: Spacing.sm },
  contextOption: { paddingVertical: Spacing.sm, alignItems: 'center' },
  contextOptionText: { fontSize: Font.size.md, fontWeight: '600', letterSpacing: 0.5 },

  forwardPanel: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    top: '20%',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  forwardTitle: {
    fontSize: Font.size.md,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  forwardPreview: {
    fontSize: Font.size.sm,
    fontStyle: 'italic',
    marginBottom: Spacing.xs,
  },
  forwardEmpty: {
    textAlign: 'center',
    paddingVertical: Spacing.lg,
    fontSize: Font.size.sm,
  },
  forwardRow: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  forwardRowText: {
    fontSize: Font.size.md,
    fontWeight: '500',
  },

  /* ---- Reply: swipe hint, quoted block in bubble, preview strip ---- */
  swipeReplyHint: {
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: Spacing.sm,
  },
  quoteBlock: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.sm,
    paddingVertical: 4,
    paddingRight: Spacing.sm,
    marginBottom: 6,
    borderRadius: 4,
  },
  quoteName: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  quoteText: {
    fontSize: Font.size.xs,
    marginTop: 1,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  replyPreviewName: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  replyPreviewText: {
    fontSize: Font.size.xs,
    marginTop: 1,
  },
  replyPreviewClose: {
    paddingLeft: Spacing.sm,
  },
});
