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
  Modal,
  Pressable,
  useWindowDimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import dayjs from 'dayjs';
import { Font, Spacing, Radius, type ThemeColors } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useChat, WsMessage } from '../../hooks/useChat';
import { initDB, saveMessage, getMessages, deleteMessage, toggleReaction, LocalMessage } from '../../services/localMessageStore';
import { markRoomAsRead, sendMessageUpdate, markIdsAsReadInRoom, sendChatMessage } from '../../services/chatWsManager';
import { getRooms } from '../../services/chatService';
import { initiateCall } from '../../services/callService';
import { playSound } from '../../services/soundService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { useAppStore } from '../../store/appStore';
import { dismissRoomNotification } from '../../services/pushNotificationService';
import { addContact, blockUser } from '../../services/contactService';
import type { Message, RootStackParamList, ChatRoom } from '../../types';
import VoiceMessageBubble from '../../components/VoiceMessageBubble';
import SmartMessageText from '../../components/SmartMessageText';
import { persistOutgoingImage, compressImageForSend } from '../../services/voiceMessageUtils';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '👏'];

/* Voice recording tuned for speech (mono, low bitrate) so clips stay small
 * enough to ride in a single WS frame. A high-bitrate stereo clip can exceed
 * the media size cap and would otherwise get skipped by the outbox. */
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48000,
};

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
    file_uri: m.file_uri,
    duration_ms: m.duration_ms,
    sync: m.sync,
    status: m.status,
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
    file: m.file_uri ?? null,
    file_uri: m.file_uri ?? null,
    duration_ms: m.duration_ms ?? null,
    uploading: m.uploading ?? undefined,
    sync: undefined,
    status: undefined,
    is_read: m.is_read ?? false,
    created_at: m.created_at,
    reactions: m.reactions ?? {},
    is_deleted: m.is_deleted ?? false,
    reply_to: m.reply_to ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  MessageBubble — memoized row. Extracted from the screen so the      */
/*  FlatList only re-renders bubbles whose *content* actually changed   */
/*  (custom comparator below), not the whole list on every WS frame.    */
/* ------------------------------------------------------------------ */
interface MessageBubbleProps {
  item: Message;
  isMine: boolean;
  isPending: boolean;
  isDelivered: boolean;
  isRead: boolean;
  isDirectChat: boolean;
  Colors: ThemeColors;
  currentUserId?: number;
  onReply: (item: Message) => void;
  onLongPress: (pageY: number, item: Message) => void;
  onImagePress: (uri: string | null) => void;
  onReaction: (item: Message, emoji: string) => void;
}

