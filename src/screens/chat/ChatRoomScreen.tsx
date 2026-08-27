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
  Linking,
  AppState,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Font, Spacing, Radius } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useChat, WsMessage } from '../../hooks/useChat';
import { initDB, saveMessage, getCachedRooms, getRecentMessages, getMessagesBefore, getMessagesByIds, deleteMessage, toggleReaction, LocalMessage, setCachedRelationship } from '../../services/localMessageStore';
import { markRoomAsRead, sendMessageUpdate, markIdsAsReadInRoom, retryOutgoingMessage, sendChatMessage, type SendChatResult } from '../../services/chatWsManager';
import { getRooms } from '../../services/chatService';
import { initiateCall } from '../../services/callService';
import { playSound } from '../../services/soundService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { useAppStore } from '../../store/appStore';
import { dismissRoomNotification } from '../../services/pushNotificationService';
import { addContact, blockUser } from '../../services/contactService';
import type { Message, RootStackParamList, ChatRoom } from '../../types';
import { getFirstMessageUrl } from '../../components/SmartMessageText';
import ExtractedMessageBubble from '../../components/chat/MessageBubble';
import { persistOutgoingImage, persistSharedFile, compressImageForSend } from '../../services/voiceMessageUtils';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import { mediaFileSize } from '../../services/mediaLane';
import { mapWithConcurrency, MEDIA_BATCH_CONCURRENCY, validateMediaSize } from '../../services/mediaTransferPolicy';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '👏'];
const LOCAL_HISTORY_PAGE_SIZE = 60;

/** Compact header signal shown while the room socket is reconnecting. */
function SyncingHeaderTitle({ title, syncing, color }: { title: string; syncing: boolean; color: string }) {
  const letters = useMemo(() => Array.from(title.slice(0, 24)), [title]);
  const pulses = useRef(letters.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!syncing) {
      pulses.forEach((pulse) => pulse.setValue(0));
      return;
    }
    const wave = Animated.loop(
      Animated.sequence([
        Animated.stagger(45, pulses.map((pulse) => Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 240, useNativeDriver: true }),
        ]))),
        Animated.delay(350),
      ]),
    );
    wave.start();
    return () => wave.stop();
  }, [syncing, pulses]);

  return (
    <View style={styles.syncHeaderTitle} accessibilityLabel={syncing ? `${title}, syncing` : title}>
      <View style={styles.syncLetters}>
        {letters.map((letter, index) => (
          <Animated.Text
            key={`${letter}-${index}`}
            style={[styles.syncHeaderLetter, {
              color,
              opacity: syncing ? pulses[index].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) : 1,
              transform: [{ translateY: syncing ? pulses[index].interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) : 0 }],
            }]}
          >
            {letter}
          </Animated.Text>
        ))}
      </View>
    </View>
  );
}

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
    transfer_error_code: m.transfer_error_code ?? null,
    transfer_error_message: m.transfer_error_message ?? null,
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
    transfer_error_code: m.transfer_error_code ?? null,
    transfer_error_message: m.transfer_error_message ?? null,
    sync: undefined,
    status: undefined,
    is_read: m.is_read ?? false,
    created_at: m.created_at,
    reactions: m.reactions ?? {},
    is_deleted: m.is_deleted ?? false,
    reply_to: m.reply_to ?? null,
  };
}

