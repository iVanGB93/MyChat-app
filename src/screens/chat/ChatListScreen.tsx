/* ------------------------------------------------------------------ */
/*  Chat List Screen — modern purple theme                             */
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
import { Font, Spacing } from '../../theme';
import { getRooms } from '../../services/chatService';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
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

  const fetchRooms = useCallback(async () => {
    try {
      const data = await getRooms();
      setRooms(data);
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

  const renderItem = ({ item }: { item: ChatRoom }) => {
    const displayName = getRoomDisplayName(item);
    const other = getOtherMember(item);
    const lastMsg = item.last_message;

    return (
      <TouchableOpacity
        style={[styles.chatItem, { backgroundColor: Colors.surface }]}
        activeOpacity={0.6}
        onPress={() =>
          navigation.navigate('ChatRoom', {
            roomId: item.id,
            roomName: displayName,
            otherUserId: other?.id,
          })
        }
      >
        <View style={[styles.avatarContainer, { shadowColor: Colors.primary }]}>
          <Avatar
            name={displayName}
            uri={null}
            size={52}
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
              <Text style={[styles.chatTime, { color: Colors.textTertiary }]}>{formatTime(lastMsg.created_at)}</Text>
            )}
          </View>
          <Text style={[styles.lastMessage, { color: Colors.textSecondary }]} numberOfLines={1}>
            {lastMsg ? lastMsg.content : 'Tap to start chatting'}
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
            icon="💬"
            title="No conversations yet"
            subtitle="Add contacts and start chatting!"
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
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.border }]} />}
      />

      {/* FAB — new chat */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: Colors.primary, shadowColor: Colors.primary }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Contacts')}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flexGrow: 1 },
  list: { paddingBottom: Spacing.md },

  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
  },
  avatarContainer: {
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  chatInfo: { flex: 1, marginLeft: Spacing.md },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName: { fontSize: Font.size.md, flex: 1, ...Font.semiBold },
  chatTime: { fontSize: Font.size.xs, marginLeft: Spacing.sm },
  lastMessage: { fontSize: Font.size.sm, marginTop: 3 },

  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 80,
  },

  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabIcon: {
    fontSize: 30,
    color: '#fff',
    lineHeight: 32,
    ...Font.bold,
  },
});
