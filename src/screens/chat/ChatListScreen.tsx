/* ------------------------------------------------------------------ */
/*  Chat List Screen — futuristic cyberpunk theme                     */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  BackHandler,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Swipeable } from 'react-native-gesture-handler';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Font, Spacing, Radius, type ThemeColors } from '../../theme';
import { resolveMediaUrl } from '../../services/api';
import { getRooms } from '../../services/chatService';
import { initiateCall } from '../../services/callService';
import { getCachedRooms, getLastMessagePerRoom, deleteRoomMessages } from '../../services/localMessageStore';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { useAppStore } from '../../store/appStore';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import ChatAvatarActionModal from '../../components/chat/chat-avatar-action-modal';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import type { ChatRoom, RootStackParamList } from '../../types';

dayjs.extend(relativeTime);

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatTime(dateStr: string): string {
  const d = dayjs(dateStr);
  const now = dayjs();
  if (d.isSame(now, 'day')) return d.format('HH:mm');
  if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.format('DD/MM/YY');
}

/* ------------------------------------------------------------------ */
/*  ChatListRow — memoized. Receives only primitives + stable          */
/*  callbacks, so a message arriving in one room re-renders ONLY that   */
/*  room's row (React.memo shallow-compares props) instead of the whole */
/*  list. Heavy children (Avatar, Swipeable) are skipped when unchanged.*/
/* ------------------------------------------------------------------ */
interface ChatListRowProps {
  roomId: string;
  displayName: string;
  avatarUri: string | null;
  isDirect: boolean;
  isOnline: boolean;
  otherUserId?: number;
  lastMsgContent: string | null;
  lastMsgTime: string | null;
  lastMsgFromMe: boolean;
  lastMsgStatus?: 'pending' | 'delivered' | 'read';
  unread: number;
  typingLabel: string | null;
  isMuted: boolean;
  selectionMode: boolean;
  selected: boolean;
  Colors: ThemeColors;
  onOpen: (roomId: string, displayName: string, otherUserId?: number) => void;
  onLongPress: (roomId: string) => void;
  onToggleSelection: (roomId: string) => void;
  onAvatarPress: (roomId: string) => void;
  onMarkRead: (roomId: string) => void;
}