function MessageBubbleBase({
  item,
  isMine,
  isPending,
  isDelivered,
  isRead,
  isDirectChat,
  Colors,
  currentUserId,
  onReply,
  onLongPress,
  onImagePress,
  onReaction,
}: MessageBubbleProps) {
  const isDeliveredPersisted = isMine && item.status === 'delivered';

  let statusIcon: string;
  let statusColor: string;
  if (isPending) {
    statusIcon = '⏱';
    statusColor = Colors.textTertiary;
  } else if (isRead) {
    statusIcon = '✓✓';
    statusColor = Colors.checkBlue;
  } else if (isDelivered) {
    statusIcon = '✓';
    statusColor = Colors.textTertiary;
  } else if (isDeliveredPersisted) {
    statusIcon = '✓';
    statusColor = Colors.textTertiary;
  } else {
    // Unknown local state defaults to pending to avoid false delivery ticks.
    statusIcon = '⏱';
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
          onReply(item);
          swipeable.close();
        }
      }}
    >
      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          onLongPress={(e) => {
            if (!item.is_deleted) {
              onLongPress(e.nativeEvent.pageY, item);
            }
          }}
          delayLongPress={350}
          activeOpacity={0.85}
        >
          <View style={[
            styles.bubbleWrap,
            item.reactions && Object.keys(item.reactions).length > 0 && !item.is_deleted && styles.bubbleWrapWithReactions,
          ]}>
          <View style={[
            styles.bubble,
            isMine
              ? [styles.bubbleSent, { backgroundColor: Colors.bubbleSent, borderColor: Colors.neonBorder }]
              : [styles.bubbleReceived, { backgroundColor: Colors.bubbleReceived, borderColor: Colors.divider }],
          ]}>
            {!isMine && !isDirectChat && (
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
            ) : item.message_type === 'voice' ? (
              <VoiceMessageBubble
                fileUri={item.file_uri ?? item.file ?? null}
                durationMs={item.duration_ms ?? null}
                loading={!(item.file_uri || item.file)}
                tint={Colors.primary}
                subtleColor={Colors.textSecondary}
                trackBg={Colors.surfaceVariant}
              />
            ) : item.message_type === 'image' && (item.file_uri || item.file) ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onImagePress(item.file_uri ?? item.file ?? null)}
                onLongPress={(e) => {
                  if (!item.is_deleted) {
                    onLongPress(e.nativeEvent.pageY, item);
                  }
                }}
                delayLongPress={350}
              >
                <ExpoImage
                  source={{ uri: item.file_uri ?? item.file ?? '' }}
                  style={styles.imageBubble}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={100}
                  recyclingKey={item.id}
                />
                {item.uploading && (
                  <View style={styles.mediaOverlay}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.mediaOverlayText}>Uploading…</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : item.message_type === 'image' ? (
              // Received image whose bytes haven't arrived yet (streaming over
              // chunks). Show a receiving placeholder until it hydrates.
              <View style={[styles.imageBubble, styles.mediaPlaceholder, { backgroundColor: Colors.surfaceVariant }]}>
                <ActivityIndicator color={Colors.primary} />
                <Text style={[styles.mediaPlaceholderText, { color: Colors.textSecondary }]}>Receiving…</Text>
              </View>
            ) : (
              <SmartMessageText
                style={[styles.messageText, { color: Colors.text }]}
                linkColor={Colors.primary}
              >
                {item.content}
              </SmartMessageText>
            )}
            {__DEV__ && isMine && !item.is_deleted && (
              <Text
                style={[
                  styles.syncDebugText,
                  { color: item.sync ? Colors.success : Colors.warning },
                ]}
              >
                {item.sync ? 'SYNC OK' : 'SYNC PENDING'}
              </Text>
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
          {!item.is_deleted && item.reactions && Object.keys(item.reactions).length > 0 && (
            <View
              style={[styles.reactionsOverlay, styles.reactionsOverlayLeft]}
            >
              {Object.entries(item.reactions).map(([emoji, users]) => {
                const mine = users.includes(String(currentUserId));
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => onReaction(item, emoji)}
                    style={[styles.reactionBadge, {
                      backgroundColor: mine ? Colors.neonGlow : Colors.surface,
                      borderColor: mine ? Colors.primary : Colors.neonBorder,
                      shadowColor: Colors.primary,
                    }]}
                  >
                    <Text style={styles.reactionEmojiInBadge}>{emoji}</Text>
                    <Text
                      style={[
                        styles.reactionBadgeText,
                        { color: mine ? Colors.primary : Colors.text },
                      ]}
                    >
                      {users.length}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          </View>
        </TouchableOpacity>
      </View>
    </Swipeable>
  );
}

/** Only re-render a bubble when its own content/state changed. */
function areBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (
    prev.isMine !== next.isMine ||
    prev.isPending !== next.isPending ||
    prev.isDelivered !== next.isDelivered ||
    prev.isRead !== next.isRead ||
    prev.isDirectChat !== next.isDirectChat ||
    prev.Colors !== next.Colors ||
    prev.currentUserId !== next.currentUserId ||
    prev.onReply !== next.onReply ||
    prev.onLongPress !== next.onLongPress ||
    prev.onImagePress !== next.onImagePress ||
    prev.onReaction !== next.onReaction
  ) {
    return false;
  }
  const a = prev.item;
  const b = next.item;
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.message_type === b.message_type &&
    a.file === b.file &&
    a.file_uri === b.file_uri &&
    a.duration_ms === b.duration_ms &&
    a.uploading === b.uploading &&
    a.is_read === b.is_read &&
    a.is_deleted === b.is_deleted &&
    a.status === b.status &&
    a.sync === b.sync &&
    a.sender === b.sender &&
    a.sender_username === b.sender_username &&
    a.created_at === b.created_at &&
    JSON.stringify(a.reactions) === JSON.stringify(b.reactions) &&
    JSON.stringify(a.reply_to) === JSON.stringify(b.reply_to)
  );
}

const MessageBubble = React.memo(MessageBubbleBase, areBubblePropsEqual);

export default function ChatRoomScreen({ route, navigation }: Props) {
  const { roomId, otherUserId } = route.params;
  const isDirectChat = !!otherUserId;
  const { user } = useAuth();
  const { messages: wsMessages, sendMessage, connected, readIds, pendingIds, deliveredIds, markIdsAsRead, markIdsAsDelivered, reconnectCount, lastMutationAt, typers, notifyTyping } = useChat(roomId, user?.id);
  const isMuted = useAppStore((s) => !!s.mutedRooms[roomId]);
  /** True when the other user in a direct chat is not yet in our contacts.
   *  Shows the "wants to talk to you" accept/block banner above the message list. */
  const isMessageRequest = useAppStore((s) => {
    if (!otherUserId) return false;
    if (s.contactIds[otherUserId]) return false;
    if (s.blockedIds[otherUserId]) return false;
    return true;
  });
  const [requestBusy, setRequestBusy] = useState(false);
  const { subscribe } = useNotificationContext();
  const { colors: Colors } = useTheme();
  const { confirm, alert } = useConfirm();
  const { ensure: ensurePermission } = usePermissionPrompt();

  // Mark this room as the active one in the global store while the screen is mounted.
  // Other systems (notification routing, foreground service, etc.) read this to
  // decide whether to show in-app vs. push notifications.
  useEffect(() => {
    useAppStore.getState().setActiveRoom(roomId);
    // Clear any grouped notification for this conversation now that it's open.
    // Both the Expo (WS path) and Notifee MessagingStyle (killed-app FCM path).
    dismissRoomNotification(roomId).catch(() => {});
    import('../../services/messageNotificationService')
      .then((m) => m.cancelMessageNotification(roomId))
      .catch(() => {});
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

  /* ---- Voice message recording state ---- */
  const audioRecorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);

  /* ---- Image attachment state ---- */
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [fullscreenImageUri, setFullscreenImageUri] = useState<string | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRecordingRef = useRef(false);
  /** Horizontal drag distance (negative = leftward) during a recording gesture. */
  const slideX = useRef(new Animated.Value(0)).current;
  /** Pulsing red dot scale. */
  const pulseScale = useRef(new Animated.Value(1)).current;
  /** Distance the user has to drag left before the recording is cancelled. */
  const CANCEL_THRESHOLD_PX = 90;
  const flatListRef = useRef<FlatList>(null);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  /* Load (or reload) messages from the local SQLite DB */
  const loadFromDB = useCallback(async (cancelled?: { current: boolean }) => {
    const dbMsgs = await getMessages(roomId);
    if (__DEV__) console.log('[ChatRoom] SQLite →', dbMsgs.length, 'msgs for room', roomId);
    if (cancelled?.current) return;
    setSqliteMessages(dbMsgs.map(toMsg));
    // Pre-populate readIds from is_read=1 rows persisted in SQLite (survives app restarts).
    const persistedReadIds = dbMsgs.filter(m => m.is_mine && m.is_read).map(m => m.id);
    if (persistedReadIds.length > 0) markIdsAsReadInRoom(roomId, persistedReadIds);
    // Send read receipts only for messages not yet marked read in SQLite.
    // Filtering out already-read messages prevents re-sending on every reload.
    // Media whose file hasn't been downloaded yet is NOT marked read — the
    // sender's ✓✓ (read) should only appear once the receiver actually has the
    // file. Once the media hydrates, loadFromDB re-runs and sends the receipt.
    const isIncompleteMedia = (m: LocalMessage) =>
      (m.type === 'voice' || m.type === 'image' || m.type === 'video') && !m.file_uri;
    const idsFromOthers = dbMsgs
      .filter(m => !m.is_mine && !m.is_read && !isIncompleteMedia(m))
      .map(m => m.id);
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
        // Re-attempt any out-of-band media downloads missed while the app was
        // away (killed/backgrounded when the pointer first arrived).
        import('../../services/ingressRouter')
          .then((m) => m.retryPointerDownloads(roomId))
          .catch(() => {});
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
    // Re-apply local SQLite metadata that WS snapshots don't carry (sync), and
    // for historical-only messages also preserve reactions/deletes.
    for (const [id, msg] of byId) {
      const sql = sqliteById.get(id);
      if (!sql) continue;
      if (wsIdSet.has(id)) {
        // The live WS snapshot wins for freshness, but it can lack media fields
        // that only exist on disk (e.g. a received media file decoded/hydrated
        // AFTER the snapshot was taken). Fall back to the SQLite values so the
        // image/voice bubble keeps rendering instead of showing a placeholder.
        const withMedia: Message = {
          ...msg,
          file: msg.file ?? sql.file,
          file_uri: msg.file_uri ?? sql.file_uri,
          duration_ms: msg.duration_ms ?? sql.duration_ms,
        };
        if (withMedia.sync === undefined) {
          byId.set(id, { ...withMedia, sync: sql.sync, status: withMedia.status ?? sql.status });
        } else if (withMedia.status === undefined) {
          byId.set(id, { ...withMedia, status: sql.status });
        } else {
          byId.set(id, withMedia);
        }
        continue;
      }
      if (
        msg.sync === undefined ||
        sql.is_deleted ||
        Object.keys(sql.reactions ?? {}).length > 0
      ) {
        byId.set(id, {
          ...msg,
          sync: msg.sync ?? sql.sync,
          status: msg.status ?? sql.status,
          reactions: sql.reactions,
          is_deleted: sql.is_deleted,
        });
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [sqliteMessages, wsMessages, roomId]);

  /* ── Apply read-receipt overlay ── */
  const displayedMsgs = useMemo(
    () => allMessages.map(m => ({ ...m, is_read: m.is_read || readIds.has(m.id) })),
    [allMessages, readIds],
  );

  /* Inverted FlatList needs newest-first. Memoize so we don't rebuild the
     array (and force a full re-render) on every unrelated render. */
  const reversedMsgs = useMemo(() => [...displayedMsgs].reverse(), [displayedMsgs]);

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
    Keyboard.dismiss();
    if (!otherUserId) { alert('Info', 'Calls are only available in direct chats'); return; }
    // A call needs the mic (always) and the camera (video). Ask up front so the
    // call doesn't silently fail when WebRTC can't get the media tracks.
    const ok = await ensurePermission(callType === 'video' ? 'camera+microphone' : 'microphone');
    if (!ok) return;
    try {
      const res = await initiateCall(otherUserId, callType);
      navigation.navigate('ActiveCall', {
        callId: res.call_id, otherName: route.params.roomName,
        callType, roomName: res.room_name, isOutgoing: true, peerUserId: otherUserId,
      });
    } catch { alert('Error', 'Failed to start call'); }
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

  /* ---- Voice recording: start / stop / cancel ---- */
  const startVoiceRecording = useCallback(async () => {
    try {
      const granted = await ensurePermission('microphone');
      if (!granted) return;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      cancelRecordingRef.current = false;
      recordingStartedAtRef.current = Date.now();
      setRecordingMs(0);
      setIsRecording(true);
      slideX.setValue(0);
      // Pulse the red dot
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.4, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      // Tick timer
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - recordingStartedAtRef.current);
      }, 100);
    } catch (err) {
      console.warn('[ChatRoom] failed to start recording:', err);
      setIsRecording(false);
    }
  }, [audioRecorder, slideX, pulseScale, ensurePermission]);

  const finishVoiceRecording = useCallback(async (cancelled: boolean) => {
    // Stop UI immediately so user gets feedback
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    pulseScale.stopAnimation();
    pulseScale.setValue(1);
    Animated.timing(slideX, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    const durationMs = Date.now() - recordingStartedAtRef.current;
    setIsRecording(false);

    try {
      await audioRecorder.stop();
    } catch (err) {
      console.warn('[ChatRoom] recorder.stop failed:', err);
    }
    // Restore default audio session (no recording mode)
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});

    const uri = audioRecorder.uri;
    // Cancel — or clip was too short (<400ms) to be useful
    if (cancelled || !uri || durationMs < 400) {
      return;
    }
    const reply = replyingTo
      ? {
          id: replyingTo.id,
          sender_name: replyingTo.sender_username || '',
          content: (replyingTo.content ?? '').slice(0, 140),
          type: replyingTo.message_type,
        }
      : null;
    sendMessage('🎤 Voice message', 'voice', reply, {
      file_uri: uri,
      duration_ms: durationMs,
      audio_mime: 'audio/m4a',
    });
    setReplyingTo(null);
    playSound('message_sent');
  }, [audioRecorder, slideX, pulseScale, replyingTo, sendMessage]);

  /* ---- Image attachment handlers ---- */
  /** Pick an asset from the camera or library, persist it, and send. */
  const sendPickedImage = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!asset?.uri) return;
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Compress/resize first so the photo rides in a single WS frame reliably,
    // then persist our own copy so it survives picker cleanup and retries.
    const compressed = await compressImageForSend(asset.uri, asset.width, asset.height);
    let localUri = compressed.uri;
    try {
      localUri = await persistOutgoingImage(msgId, compressed.uri, compressed.mime);
    } catch (err) {
      console.warn('[ChatRoomScreen] failed to persist outgoing image:', err);
    }
    const reply = replyingTo
      ? {
          id: replyingTo.id,
          sender_name: replyingTo.sender_username || '',
          content: (replyingTo.content ?? '').slice(0, 140),
          type: replyingTo.message_type,
        }
      : null;
    await sendMessage('\uD83D\uDCF7 Photo', 'image', reply, {
      file_uri: localUri,
      image_mime: compressed.mime,
    });
    setReplyingTo(null);
    playSound('message_sent');
  }, [replyingTo, sendMessage]);

  const handlePickFromCamera = useCallback(async () => {
    setAttachMenuOpen(false);
    try {
      const granted = await ensurePermission('camera');
      if (!granted) return;
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        await sendPickedImage(result.assets[0]);
      }
    } catch (err) {
      console.warn('[ChatRoomScreen] camera error:', err);
    }
  }, [sendPickedImage, ensurePermission]);

  const handlePickFromGallery = useCallback(async () => {
    setAttachMenuOpen(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        alert('Photo library permission required', 'Please enable photo access in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        await sendPickedImage(result.assets[0]);
      }
    } catch (err) {
      console.warn('[ChatRoomScreen] gallery error:', err);
    }
  }, [sendPickedImage]);

  /* PanResponder bound to the mic button. Long-press → record. Drag left
     past CANCEL_THRESHOLD_PX → cancel. Release → send. */
  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      // Start recording after a short long-press delay (300ms)
      cancelRecordingRef.current = false;
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        startVoiceRecording();
      }, 300);
    },
    onPanResponderMove: (_evt, gesture) => {
      if (!isRecordingRef.current) return;
      // Only track leftward drag, clamp to twice the cancel threshold so the icon
      // doesn't fly off the screen if the user keeps dragging.
      const dx = Math.min(0, Math.max(-CANCEL_THRESHOLD_PX * 2, gesture.dx));
      slideX.setValue(dx);
      if (dx <= -CANCEL_THRESHOLD_PX && !cancelRecordingRef.current) {
        cancelRecordingRef.current = true;
      } else if (dx > -CANCEL_THRESHOLD_PX && cancelRecordingRef.current) {
        cancelRecordingRef.current = false;
      }
    },
    onPanResponderRelease: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (isRecordingRef.current) {
        finishVoiceRecording(cancelRecordingRef.current);
      }
    },
    onPanResponderTerminate: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (isRecordingRef.current) {
        finishVoiceRecording(true);
      }
    },
  }), [startVoiceRecording, finishVoiceRecording, slideX]);

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (isRecordingRef.current) {
        try { audioRecorder.stop(); } catch {}
      }
    };
  }, [audioRecorder]);

  const handleReaction = useCallback(async (emoji: string) => {
    if (!contextMsg || !user) return;
    const msgId = contextMsg.id;
    setContextMsg(null);
    const newReactions = await toggleReaction(msgId, emoji, String(user.id));
    // Update in-memory WS state + relay to other members (reacted_emoji is a display hint)
    sendMessageUpdate(roomId, msgId, { reactions: newReactions, reacted_emoji: emoji });
  }, [contextMsg, user, roomId, loadFromDB]);

  const handleCopy = useCallback(async () => {
    if (!contextMsg) return;
    const text = contextMsg.content ?? '';
    setContextMsg(null);
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
    } catch { /* ignore */ }
  }, [contextMsg]);

  const handleDelete = useCallback(() => {
    if (!contextMsg) return;
    const msgId = contextMsg.id;
    setContextMsg(null);
    confirm({
      title: 'Delete message',
      message: 'This message will be removed for you only.',
      icon: 'trash-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteMessage(msgId);
          // Update in-memory WS state + relay to other members
          sendMessageUpdate(roomId, msgId, { is_deleted: true });
        }},
      ],
    });
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
      const type = (msg.message_type as string) || 'text';
      // For media, carry the local file so the forward actually re-sends the
      // picture / voice (re-read + relayed inline or chunked as needed).
      const extras =
        type === 'image'
          ? { file_uri: msg.file_uri ?? msg.file ?? null, image_mime: 'image/jpeg' }
          : type === 'voice'
            ? { file_uri: msg.file_uri ?? msg.file ?? null, duration_ms: msg.duration_ms ?? null, audio_mime: 'audio/m4a' }
            : null;
      await sendChatMessage(targetRoomId, msg.content ?? '', type, null, extras);
      playSound('message_sent');
    } catch { /* ignore — saved locally */ }
  }, [forwardMsg]);

  /* ── Stable per-row callbacks so memoized MessageBubble rows don't re-render ── */
  const handleReply = useCallback((m: Message) => {
    setReplyingTo(m);
  }, []);

  const handleBubbleLongPress = useCallback((pageY: number, m: Message) => {
    setContextY(pageY);
    setContextMsg(m);
  }, []);

  const handleImagePress = useCallback((uri: string | null) => {
    setFullscreenImageUri(uri);
  }, []);

  const handleReactionToggle = useCallback(async (m: Message, emoji: string) => {
    const newReactions = await toggleReaction(m.id, emoji, String(user?.id ?? ''));
    sendMessageUpdate(roomId, m.id, { reactions: newReactions, reacted_emoji: emoji });
  }, [roomId, user?.id]);

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isMine = item.sender === user?.id;
    const isPending = isMine && pendingIds.has(item.id);
    const isDelivered = isMine && deliveredIds.has(item.id);
    const isRead = isMine && (item.is_read || readIds.has(item.id) || item.status === 'read');
    return (
      <MessageBubble
        item={item}
        isMine={isMine}
        isPending={isPending}
        isDelivered={isDelivered}
        isRead={isRead}
        isDirectChat={isDirectChat}
        Colors={Colors}
        currentUserId={user?.id}
        onReply={handleReply}
        onLongPress={handleBubbleLongPress}
        onImagePress={handleImagePress}
        onReaction={handleReactionToggle}
      />
    );
  }, [user?.id, pendingIds, deliveredIds, readIds, isDirectChat, Colors, handleReply, handleBubbleLongPress, handleImagePress, handleReactionToggle]);

  const handleAcceptRequest = useCallback(async () => {
    if (!otherUserId || requestBusy) return;
    setRequestBusy(true);
    try {
      await addContact(otherUserId);
      useAppStore.getState().addContactId(otherUserId);
    } catch (err: any) {
      // Likely 400 because the contact already exists — treat that as accepted.
      if (err?.response?.status === 400) {
        useAppStore.getState().addContactId(otherUserId);
      } else {
        alert('Could not accept', 'Please try again.');
      }
    } finally {
      setRequestBusy(false);
    }
  }, [otherUserId, requestBusy]);

  const handleBlockRequest = useCallback(() => {
    if (!otherUserId || requestBusy) return;
    confirm({
      title: 'Block this user?',
      message: 'You will not receive any further messages or calls from them.',
      icon: 'ban-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setRequestBusy(true);
            try {
              await blockUser(otherUserId);
              useAppStore.getState().addBlockedId(otherUserId);
              navigation.goBack();
            } catch {
              alert('Could not block', 'Please try again.');
              setRequestBusy(false);
            }
          },
        },
      ],
    });
  }, [otherUserId, requestBusy, navigation]);

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

      {isMessageRequest && (
        <View style={[styles.requestBanner, {
          backgroundColor: Colors.surface,
          borderColor: Colors.primary,
        }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.requestTitle, { color: Colors.text }]} numberOfLines={1}>
              {route.params.roomName || 'This user'} wants to talk to you
            </Text>
            <Text style={[styles.requestSubtitle, { color: Colors.textSecondary }]} numberOfLines={2}>
              They are not in your contacts. Accept to chat, or block to stop messages.
            </Text>
          </View>
          <View style={styles.requestActions}>
            <TouchableOpacity
              disabled={requestBusy}
              onPress={handleBlockRequest}
              style={[styles.requestBtn, { borderColor: Colors.error, opacity: requestBusy ? 0.5 : 1 }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.requestBtnText, { color: Colors.error }]}>Block</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={requestBusy}
              onPress={handleAcceptRequest}
              style={[styles.requestBtnPrimary, { backgroundColor: Colors.primary, opacity: requestBusy ? 0.5 : 1 }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.requestBtnText, { color: Colors.textInverse }]}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={reversedMsgs}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.messageList}
        contentContainerStyle={styles.messagesList}
        inverted
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
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
          {!isRecording && (
            <TouchableOpacity
              onPress={() => setAttachMenuOpen(true)}
              activeOpacity={0.75}
              accessibilityLabel="Attach"
              style={[
                styles.attachBtn,
                {
                  backgroundColor: Colors.surface,
                  borderColor: Colors.neonBorder,
                  shadowColor: Colors.primary,
                },
              ]}
            >
              <Ionicons name="add" size={24} color={Colors.text} />
            </TouchableOpacity>
          )}
          {isRecording ? (
            <Animated.View style={[
              styles.recordingTray,
              {
                backgroundColor: Colors.surface,
                borderColor: Colors.neonBorder,
                transform: [{ translateX: slideX }],
              },
            ]}>
              <Animated.View style={[
                styles.recordingDot,
                {
                  backgroundColor: cancelRecordingRef.current ? Colors.textTertiary : '#FF3B30',
                  transform: [{ scale: pulseScale }],
                },
              ]} />
              <Text style={[styles.recordingTime, { color: Colors.text }]}>
                {(() => {
                  const total = Math.floor(recordingMs / 1000);
                  const m = Math.floor(total / 60);
                  const s = total % 60;
                  return `${m}:${s.toString().padStart(2, '0')}`;
                })()}
              </Text>
              <Text style={[styles.recordingHint, { color: Colors.textSecondary }]}>
                <Ionicons name="chevron-back" size={14} color={Colors.textSecondary} />
                {' '}Slide to cancel
              </Text>
            </Animated.View>
          ) : (
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
          )}
          {text.trim().length > 0 ? (
            <TouchableOpacity
              style={[
                styles.sendBtn,
                {
                  backgroundColor: Colors.primary,
                  borderColor: Colors.neonBorder,
                  shadowColor: Colors.primary,
                },
              ]}
              onPress={handleSend}
              activeOpacity={0.75}
            >
              <Text style={[styles.sendIcon, { color: Colors.textInverse }]}>▶</Text>
            </TouchableOpacity>
          ) : (
            <View
              {...micPan.panHandlers}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: isRecording ? '#FF3B30' : Colors.surface,
                  borderColor: isRecording ? '#FF3B30' : Colors.neonBorder,
                  shadowColor: isRecording ? '#FF3B30' : Colors.primary,
                },
              ]}
            >
              <Ionicons
                name="mic"
                size={22}
                color={isRecording ? Colors.textInverse : Colors.text}
              />
            </View>
          )}
        </View>
      </View>
      {/* Attachment menu */}
      <Modal
        visible={attachMenuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAttachMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAttachMenuOpen(false)}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.attachSheet,
              {
                backgroundColor: Colors.surface,
                borderColor: Colors.neonBorder,
                // Push the sheet above the system nav bar (3-button bar /
                // home indicator) so the Cancel row isn't covered.
                marginBottom: Spacing.xl + insets.bottom,
              },
            ]}
          >
            <TouchableOpacity style={styles.attachRow} onPress={handlePickFromCamera} activeOpacity={0.7}>
              <Ionicons name="camera" size={22} color={Colors.primary} />
              <Text style={[styles.attachLabel, { color: Colors.text }]}>Camera</Text>
            </TouchableOpacity>
            <View style={[styles.attachDivider, { backgroundColor: Colors.border }]} />
            <TouchableOpacity style={styles.attachRow} onPress={handlePickFromGallery} activeOpacity={0.7}>
              <Ionicons name="images" size={22} color={Colors.primary} />
              <Text style={[styles.attachLabel, { color: Colors.text }]}>Photo Library</Text>
            </TouchableOpacity>
            <View style={[styles.attachDivider, { backgroundColor: Colors.border }]} />
            <TouchableOpacity style={styles.attachRow} onPress={() => setAttachMenuOpen(false)} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
              <Text style={[styles.attachLabel, { color: Colors.textTertiary }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      {/* Fullscreen image viewer */}
      <Modal
        visible={fullscreenImageUri !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setFullscreenImageUri(null)}
      >
        <Pressable style={styles.fullscreenBackdrop} onPress={() => setFullscreenImageUri(null)}>
          {fullscreenImageUri && (
            <ExpoImage
              source={{ uri: fullscreenImageUri }}
              style={styles.fullscreenImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
        </Pressable>
      </Modal>
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
                <TouchableOpacity onPress={handleCopy} style={styles.contextOption}>
                  <Text style={[styles.contextOptionText, { color: Colors.text }]}>📋  Copy message</Text>
                </TouchableOpacity>
              </>
            )}
            {contextMsg && !contextMsg.is_deleted && (
              contextMsg.message_type === 'text' || !contextMsg.message_type
              || ((contextMsg.message_type === 'image' || contextMsg.message_type === 'voice')
                  && !!(contextMsg.file_uri || contextMsg.file))
            ) && (
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
                  // Direct rooms have name === '' (empty string, not null), so
                  // `??` wouldn't fall back — check for a non-blank name first,
                  // otherwise build a label from the other members' usernames.
                  const named = item.name && item.name.trim();
                  const label = named
                    ? item.name
                    : (item.members_detail ?? [])
                        .filter((m) => m.id !== user?.id)
                        .map((m) => m.username)
                        .join(', ') || 'Chat';
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

  /* ---- Contact / message-request banner ---- */
  requestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },
  requestTitle: {
    fontSize: Font.size.sm,
    fontWeight: '700',
  },
  requestSubtitle: {
    fontSize: Font.size.xs,
    marginTop: 2,
  },
  requestActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  requestBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  requestBtnPrimary: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
  },
  requestBtnText: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 1,
  },

  messageList: { flex: 1 },
  messagesList: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, flexGrow: 1 },

  bubbleRow: { marginBottom: Spacing.md },
  bubbleRowRight: { alignItems: 'flex-end' },
  bubbleRowLeft: { alignItems: 'flex-start' },

  bubble: {
    minWidth: 96,
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
  syncDebugText: {
    marginTop: 4,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'right',
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
    flexDirection: 'row',
    alignItems: 'center',
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
    flex: 1,
    fontSize: Font.size.md,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? Spacing.md : Spacing.sm,
    letterSpacing: 0.2,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  attachSheet: {
    marginTop: 'auto',
    marginBottom: Spacing.xl,
    marginHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Spacing.sm,
  },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  attachLabel: {
    fontSize: Font.size.md,
    letterSpacing: 0.3,
  },
  attachDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
  },
  imageBubble: {
    width: 220,
    height: 220,
    borderRadius: Radius.sm,
    backgroundColor: '#0002',
  },
  mediaPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  mediaPlaceholderText: {
    fontSize: Font.size.sm,
    letterSpacing: 0.3,
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: Radius.sm,
  },
  mediaOverlayText: {
    color: '#fff',
    fontSize: Font.size.sm,
    letterSpacing: 0.3,
  },
  fullscreenBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
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
  /**
   * Reactions chip strip is rendered AFTER the bubble inside `bubbleWrap` and
   * pulled upward so it overlaps the bubble's bottom edge — like iMessage /
   * WhatsApp. We only reserve the extra bottom space when reactions exist so
   * empty bubbles don't get a phantom gap.
   */
  bubbleWrap: {
    maxWidth: '80%',
  },
  bubbleWrapWithReactions: {
    paddingBottom: 12,
  },
  reactionsOverlay: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  reactionsOverlayRight: {
    right: 8,
  },
  reactionsOverlayLeft: {
    left: 8,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  reactionBadgeText: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginLeft: 3 },
  reactionEmojiInBadge: { fontSize: 13, lineHeight: 18 },

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

  /* ---- Voice recording overlay (replaces inputRow while recording) ---- */
  recordingTray: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    borderWidth: 1,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.sm,
  },
  recordingTime: {
    fontSize: Font.size.md,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    marginRight: Spacing.md,
  },
  recordingHint: {
    flex: 1,
    textAlign: 'right',
    fontSize: Font.size.xs,
    letterSpacing: 0.3,
  },
});