export default function ChatRoomScreen({ route, navigation }: Props) {
  const { roomId, otherUserId } = route.params;
  const isScreenFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [retryStartedAtById, setRetryStartedAtById] = useState<Record<string, number>>({});
  // `otherUserId` is navigation context, not room metadata.  A group opened
  // from a notification has the sender id populated too, so use the locally
  // cached room type as the authority for group-only message UI.
  const [isGroupChat, setIsGroupChat] = useState(!otherUserId);
  const isDirectChat = !isGroupChat;
  const { user } = useAuth();
  const { messages: wsMessages, sendMessage, connected, readIds, pendingIds, deliveredIds, markIdsAsRead, markIdsAsDelivered, reconnectCount, lastMutationAt, lastMutationIds, typers, notifyTyping } = useChat(roomId, user?.id);
  const isMuted = useAppStore((s) => !!s.mutedRooms[roomId]);
  /** True when the other user in a direct chat is not yet in our contacts.
   *  Shows the "wants to talk to you" accept/block banner above the message list. */
  const isMessageRequest = useAppStore((s) => {
    if (!isDirectChat) return false;
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

  useEffect(() => {
    let cancelled = false;
    const resolveRoomType = async () => {
      const cached = user?.id != null
        ? await getCachedRooms(user.id).catch(() => [] as ChatRoom[])
        : [] as ChatRoom[];
      let room = cached.find((entry) => entry.id === roomId);
      if (!room) {
        const remote = await getRooms().catch(() => [] as ChatRoom[]);
        room = remote.find((entry) => entry.id === roomId);
      }
      if (!cancelled && room) setIsGroupChat(room.room_type === 'group');
    };
    resolveRoomType().catch(() => {});
    return () => { cancelled = true; };
  }, [roomId, user?.id]);

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
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [contextMsg, setContextMsg] = useState<Message | null>(null);
  const [contextY,   setContextY]   = useState(0);
  /** Message currently being forwarded — when set, the room-picker modal is shown. */
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [forwardRooms, setForwardRooms] = useState<ChatRoom[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  /** Message currently being replied to — when set, shows a preview strip above the input. */
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const { height: winHeight } = useWindowDimensions();
  const fullWindowHeightRef = useRef(winHeight);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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
  const loadedHistoryLimitRef = useRef(LOCAL_HISTORY_PAGE_SIZE);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  /* Android 15+ enforces edge-to-edge layout. On some production devices
   * adjustResize shrinks the React window; on others it only dispatches IME
   * insets. Track both signals and add only the portion the OS did not already
   * consume. This keeps the composer above the keyboard without double-lifting
   * it on devices where native resize works correctly. */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height));
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardHeight === 0) {
      fullWindowHeightRef.current = Math.max(fullWindowHeightRef.current, winHeight);
    }
  }, [keyboardHeight, winHeight]);

  const androidNativeResize = Platform.OS === 'android' && keyboardHeight > 0
    ? Math.max(0, fullWindowHeightRef.current - winHeight)
    : 0;
  const androidKeyboardInset = Platform.OS === 'android' && keyboardHeight > 0
    ? Math.max(0, keyboardHeight - androidNativeResize)
    : 0;
  const composerBottomPadding = Platform.OS === 'android' && keyboardHeight > 0
    ? Spacing.sm + androidKeyboardInset
    : insets.bottom + Spacing.sm;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  /* Load (or reload) messages from the local SQLite DB */
  const loadFromDB = useCallback(async (cancelled?: { current: boolean }) => {
    const dbMsgs = await getRecentMessages(roomId, loadedHistoryLimitRef.current);
    if (__DEV__) console.log('[ChatRoom] SQLite →', dbMsgs.length, 'msgs for room', roomId);
    if (cancelled?.current) return;
    setSqliteMessages(dbMsgs.map(toMsg));
    setHasOlderMessages(dbMsgs.length >= loadedHistoryLimitRef.current);
    // Pre-populate readIds from is_read=1 rows persisted in SQLite (survives app restarts).
    const persistedReadIds = dbMsgs.filter(m => m.is_mine && m.is_read).map(m => m.id);
    if (persistedReadIds.length > 0) markIdsAsReadInRoom(roomId, persistedReadIds);
    // Send read receipts only for messages not yet marked read in SQLite.
    // Filtering out already-read messages prevents re-sending on every reload.
    // Media whose file hasn't been downloaded yet is NOT marked read — the
    // sender's ✓✓ (read) should only appear once the receiver actually has the
    // file. Once the media hydrates, loadFromDB re-runs and sends the receipt.
    const isIncompleteMedia = (m: LocalMessage) =>
      (m.type === 'voice' || m.type === 'image' || m.type === 'video' || m.type === 'document') && !m.file_uri;
    const idsFromOthers = dbMsgs
      .filter(m => !m.is_mine && !m.is_read && !isIncompleteMedia(m))
      .map(m => m.id);
    // A mounted room can remain subscribed while Android backgrounds/freezes
    // the app. Receipt semantics must mean "the user could see this", not just
    // "the screen component still exists in memory". On resume/focus this
    // callback is recreated and the unread rows are marked then.
    if (idsFromOthers.length > 0 && isScreenFocused && appState === 'active') {
      markRoomAsRead(roomId, idsFromOthers);
    }
  }, [roomId, isScreenFocused, appState]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages || !hasOlderMessages) return;
    const oldest = sqliteMessages[0]?.created_at;
    if (!oldest) {
      setHasOlderMessages(false);
      return;
    }
    setLoadingOlderMessages(true);
    try {
      const older = await getMessagesBefore(roomId, oldest, LOCAL_HISTORY_PAGE_SIZE);
      if (older.length === 0) {
        setHasOlderMessages(false);
        return;
      }
      loadedHistoryLimitRef.current += older.length;
      setSqliteMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        older.map(toMsg).forEach((message) => byId.set(message.id, message));
        return Array.from(byId.values()).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
      if (older.length < LOCAL_HISTORY_PAGE_SIZE) setHasOlderMessages(false);
    } catch {
      // Local history remains usable; the user can scroll again to retry.
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [roomId, sqliteMessages, loadingOlderMessages, hasOlderMessages]);

  /* ── Initial load from SQLite ── */
  useEffect(() => {
    const cancel = { current: false };
    (async () => {
      try {
        loadedHistoryLimitRef.current = LOCAL_HISTORY_PAGE_SIZE;
        setHasOlderMessages(true);
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

  /* ── Refresh only the mutated local rows (never re-read an entire room). ── */
  const prevMutationRef = useRef(0);
  useEffect(() => {
    if (!lastMutationAt || lastMutationAt === prevMutationRef.current) return;
    prevMutationRef.current = lastMutationAt;
    if (!lastMutationIds.length) return;
    getMessagesByIds(lastMutationIds)
      .then((rows) => {
        if (!rows.length) return;
        const changed = new Map(rows.map((row) => [row.id, toMsg(row)]));
        setSqliteMessages((current) => current.map((message) => changed.get(message.id) ?? message));
      })
      .catch(() => {});
  }, [lastMutationAt, lastMutationIds]);

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
    if (!isDirectChat || !otherUserId) { alert('Info', 'Calls are only available in direct chats'); return; }
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
      headerTitle: () => <SyncingHeaderTitle title={route.params.roomName} syncing={!connected} color={Colors.headerText} />,
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
          {!isDirectChat && (
            <TouchableOpacity
              onPress={() => navigation.navigate('GroupInfo', { roomId, roomName: route.params.roomName })}
              activeOpacity={0.7}
              style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: 'rgba(0,229,255,0.10)',
                borderWidth: 1, borderColor: 'rgba(0,229,255,0.30)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="people-outline" size={18} color="#00E5FF" />
            </TouchableOpacity>
          )}
          {isDirectChat && !!otherUserId && <>
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
          </>}
        </View>
      ),
    });
  }, [navigation, otherUserId, isDirectChat, roomId, isMuted, connected, Colors.headerText, route.params.roomName]);

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
      alert('Could not record', 'Axonic could not start the microphone. Please try again.');
    }
  }, [audioRecorder, slideX, pulseScale, ensurePermission, alert]);

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
    const sizeFailure = validateMediaSize(mediaFileSize(uri));
    if (sizeFailure) {
      alert('Could not send voice message', sizeFailure.message);
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
    const result = await sendMessage('🎤 Voice message', 'voice', reply, {
      file_uri: uri,
      duration_ms: durationMs,
      audio_mime: 'audio/m4a',
    });
    setReplyingTo(null);
    if (result.state === 'failed') {
      alert('Could not send voice message', result.error?.message || 'The recording could not be sent.');
    } else {
      playSound('message_sent');
      if (result.state === 'queued') {
        alert('Voice message queued', 'Axonic will finish sending when the connection is available.');
      }
    }
  }, [audioRecorder, slideX, pulseScale, replyingTo, sendMessage, alert]);

  const showTransferResults = useCallback((results: SendChatResult[]) => {
    const failed = results.filter((result) => result.state === 'failed');
    const queued = results.filter((result) => result.state === 'queued');
    if (failed.length > 0) {
      const detail = failed[0].error?.message || 'One or more attachments could not be sent.';
      alert(
        failed.length === results.length ? 'Could not send' : 'Some items were not sent',
        `${results.length - failed.length} of ${results.length} queued or sent. ${detail}`,
      );
    } else if (queued.length > 0) {
      alert('Transfer queued', 'Axonic will finish sending when the connection is available.');
    }
  }, [alert]);

  /* ---- Image attachment handlers ---- */
  /** Pick an asset from the camera or library, persist it, and send. */
  const sendPickedImage = useCallback(async (asset: ImagePicker.ImagePickerAsset): Promise<SendChatResult> => {
    if (!asset?.uri) return { messageId: null, state: 'failed', error: { code: 'invalid_file', message: 'The selected image is unavailable.', retryable: false, status: 0 } };
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Compress/resize first so the photo rides in a single WS frame reliably,
    // then persist our own copy so it survives picker cleanup and retries.
    const compressed = await compressImageForSend(asset.uri, asset.width, asset.height);
    const sizeFailure = validateMediaSize(mediaFileSize(compressed.uri));
    if (sizeFailure) return { messageId: null, state: 'failed', error: sizeFailure };
    let localUri = compressed.uri;
    try {
      localUri = await persistOutgoingImage(msgId, compressed.uri, compressed.mime);
    } catch (err) {
      console.warn('[ChatRoomScreen] failed to persist outgoing image:', err);
      return {
        messageId: null,
        state: 'failed',
        error: { code: 'invalid_file', message: 'The image could not be prepared for sending.', retryable: false, status: 0 },
      };
    }
    const reply = replyingTo
      ? {
          id: replyingTo.id,
          sender_name: replyingTo.sender_username || '',
          content: (replyingTo.content ?? '').slice(0, 140),
          type: replyingTo.message_type,
        }
      : null;
    const result = await sendMessage('\uD83D\uDCF7 Photo', 'image', reply, {
      file_uri: localUri,
      image_mime: compressed.mime,
    });
    setReplyingTo(null);
    if (result.state !== 'failed') playSound('message_sent');
    return result;
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
        showTransferResults([await sendPickedImage(result.assets[0])]);
      }
    } catch (err) {
      console.warn('[ChatRoomScreen] camera error:', err);
      alert('Camera error', 'Axonic could not open or process the camera image. Please try again.');
    }
  }, [sendPickedImage, ensurePermission, showTransferResults, alert]);

  const sendPickedFile = useCallback(async (
    asset: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null },
    messageType: 'video' | 'document',
  ): Promise<SendChatResult> => {
    if (!asset.uri) return { messageId: null, state: 'failed', error: { code: 'invalid_file', message: 'The selected file is unavailable.', retryable: false, status: 0 } };
    const sizeFailure = validateMediaSize(asset.size ?? mediaFileSize(asset.uri));
    if (sizeFailure) return { messageId: null, state: 'failed', error: sizeFailure };
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let localUri = asset.uri;
    try {
      localUri = persistSharedFile(msgId, asset.uri, asset.name);
    } catch (err) {
      console.warn('[ChatRoomScreen] failed to persist picked file:', err);
      return {
        messageId: null,
        state: 'failed',
        error: { code: 'invalid_file', message: `${asset.name || 'The selected file'} could not be prepared for sending.`, retryable: false, status: 0 },
      };
    }
    const reply = replyingTo
      ? {
          id: replyingTo.id,
          sender_name: replyingTo.sender_username || '',
          content: (replyingTo.content ?? '').slice(0, 140),
          type: replyingTo.message_type,
        }
      : null;
    const label = asset.name || (messageType === 'video' ? 'Video' : 'Document');
    const result = await sendMessage(label, messageType, reply, {
      file_uri: localUri,
      media_mime: asset.mimeType ?? (messageType === 'video' ? 'video/mp4' : 'application/octet-stream'),
    });
    setReplyingTo(null);
    if (result.state !== 'failed') playSound('message_sent');
    return result;
  }, [replyingTo, sendMessage]);

  const handlePickMultimedia = useCallback(async () => {
    setAttachMenuOpen(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        alert('Media library permission required', 'Please enable media access in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.length) {
        const results = await mapWithConcurrency(result.assets, MEDIA_BATCH_CONCURRENCY, async (asset) => {
          if (asset.type === 'video') {
            return sendPickedFile({ uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType, size: asset.fileSize }, 'video');
          }
          return sendPickedImage(asset);
        });
        showTransferResults(results);
      }
    } catch (err) {
      console.warn('[ChatRoomScreen] multimedia picker error:', err);
      alert('Could not select media', 'Axonic could not open or process the selected media. Please try again.');
    }
  }, [sendPickedImage, sendPickedFile, showTransferResults, alert]);

  const handlePickDocuments = useCallback(async () => {
    setAttachMenuOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const results = await mapWithConcurrency(result.assets, MEDIA_BATCH_CONCURRENCY, (asset) =>
        sendPickedFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }, 'document'));
      showTransferResults(results);
    } catch (err) {
      console.warn('[ChatRoomScreen] document picker error:', err);
      alert('Could not select documents', 'Axonic could not open or process the selected documents. Please try again.');
    }
  }, [sendPickedFile, showTransferResults, alert]);

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
    sendMessageUpdate(roomId, msgId, { reactions: newReactions, reacted_emoji: emoji }, otherUserId ? [otherUserId] : []);
  }, [contextMsg, user, roomId, otherUserId, loadFromDB]);

  const handleCopy = useCallback(async () => {
    if (!contextMsg) return;
    const text = contextMsg.content ?? '';
    setContextMsg(null);
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
    } catch { /* ignore */ }
  }, [contextMsg]);

  const handleOpenLink = useCallback(() => {
    const url = contextMsg ? getFirstMessageUrl(contextMsg.content ?? '') : null;
    setContextMsg(null);
    if (url) Linking.openURL(url).catch(() => {});
  }, [contextMsg]);

  const handleCopyLink = useCallback(async () => {
    const url = contextMsg ? getFirstMessageUrl(contextMsg.content ?? '') : null;
    setContextMsg(null);
    if (!url) return;
    try { await Clipboard.setStringAsync(url); } catch { /* ignore */ }
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
          sendMessageUpdate(roomId, msgId, { is_deleted: true }, otherUserId ? [otherUserId] : []);
        }},
      ],
    });
  }, [contextMsg, roomId, loadFromDB]);

  /** Open the forward picker from local room metadata, then repair in background. */
  const handleForward = useCallback(async () => {
    if (!contextMsg) return;
    const target = contextMsg;
    setContextMsg(null);
    setForwardMsg(target);
    setForwardLoading(true);
    const cached = user?.id != null ? await getCachedRooms(user.id).catch(() => [] as ChatRoom[]) : [];
    // Exclude the source room — forwarding to self is rarely useful.
    setForwardRooms(cached.filter((r) => r.id !== roomId));
    setForwardLoading(false);
    getRooms()
      .then((data) => setForwardRooms(data.filter((r) => r.id !== roomId)))
      .catch(() => { /* local room list remains usable offline */ });
  }, [contextMsg, roomId, user?.id]);

  /** Send the forwarded message to the selected room. */
  const doForwardTo = useCallback(async (targetRoomId: string) => {
    if (!forwardMsg) return;
    const msg = forwardMsg;
    setForwardMsg(null);
    try {
      const type = (msg.message_type as string) || 'text';
      // For media, carry the local file so the forward uploads its own durable
      // blob and sends a new pointer to the destination room.
      const extras =
        type === 'image'
          ? { file_uri: msg.file_uri ?? msg.file ?? null, image_mime: 'image/jpeg' }
          : type === 'voice'
            ? { file_uri: msg.file_uri ?? msg.file ?? null, duration_ms: msg.duration_ms ?? null, audio_mime: 'audio/m4a' }
            : (type === 'video' || type === 'document')
              ? { file_uri: msg.file_uri ?? msg.file ?? null, media_mime: 'application/octet-stream' }
            : null;
      const result = await sendChatMessage(targetRoomId, msg.content ?? '', type, null, extras);
      if (result.state === 'failed') {
        alert('Could not forward', result.error?.message || 'The message could not be forwarded.');
      } else {
        playSound('message_sent');
        if (result.state === 'queued') {
          alert('Forward queued', 'Axonic will finish forwarding when the connection is available.');
        }
      }
    } catch {
      alert('Could not forward', 'The message could not be forwarded. Please try again.');
    }
  }, [forwardMsg, alert]);

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
    sendMessageUpdate(roomId, m.id, { reactions: newReactions, reacted_emoji: emoji }, otherUserId ? [otherUserId] : []);
  }, [roomId, user?.id, otherUserId]);

  const handleRetryMessage = useCallback(async (messageId: string) => {
    setRetryStartedAtById((current) => ({ ...current, [messageId]: Date.now() }));
    try {
      const result = await retryOutgoingMessage(roomId, messageId);
      if (result.state === 'queued') {
        alert('Retry queued', 'Axonic will resend this message as soon as it reconnects.');
      } else if (result.state === 'missing') {
        alert('Message unavailable', 'This message is no longer available to resend from this phone.');
      } else if (result.state === 'failed') {
        alert('Could not resend', result.error?.message || 'This attachment cannot be sent.');
      }
    } catch {
      alert('Could not resend', 'Please check your connection and try again.');
    }
  }, [alert, roomId]);

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isMine = item.sender === user?.id;
    // The in-memory set covers this live session; persisted pending status
    // keeps the retry control available after an app restart.
    const isPending = isMine && (pendingIds.has(item.id) || item.status === 'pending');
    const isDelivered = isMine && deliveredIds.has(item.id);
    const isRead = isMine && (item.is_read || readIds.has(item.id) || item.status === 'read');
    return (
      <ExtractedMessageBubble
        item={item}
        isMine={isMine}
        isPending={isPending}
        retryStartedAt={retryStartedAtById[item.id] ?? 0}
        isDelivered={isDelivered}
        isRead={isRead}
        isDirectChat={isDirectChat}
        Colors={Colors}
        currentUserId={user?.id}
        onReply={handleReply}
        onLongPress={handleBubbleLongPress}
        onRetry={handleRetryMessage}
        onImagePress={handleImagePress}
        onReaction={handleReactionToggle}
      />
    );
  }, [user?.id, pendingIds, deliveredIds, readIds, retryStartedAtById, isDirectChat, Colors, handleReply, handleBubbleLongPress, handleRetryMessage, handleImagePress, handleReactionToggle]);

  const handleAcceptRequest = useCallback(async () => {
    if (!otherUserId || requestBusy) return;
    setRequestBusy(true);
    try {
      await addContact(otherUserId);
      useAppStore.getState().addContactId(otherUserId);
      if (user?.id != null) await setCachedRelationship(user.id, otherUserId, 'contact');
    } catch (err: any) {
      // Likely 400 because the contact already exists — treat that as accepted.
      if (err?.response?.status === 400) {
        useAppStore.getState().addContactId(otherUserId);
        if (user?.id != null) await setCachedRelationship(user.id, otherUserId, 'contact');
      } else {
        alert('Could not accept', 'Please try again.');
      }
    } finally {
      setRequestBusy(false);
    }
  }, [otherUserId, requestBusy, user?.id]);

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
              useAppStore.getState().removeContactId(otherUserId);
              if (user?.id != null) await setCachedRelationship(user.id, otherUserId, 'blocked');
              navigation.goBack();
            } catch {
              alert('Could not block', 'Please try again.');
              setRequestBusy(false);
            }
          },
        },
      ],
    });
  }, [otherUserId, requestBusy, navigation, user?.id]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.chatBg }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    /* Android uses adjustResize plus the measured IME-inset fallback above.
       Letting KeyboardAvoidingView also change height causes double/zero resize
       behavior across edge-to-edge production devices. */
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.chatBg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      enabled={Platform.OS === 'ios'}
    >
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
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.35}
        ListFooterComponent={loadingOlderMessages ? (
          <View style={styles.historyLoader}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : null}
      />

      <View style={[styles.inputBar, {
        backgroundColor: Colors.chatBg,
        borderTopColor: Colors.neonBorder,
        paddingBottom: composerBottomPadding,
      }]}>
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
            <TouchableOpacity style={styles.attachRow} onPress={handlePickMultimedia} activeOpacity={0.7}>
              <Ionicons name="images" size={22} color={Colors.primary} />
              <Text style={[styles.attachLabel, { color: Colors.text }]}>Multimedia</Text>
            </TouchableOpacity>
            <View style={[styles.attachDivider, { backgroundColor: Colors.border }]} />
            <TouchableOpacity style={styles.attachRow} onPress={handlePickDocuments} activeOpacity={0.7}>
              <Ionicons name="document-attach-outline" size={22} color={Colors.primary} />
              <Text style={[styles.attachLabel, { color: Colors.text }]}>Files</Text>
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
              top: Math.min(Math.max(contextY - 70, 60), winHeight - 290),
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
            {contextMsg && !contextMsg.is_deleted && getFirstMessageUrl(contextMsg.content ?? '') && (
              <>
                <View style={[styles.contextDivider, { backgroundColor: Colors.divider }]} />
                <TouchableOpacity onPress={handleOpenLink} style={styles.contextOption}>
                  <Text style={[styles.contextOptionText, { color: Colors.text }]}>↗  Open link</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCopyLink} style={styles.contextOption}>
                  <Text style={[styles.contextOptionText, { color: Colors.text }]}>🔗  Copy link</Text>
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

  syncHeaderTitle: { flexDirection: 'row', alignItems: 'center', maxWidth: 150 },
  syncLetters: { flexDirection: 'row', flexShrink: 1 },
  syncHeaderLetter: { fontSize: Font.size.md, fontWeight: '800', letterSpacing: 0.7 },

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
  historyLoader: { paddingVertical: Spacing.md, alignItems: 'center' },

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

  /* ---- Reply composer preview ---- */
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