function ChatListRowBase({
  roomId,
  displayName,
  avatarUri,
  isDirect,
  isOnline,
  otherUserId,
  lastMsgContent,
  lastMsgTime,
  lastMsgFromMe,
  lastMsgStatus,
  unread,
  typingLabel,
  isMuted,
  selectionMode,
  selected,
  Colors,
  onOpen,
  onLongPress,
  onToggleSelection,
  onAvatarPress,
  onMarkRead,
}: ChatListRowProps) {
  const renderRightActions = () => (
    <TouchableOpacity
      style={[styles.swipeAction, { backgroundColor: Colors.primary }]}
      activeOpacity={0.8}
      onPress={() => onMarkRead(roomId)}
    >
      <Ionicons name="checkmark-done" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Mark read</Text>
    </TouchableOpacity>
  );

  const row = (
    <TouchableOpacity
      testID={`chat-row-${roomId}`}
      accessibilityLabel={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${displayName}` : `Open chat with ${displayName}`}
      accessibilityState={{ selected }}
      style={[
        styles.chatItem,
        {
          borderColor: selected ? Colors.primary : Colors.neonBorder,
          backgroundColor: selected ? Colors.highlight : Colors.background,
        },
      ]}
      activeOpacity={0.7}
      onLongPress={() => onLongPress(roomId)}
      delayLongPress={350}
      onPress={() => {
        if (selectionMode) onToggleSelection(roomId);
        else onOpen(roomId, displayName, otherUserId);
      }}
    >
      {/* Left accent bar */}
      <View style={[styles.accentBar, { backgroundColor: Colors.primary }]} />

      {selectionMode && (
        <View
          style={[
            styles.selectionCircle,
            {
              borderColor: selected ? Colors.primary : Colors.textTertiary,
              backgroundColor: selected ? Colors.primary : 'transparent',
            },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={15} color={Colors.background} />}
        </View>
      )}

      <TouchableOpacity
        testID={`chat-avatar-${roomId}`}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Preview ${displayName}`}
        style={styles.avatarWrapper}
        activeOpacity={0.72}
        disabled={selectionMode}
        onPress={(event) => {
          event.stopPropagation();
          onAvatarPress(roomId);
        }}
      >
        <Avatar
          name={displayName}
          uri={avatarUri}
          size={50}
          showOnline={isDirect}
          isOnline={isOnline}
        />
      </TouchableOpacity>

      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Text style={[styles.chatName, { color: Colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {isMuted && (
              <Ionicons
                name="notifications-off"
                size={14}
                color={Colors.textTertiary}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          {lastMsgTime && (
            <Text style={[styles.chatTime, { color: Colors.primary }]}>
              {lastMsgTime}
            </Text>
          )}
        </View>
        <View style={styles.chatBottomRow}>
          <Text
            style={[
              styles.lastMessage,
              typingLabel
                ? { color: Colors.primary, fontStyle: 'italic' }
                : { color: unread > 0 ? Colors.text : Colors.textSecondary, fontWeight: unread > 0 ? '600' : '400' },
            ]}
            numberOfLines={1}
          >
            {typingLabel
              ? typingLabel
              : lastMsgContent != null
                ? (
                  <>
                    {lastMsgFromMe && (
                      <Text
                        style={{
                          color: lastMsgStatus === 'read'
                            ? Colors.checkBlue
                            : Colors.textTertiary,
                        }}
                      >
                        {lastMsgStatus === 'pending'
                          ? '⏱ '
                          : lastMsgStatus === 'read'
                            ? '✓✓ '
                            : '✓ '}
                      </Text>
                    )}
                    {lastMsgContent}
                  </>
                )
                : '— no messages yet —'}
          </Text>
          {unread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: isMuted ? Colors.textTertiary : Colors.primary }]}>
              <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  if (unread > 0 && !selectionMode) {
    return (
      <Swipeable
        renderRightActions={renderRightActions}
        overshootRight={false}
        onSwipeableOpen={(direction, swipeable) => {
          if (direction === 'right') {
            onMarkRead(roomId);
            swipeable.close();
          }
        }}
      >
        {row}
      </Swipeable>
    );
  }
  return row;
}

const ChatListRow = React.memo(ChatListRowBase);


export default function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { colors: Colors } = useTheme();
  const { ensure: ensurePermission } = usePermissionPrompt();
  const unreadByRoom = useAppStore((s) => s.unreadByRoom);
  const clearAllUnread = useAppStore((s) => s.clearAllUnread);
  const clearRoomUnread = useAppStore((s) => s.clearRoomUnread);
  const clearRoomState = useAppStore((s) => s.clearRoomState);
  const markRoomCleared = useAppStore((s) => s.markRoomCleared);
  const clearedRooms = useAppStore((s) => s.clearedRooms);
  const lastMessageByRoom = useAppStore((s) => s.lastMessageByRoom);
  const typingByRoom = useAppStore((s) => s.typingByRoom);
  const mutedRooms = useAppStore((s) => s.mutedRooms);
  const presenceByUserId = useAppStore((s) => s.presenceByUserId);
  const { alert, confirm } = useConfirm();
  const totalUnread = Object.values(unreadByRoom).reduce((a, b) => a + b, 0);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(() => new Set());
  const [avatarRoomId, setAvatarRoomId] = useState<string | null>(null);
  const [localLastMessages, setLocalLastMessages] = useState<
    Record<
      string,
      {
        content: string;
        created_at: string;
        sender_id?: number;
        status?: 'pending' | 'delivered' | 'read';
      } | null
    >
  >({});

  const loadLocalLastMessages = useCallback(async () => {
    const localMsgsMap = await getLastMessagePerRoom();
    const map: Record<string, { content: string; created_at: string; sender_id?: number; status?: 'pending' | 'delivered' | 'read' } | null> = {};
    for (const [roomId, msg] of Object.entries(localMsgsMap)) {
      map[roomId] = { content: msg.content ?? '', created_at: msg.created_at, sender_id: msg.sender_id, status: msg.status };
    }
    setLocalLastMessages(map);
  }, []);

  /** Server remains authoritative for room metadata; this runs after the local
   * cache is visible, and on focus/pull-to-refresh as a background repair. */
  const syncRooms = useCallback(async (force = false) => {
    try {
      const data = await getRooms(force);
      setRooms(data);
      await loadLocalLastMessages();
    } catch { /* ignore */ } finally {
      setRefreshing(false);
    }
  }, [user?.id, loadLocalLastMessages]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [cachedRooms] = await Promise.all([
          user?.id != null ? getCachedRooms(user.id) : Promise.resolve([] as ChatRoom[]),
          loadLocalLastMessages(),
        ]);
        if (active && cachedRooms.length) setRooms(cachedRooms);
      } catch { /* cache is best-effort */ } finally {
        if (active) setLoading(false);
      }
      // Do not await: the list is already usable from local SQLite.
      syncRooms().catch(() => {});
    })();
    return () => { active = false; };
  }, [user?.id, loadLocalLastMessages, syncRooms]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { void syncRooms(); });
    return unsub;
  }, [navigation, syncRooms]);

  // Live-update the list when a new message arrives over the notification WS.
  // Without this, the "last message" preview only refreshes when the screen
  // is focused/refreshed — so messages arriving while the user is sitting on
  // the chat list look stale until they tap into a room.
  const { subscribe } = useNotificationContext();
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (payload.event === 'room_update') {
        syncRooms(true);
        return;
      }
      if (payload.event !== 'new_message') return;
      const roomId = String(payload.room_id ?? '');
      if (!roomId) return;
      const createdAt = payload.created_at ?? new Date().toISOString();
      const content = payload.content ?? '';

      setLocalLastMessages((prev) => ({
        ...prev,
        [roomId]: { content, created_at: createdAt },
      }));

      // Bump the affected room to the top of the list.
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r.id === roomId);
        if (idx === -1) {
          // New room not yet in our list — re-fetch to pick it up.
          syncRooms(true);
          return prev;
        }
        const updated: ChatRoom = {
          ...prev[idx],
          last_message: {
            id: String(payload.message_id ?? ''),
            sender: String(payload.sender ?? ''),
            content,
            created_at: createdAt,
          },
          updated_at: createdAt,
        };
        const next = prev.slice();
        next.splice(idx, 1);
        next.unshift(updated);
        return next;
      });
    });
    return unsub;
  }, [subscribe, syncRooms]);

  const getRoomDisplayName = (room: ChatRoom): string => {
    if (room.name) return room.name;
    if (room.room_type === 'direct') {
      const other = room.members_detail.find((m) => m.id !== user?.id);
      return other?.display_name?.trim() || other?.username || 'Chat';
    }
    return room.members_detail
      .map((m) => m.display_name?.trim() || m.username)
      .join(', ');
  };

  const getOtherMember = (room: ChatRoom) => {
    if (room.room_type === 'direct') {
      return room.members_detail.find((m) => m.id !== user?.id);
    }
    return null;
  };

  const getLastMessage = (room: ChatRoom) => {
    type LastMsg = {
      content: string;
      created_at: string;
      sender_id?: number;
      status?: 'pending' | 'delivered' | 'read';
    };
    const candidates: LastMsg[] = [
      lastMessageByRoom[room.id] ?? null,
      localLastMessages[room.id] ?? null,
      room.last_message ?? null,
    ].filter((m): m is LastMsg => !!m);
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, m) =>
      new Date(m.created_at) > new Date(latest.created_at) ? m : latest,
    );
  };

  // Hide chats the user "deleted" (cleared) locally until a message NEWER than
  // the clear exists — then the room reappears as a fresh chat (its old messages
  // were already wiped from this device).
  const visibleRooms = rooms
    .filter((room) => {
      const clearedAt = clearedRooms[room.id];
      if (clearedAt == null) return true;
      const last = getLastMessage(room);
      return !!last && new Date(last.created_at).getTime() > clearedAt;
    })
    .sort((a, b) => {
      const aLast = getLastMessage(a);
      const bLast = getLastMessage(b);
      const aTime = aLast ? new Date(aLast.created_at).getTime() : new Date(a.updated_at).getTime();
      const bTime = bLast ? new Date(bLast.created_at).getTime() : new Date(b.updated_at).getTime();
      return bTime - aTime;
    });

  /* ── Stable row callbacks (never change identity → memoized rows stay put) ── */
  const handleOpenRoom = useCallback(
    (roomId: string, displayName: string, otherUserId?: number) => {
      navigation.navigate('ChatRoom', { roomId, roomName: displayName, otherUserId });
    },
    [navigation],
  );

  const handleMarkRead = useCallback(
    (roomId: string) => {
      clearRoomUnread(roomId);
    },
    [clearRoomUnread],
  );

  const clearSelection = useCallback(() => setSelectedRoomIds(new Set()), []);

  const handleToggleSelection = useCallback((roomId: string) => {
    setSelectedRoomIds((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }, []);

  const handleRowLongPress = useCallback((roomId: string) => {
    setSelectedRoomIds((current) => {
      if (current.has(roomId)) return current;
      const next = new Set(current);
      next.add(roomId);
      return next;
    });
  }, []);

  const deleteSelectedChats = useCallback(() => {
    const roomIds = [...selectedRoomIds];
    if (!roomIds.length) return;
    const count = roomIds.length;
    confirm({
      title: count === 1 ? 'Delete chat?' : `Delete ${count} chats?`,
      message: `This removes ${count === 1 ? 'this chat and its messages' : 'these chats and their messages'} from this device only. A chat will reappear if a new message arrives.`,
      icon: 'trash-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: count === 1 ? 'Delete' : `Delete ${count}`,
          style: 'destructive',
          onPress: async () => {
            await Promise.allSettled(roomIds.map((roomId) => deleteRoomMessages(roomId)));
            for (const roomId of roomIds) {
              markRoomCleared(roomId);
              clearRoomState(roomId);
            }
            setLocalLastMessages((previous) => {
              const next = { ...previous };
              roomIds.forEach((roomId) => delete next[roomId]);
              return next;
            });
            setRooms((previous) => previous.filter((room) => !selectedRoomIds.has(room.id)));
            clearSelection();
          },
        },
      ],
    });
  }, [clearRoomState, clearSelection, confirm, markRoomCleared, selectedRoomIds]);

  const handleAvatarPress = useCallback((roomId: string) => {
    setAvatarRoomId(roomId);
  }, []);

  const avatarRoom = avatarRoomId ? rooms.find((room) => room.id === avatarRoomId) ?? null : null;
  const avatarDisplayName = avatarRoom ? getRoomDisplayName(avatarRoom) : '';
  const avatarOtherMember = avatarRoom ? getOtherMember(avatarRoom) : null;
  const avatarUri = avatarRoom
    ? resolveMediaUrl(avatarRoom.room_type === 'group' ? avatarRoom.avatar : avatarOtherMember?.avatar ?? null)
    : null;

  const closeAvatarPreview = useCallback(() => setAvatarRoomId(null), []);

  const openAvatarChat = useCallback(() => {
    if (!avatarRoom) return;
    setAvatarRoomId(null);
    navigation.navigate('ChatRoom', {
      roomId: avatarRoom.id,
      roomName: avatarDisplayName,
      otherUserId: avatarOtherMember?.id,
    });
  }, [avatarDisplayName, avatarOtherMember?.id, avatarRoom, navigation]);

  const openAvatarDetails = useCallback(() => {
    if (!avatarRoom) return;
    setAvatarRoomId(null);
    if (avatarRoom.room_type === 'group') {
      navigation.navigate('GroupInfo', { roomId: avatarRoom.id, roomName: avatarDisplayName });
      return;
    }
    if (avatarOtherMember?.id != null) {
      navigation.navigate('UserInfo', {
        roomId: avatarRoom.id,
        roomName: avatarDisplayName,
        userId: avatarOtherMember.id,
      });
    }
  }, [avatarDisplayName, avatarOtherMember?.id, avatarRoom, navigation]);

  const startAvatarCall = useCallback(async () => {
    if (!avatarRoom || avatarRoom.room_type !== 'direct' || avatarOtherMember?.id == null) return;
    const room = avatarRoom;
    const peer = avatarOtherMember;
    const peerName = avatarDisplayName;
    setAvatarRoomId(null);
    if (!(await ensurePermission('microphone'))) return;
    try {
      const result = await initiateCall(peer.id, 'voice');
      navigation.navigate('ActiveCall', {
        callId: result.call_id,
        otherName: peerName,
        callType: 'voice',
        roomName: result.room_name,
        isOutgoing: true,
        peerUserId: peer.id,
      });
    } catch {
      alert('Could not start call', `Axonic could not call ${peerName}. Please try again.`);
    }
  }, [alert, avatarDisplayName, avatarOtherMember, avatarRoom, ensurePermission, navigation]);

  const selectionMode = selectedRoomIds.size > 0;
  const allVisibleSelected = visibleRooms.length > 0
    && visibleRooms.every((room) => selectedRoomIds.has(room.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedRoomIds((current) => {
      const allSelected = visibleRooms.length > 0
        && visibleRooms.every((room) => current.has(room.id));
      return allSelected
        ? new Set()
        : new Set(visibleRooms.map((room) => room.id));
    });
  }, [visibleRooms]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: selectionMode ? `${selectedRoomIds.size} SELECTED` : 'AXONIC',
      headerLeft: selectionMode
        ? () => (
          <TouchableOpacity
            testID="chat-selection-close"
            accessibilityLabel="Cancel chat selection"
            style={styles.headerAction}
            onPress={clearSelection}
          >
            <Ionicons name="close" size={25} color={Colors.primary} />
          </TouchableOpacity>
        )
        : undefined,
      headerRight: undefined,
    });
  }, [
    Colors.primary,
    clearSelection,
    navigation,
    selectedRoomIds.size,
    selectionMode,
  ]);

  useEffect(() => {
    if (!selectionMode) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => subscription.remove();
  }, [clearSelection, selectionMode]);

  useEffect(() => navigation.addListener('blur', clearSelection), [clearSelection, navigation]);

  const renderItem = useCallback(
    ({ item }: { item: ChatRoom }) => {
      const displayName = getRoomDisplayName(item);
      const other = getOtherMember(item);
      const lastMsg = getLastMessage(item);
      const unread = unreadByRoom[item.id] ?? 0;
      const typingEntry = typingByRoom[item.id];
      const typers = (typingEntry ?? []).filter((t) => t.userId !== user?.id);
      const typingLabel =
        typers.length > 0
          ? (typers.length === 1 ? `${typers[0].username} is typing…` : 'typing…')
          : null;
      return (
        <ChatListRow
          roomId={item.id}
          displayName={displayName}
          avatarUri={resolveMediaUrl(item.room_type === 'group' ? item.avatar : other?.avatar ?? null)}
          isDirect={item.room_type === 'direct'}
          isOnline={other?.id != null ? (presenceByUserId[other.id]?.isOnline ?? false) : false}
          otherUserId={other?.id}
          lastMsgContent={lastMsg ? (lastMsg.content ?? '') : null}
          lastMsgTime={lastMsg ? formatTime(lastMsg.created_at) : null}
          lastMsgFromMe={!!lastMsg && lastMsg.sender_id === user?.id}
          lastMsgStatus={lastMsg?.status}
          unread={unread}
          typingLabel={typingLabel}
          isMuted={!!mutedRooms[item.id]}
          selectionMode={selectionMode}
          selected={selectedRoomIds.has(item.id)}
          Colors={Colors}
          onOpen={handleOpenRoom}
          onLongPress={handleRowLongPress}
          onToggleSelection={handleToggleSelection}
          onAvatarPress={handleAvatarPress}
          onMarkRead={handleMarkRead}
        />
      );
    },
    [
      unreadByRoom,
      typingByRoom,
      mutedRooms,
      presenceByUserId,
      lastMessageByRoom,
      localLastMessages,
      selectedRoomIds,
      selectionMode,
      user?.id,
      Colors,
      handleOpenRoom,
      handleRowLongPress,
      handleToggleSelection,
      handleAvatarPress,
      handleMarkRead,
    ],
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View
      testID="axonic-ready"
      collapsable={false}
      style={[styles.container, { backgroundColor: Colors.background }]}
    >
      {selectionMode && (
        <View style={[styles.selectionBar, { borderBottomColor: Colors.divider, backgroundColor: Colors.surface }]}>
          <TouchableOpacity
            testID="chat-selection-all"
            accessibilityLabel={allVisibleSelected ? 'Deselect all chats' : 'Select all chats'}
            style={styles.selectionBarAction}
            activeOpacity={0.72}
            onPress={toggleSelectAll}
          >
            <Ionicons
              name={allVisibleSelected ? 'checkbox-outline' : 'square-outline'}
              size={20}
              color={Colors.primary}
            />
            <Text style={[styles.selectionBarText, { color: Colors.primary }]}>
              {allVisibleSelected ? 'Deselect all' : 'Select all'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="chat-selection-delete"
            accessibilityLabel={`Delete ${selectedRoomIds.size} selected chats`}
            style={styles.selectionBarAction}
            activeOpacity={0.72}
            onPress={deleteSelectedChats}
          >
            <Ionicons name="trash-outline" size={20} color={Colors.error} />
            <Text style={[styles.selectionBarText, { color: Colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
      {!selectionMode && totalUnread > 50 && (
        <TouchableOpacity
          style={[styles.markAllBar, { borderBottomColor: Colors.divider }]}
          activeOpacity={0.7}
          onPress={clearAllUnread}
        >
          <Ionicons name="checkmark-done" size={16} color={Colors.primary} />
          <Text style={[styles.markAllText, { color: Colors.primary }]}>
            Mark all as read ({totalUnread})
          </Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={visibleRooms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={visibleRooms.length === 0 ? styles.emptyContainer : styles.list}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          <EmptyState
            iconName="chatbubbles-outline"
            title="No channels open"
            subtitle="Add contacts and start chatting"
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); syncRooms(true); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.divider }]} />}
      />

      {!selectionMode && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: Colors.surface, borderColor: Colors.primary, shadowColor: Colors.primary }]}
          activeOpacity={0.8}
          onPress={() => {
            confirm({
              title: 'Start a conversation',
              message: 'Choose what you want to create.',
              icon: 'add-circle-outline',
              buttons: [
                { text: 'New chat', onPress: () => navigation.navigate('Contacts') },
                { text: 'New group', onPress: () => navigation.navigate('GroupCreate') },
                { text: 'Cancel', style: 'cancel' },
              ],
            });
          }}
        >
          <Ionicons name="add" size={32} color={Colors.primary} />
        </TouchableOpacity>
      )}

      <ChatAvatarActionModal
        visible={!!avatarRoom}
        name={avatarDisplayName}
        subtitle={avatarRoom?.room_type === 'group'
          ? `${avatarRoom.members_detail.length} members`
          : avatarOtherMember?.username ? `@${avatarOtherMember.username}` : null}
        avatarUri={avatarUri}
        isGroup={avatarRoom?.room_type === 'group'}
        onClose={closeAvatarPreview}
        onMessage={openAvatarChat}
        onCall={avatarRoom?.room_type === 'direct' ? startAvatarCall : undefined}
        onDetails={openAvatarDetails}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flexGrow: 1 },
  list: { paddingBottom: 80 },

  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingRight: Spacing.lg,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  accentBar: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: Spacing.md,
    borderRadius: 2,
  },
  avatarWrapper: {
    marginRight: Spacing.md,
  },
  selectionCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  chatInfo: { flex: 1 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName: { fontSize: Font.size.md, flex: 1, fontWeight: '600', letterSpacing: 0.3 },
  chatTime: { fontSize: Font.size.xs, marginLeft: Spacing.sm, letterSpacing: 0.5, fontWeight: '600' },
  chatBottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  lastMessage: { fontSize: Font.size.sm, letterSpacing: 0.2, flex: 1 },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    marginLeft: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  markAllBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  markAllText: {
    fontSize: Font.size.sm,
    fontWeight: '600',
    marginLeft: 6,
    letterSpacing: 0.3,
  },
  swipeAction: {
    width: 110,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: Spacing.xs,
    borderTopRightRadius: Radius.md,
    borderBottomRightRadius: Radius.md,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: Font.size.xs,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: 0.5,
  },

  separator: {
    height: 1,
    marginLeft: 71,
  },

  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectionBarAction: {
    minHeight: 42,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  selectionBarText: {
    fontSize: Font.size.sm,
    ...Font.semiBold,
  },
  headerAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  fabIcon: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
    letterSpacing: 0,
  },
});
