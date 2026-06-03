/* ------------------------------------------------------------------ */
/*  Chat List Screen — futuristic cyberpunk theme                     */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Swipeable } from 'react-native-gesture-handler';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Font, Spacing, Radius } from '../../theme';
import { resolveMediaUrl } from '../../services/api';
import { getRooms, deleteRoom } from '../../services/chatService';
import { getLastMessagePerRoom, deleteRoomMessages } from '../../services/localMessageStore';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useNotificationContext } from '../../contexts/NotificationContext';
import { useAppStore } from '../../store/appStore';
import { formatApiError } from '../../services/errorMessages';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import type { ChatRoom, RootStackParamList } from '../../types';

dayjs.extend(relativeTime);

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { colors: Colors } = useTheme();
  const unreadByRoom = useAppStore((s) => s.unreadByRoom);
  const clearAllUnread = useAppStore((s) => s.clearAllUnread);
  const clearRoomUnread = useAppStore((s) => s.clearRoomUnread);
  const incrementRoomUnread = useAppStore((s) => s.incrementRoomUnread);
  const clearRoomState = useAppStore((s) => s.clearRoomState);
  const toggleRoomMuted = useAppStore((s) => s.toggleRoomMuted);
  const lastMessageByRoom = useAppStore((s) => s.lastMessageByRoom);
  const typingByRoom = useAppStore((s) => s.typingByRoom);
  const mutedRooms = useAppStore((s) => s.mutedRooms);
  const { confirm, alert } = useConfirm();
  const totalUnread = Object.values(unreadByRoom).reduce((a, b) => a + b, 0);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [localLastMessages, setLocalLastMessages] = useState<
    Record<
      string,
      {
        content: string;
        created_at: string;
        sender_id?: number;
        status?: 'pending' | 'sent' | 'read';
      } | null
    >
  >({});

  const fetchRooms = useCallback(async () => {
    try {
      const data = await getRooms();
      setRooms(data);
      // Load last messages from local DB for all rooms
      const localMsgsMap = await getLastMessagePerRoom();
      const map: Record<
        string,
        {
          content: string;
          created_at: string;
          sender_id?: number;
          status?: 'pending' | 'sent' | 'read';
        } | null
      > = {};
      for (const [roomId, msg] of Object.entries(localMsgsMap)) {
        map[roomId] = {
          content: msg.content ?? '',
          created_at: msg.created_at,
          sender_id: msg.sender_id,
          // SQLite has no pending tracking — if it's mine and stored, assume at least 'sent'.
          status: msg.is_mine ? (msg.is_read ? 'read' : 'sent') : undefined,
        };
      }
      setLocalLastMessages(map);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', fetchRooms);
    return unsub;
  }, [navigation, fetchRooms]);

  // Live-update the list when a new message arrives over the notification WS.
  // Without this, the "last message" preview only refreshes when the screen
  // is focused/refreshed — so messages arriving while the user is sitting on
  // the chat list look stale until they tap into a room.
  const { subscribe } = useNotificationContext();
  useEffect(() => {
    const unsub = subscribe((payload) => {
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
          fetchRooms();
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
  }, [subscribe, fetchRooms]);

  const getRoomDisplayName = (room: ChatRoom): string => {
    if (room.name) return room.name;
    if (room.room_type === 'direct') {
      const other = room.members_detail.find((m) => m.id !== user?.id);
      return other?.username ?? 'Chat';
    }
    return room.members_detail.map((m) => m.username).join(', ');
  };

  const getOtherMember = (room: ChatRoom) => {
    if (room.room_type === 'direct') {
      return room.members_detail.find((m) => m.id !== user?.id);
    }
    return null;
  };

  const formatTime = (dateStr: string) => {
    const d = dayjs(dateStr);
    const now = dayjs();
    if (d.isSame(now, 'day')) return d.format('HH:mm');
    if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday';
    return d.format('DD/MM/YY');
  };

  const getLastMessage = (room: ChatRoom) => {
    type LastMsg = {
      content: string;
      created_at: string;
      sender_id?: number;
      status?: 'pending' | 'sent' | 'read';
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

  const renderItem = ({ item }: { item: ChatRoom }) => {
    const displayName = getRoomDisplayName(item);
    const other = getOtherMember(item);
    const lastMsg = getLastMessage(item);
    const unread = unreadByRoom[item.id] ?? 0;
    const typingEntry = typingByRoom[item.id];
    const typers = (typingEntry ?? []).filter((t) => t.userId !== user?.id);
    const isMuted = !!mutedRooms[item.id];

    const handleDeleteChat = () => {
      confirm({
        title: 'Delete chat',
        message:
          `This will permanently delete the conversation with ${displayName} ` +
          `for everyone in it. Messages cannot be recovered.`,
        icon: 'trash-outline',
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteRoom(item.id);
              } catch (err: unknown) {
                alert(
                  'Could not delete chat',
                  formatApiError(err, {
                    fallback: 'The chat could not be deleted. Please try again.',
                  }),
                );
                return;
              }
              try { await deleteRoomMessages(item.id); } catch { /* best-effort */ }
              clearRoomState(item.id);
              setLocalLastMessages((prev) => {
                if (!(item.id in prev)) return prev;
                const next = { ...prev };
                delete next[item.id];
                return next;
              });
              setRooms((prev) => prev.filter((r) => r.id !== item.id));
            },
          },
        ],
      });
    };

    const openRoomMenu = () => {
      confirm({
        title: displayName.toUpperCase(),
        message: 'Choose an action for this chat.',
        icon: 'ellipsis-horizontal-circle-outline',
        buttons: [
          {
            text: unread > 0 ? 'Mark as read' : 'Mark as unread',
            onPress: () => {
              if (unread > 0) clearRoomUnread(item.id);
              else incrementRoomUnread(item.id, 1);
            },
          },
          {
            text: isMuted ? 'Unmute notifications' : 'Mute notifications',
            onPress: () => toggleRoomMuted(item.id),
          },
          { text: 'Delete chat', style: 'destructive', onPress: handleDeleteChat },
          { text: 'Cancel', style: 'cancel' },
        ],
      });
    };

    const renderRightActions = () => (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: Colors.primary }]}
        activeOpacity={0.8}
        onPress={() => clearRoomUnread(item.id)}
      >
        <Ionicons name="checkmark-done" size={22} color="#fff" />
        <Text style={styles.swipeActionText}>Mark read</Text>
      </TouchableOpacity>
    );

    const row = (
      <TouchableOpacity
        style={[styles.chatItem, { borderColor: Colors.neonBorder, backgroundColor: Colors.background }]}
        activeOpacity={0.7}
        onLongPress={openRoomMenu}
        delayLongPress={350}
        onPress={() =>
          navigation.navigate('ChatRoom', {
            roomId: item.id,
            roomName: displayName,
            otherUserId: other?.id,
          })
        }
      >
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: Colors.primary }]} />

        <View style={styles.avatarWrapper}>
          <Avatar
            name={displayName}
            uri={resolveMediaUrl(other?.avatar ?? null)}
            size={50}
            showOnline={item.room_type === 'direct'}
            isOnline={other?.is_online ?? false}
          />
        </View>

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
            {lastMsg && (
              <Text style={[styles.chatTime, { color: unread > 0 ? Colors.primary : Colors.primary }]}>
                {formatTime(lastMsg.created_at)}
              </Text>
            )}
          </View>
          <View style={styles.chatBottomRow}>
            <Text
              style={[
                styles.lastMessage,
                typers.length > 0
                  ? { color: Colors.primary, fontStyle: 'italic' }
                  : { color: unread > 0 ? Colors.text : Colors.textSecondary, fontWeight: unread > 0 ? '600' : '400' },
              ]}
              numberOfLines={1}
            >
              {typers.length > 0
                ? (typers.length === 1
                    ? `${typers[0].username} is typing…`
                    : 'typing…')
                : lastMsg
                  ? (
                    <>
                      {lastMsg.sender_id === user?.id && (
                        <Text
                          style={{
                            color: lastMsg.status === 'read'
                              ? Colors.checkBlue
                              : Colors.textTertiary,
                          }}
                        >
                          {lastMsg.status === 'pending'
                            ? '⏱ '
                            : lastMsg.status === 'read'
                              ? '✓✓ '
                              : '✓ '}
                        </Text>
                      )}
                      {lastMsg.content}
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

    if (unread > 0) {
      return (
        <Swipeable
          renderRightActions={renderRightActions}
          overshootRight={false}
          onSwipeableOpen={(direction, swipeable) => {
            if (direction === 'right') {
              clearRoomUnread(item.id);
              swipeable.close();
            }
          }}
        >
          {row}
        </Swipeable>
      );
    }
    return row;
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {totalUnread > 0 && (
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
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={rooms.length === 0 ? styles.emptyContainer : styles.list}
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
            onRefresh={() => { setRefreshing(true); fetchRooms(); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.divider }]} />}
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: Colors.surface, borderColor: Colors.primary, shadowColor: Colors.primary }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Contacts')}
      >
        <Ionicons name="add" size={32} color={Colors.primary} />
      </TouchableOpacity>
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
