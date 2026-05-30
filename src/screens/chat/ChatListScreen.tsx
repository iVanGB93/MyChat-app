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
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Font, Spacing, Radius } from '../../theme';
import { getRooms } from '../../services/chatService';
import { getLastMessagePerRoom } from '../../services/localMessageStore';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotificationContext } from '../../contexts/NotificationContext';
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
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [localLastMessages, setLocalLastMessages] = useState<Record<string, { content: string; created_at: string } | null>>({});

  const fetchRooms = useCallback(async () => {
    try {
      const data = await getRooms();
      setRooms(data);
      // Load last messages from local DB for all rooms
      const localMsgsMap = await getLastMessagePerRoom();
      const map: Record<string, { content: string; created_at: string } | null> = {};
      for (const [roomId, msg] of Object.entries(localMsgsMap)) {
        map[roomId] = { content: msg.content ?? '', created_at: msg.created_at };
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
    const local = localLastMessages[room.id];
    const server = room.last_message;
    // Prefer whichever is more recent
    if (local && server) {
      return new Date(local.created_at) >= new Date(server.created_at) ? local : server;
    }
    return local ?? server ?? null;
  };

  const renderItem = ({ item }: { item: ChatRoom }) => {
    const displayName = getRoomDisplayName(item);
    const other = getOtherMember(item);
    const lastMsg = getLastMessage(item);

    return (
      <TouchableOpacity
        style={[styles.chatItem, { borderColor: Colors.neonBorder }]}
        activeOpacity={0.7}
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
            uri={null}
            size={50}
            showOnline={item.room_type === 'direct'}
            isOnline={other?.is_online ?? false}
          />
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={[styles.chatName, { color: Colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {lastMsg && (
              <Text style={[styles.chatTime, { color: Colors.primary }]}>
                {formatTime(lastMsg.created_at)}
              </Text>
            )}
          </View>
          <Text style={[styles.lastMessage, { color: Colors.textSecondary }]} numberOfLines={1}>
            {lastMsg ? lastMsg.content : '— no messages yet —'}
          </Text>
        </View>
      </TouchableOpacity>
    );
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
  lastMessage: { fontSize: Font.size.sm, marginTop: 3, letterSpacing: 0.2 },

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
