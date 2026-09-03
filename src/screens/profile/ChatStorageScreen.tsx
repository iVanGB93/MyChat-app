/* ------------------------------------------------------------------ */
/*  Chat Storage — local device cache details                          */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Font, Radius, Spacing } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getRooms } from '../../services/chatService';
import {
  deleteRoomMessages,
  getLocalChatStorageStats,
  type LocalChatStorageStats,
} from '../../services/localMessageStore';
import type { ChatRoom, RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ChatStorageScreen() {
  const { colors: Colors } = useTheme();
  const { user } = useAuth();
  const { confirm, alert } = useConfirm();
  const navigation = useNavigation<Nav>();
  const [stats, setStats] = useState<LocalChatStorageStats | null>(null);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const [storage, rooms] = await Promise.all([
        getLocalChatStorageStats(),
        getRooms().catch(() => [] as ChatRoom[]),
      ]);
      const names: Record<string, string> = {};
      for (const room of rooms) {
        if (room.room_type === 'direct') {
          const other = room.members_detail.find((member) => member.id !== user?.id);
          names[room.id] = other?.display_name || other?.username || 'Direct chat';
        } else {
          names[room.id] = room.name || 'Group chat';
        }
      }
      setStats(storage);
      setRoomNames(names);
    } catch (err) {
      console.warn('[ChatStorage] failed to inspect local storage', err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    loadStats().catch(() => {});
  }, [loadStats]));

  const handleDeleteRoom = (roomId: string, roomName: string) => {
    confirm({
      title: 'Remove local chat data?',
      message: `This removes ${roomName}'s messages and downloaded media from this phone only. The conversation remains available to the other person and may download again if new messages arrive.`,
      icon: 'trash-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete from device',
          style: 'destructive',
          onPress: async () => {
            setDeletingRoomId(roomId);
            try {
              await deleteRoomMessages(roomId);
              await loadStats();
            } catch (err) {
              console.warn('[ChatStorage] unable to delete room storage', err);
              alert('Could not delete data', 'Please try again.');
            } finally {
              setDeletingRoomId(null);
            }
          },
        },
      ],
    });
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: Colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.totalCard, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <View style={styles.titleRow}>
          <View>
            <Text style={[styles.title, { color: Colors.primary }]}>DEVICE CHAT STORAGE</Text>
            <Text style={[styles.hint, { color: Colors.textSecondary }]}>Stored only on this phone</Text>
          </View>
          <TouchableOpacity
            style={[styles.refresh, { backgroundColor: Colors.highlight, borderColor: Colors.neonBorder }]}
            onPress={loadStats}
            disabled={loading}
            accessibilityLabel="Refresh storage details"
          >
            <Ionicons name="refresh" color={Colors.primary} size={18} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
        ) : stats ? (
          <View style={[styles.total, { backgroundColor: Colors.highlight, borderColor: Colors.primary }]}>
            <Text style={[styles.totalValue, { color: Colors.primary }]}>{formatBytes(stats.totalBytes)}</Text>
            <Text style={[styles.totalLabel, { color: Colors.textSecondary }]}>CHAT DATA ON THIS DEVICE</Text>
            <Text style={[styles.detail, { color: Colors.textTertiary }]}>Database {formatBytes(stats.databaseBytes)} · Media {formatBytes(stats.mediaBytes)}</Text>
          </View>
        ) : (
          <Text style={[styles.error, { color: Colors.textSecondary }]}>Storage information is temporarily unavailable.</Text>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>BY CHAT</Text>
      {loading ? null : stats?.rooms.length ? (
        <View style={[styles.list, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
          {stats.rooms.map((room, index) => {
            const roomName = roomNames[room.roomId] || 'Chat';
            const isDeleting = deletingRoomId === room.roomId;
            return (
              <View key={room.roomId} style={[styles.room, { borderBottomColor: Colors.divider, borderBottomWidth: index === stats.rooms.length - 1 ? 0 : 1 }]}>
                <TouchableOpacity
                  style={styles.roomInfo}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('ChatStorageMedia', { roomId: room.roomId, roomName })}
                  accessibilityLabel={`View media stored for ${roomName}`}
                >
                  <View style={styles.roomTitleRow}>
                    <Text style={[styles.roomName, { color: Colors.text }]} numberOfLines={1}>{roomName}</Text>
                    <Ionicons name="chevron-forward" size={17} color={Colors.textTertiary} />
                  </View>
                  <Text style={[styles.roomMeta, { color: Colors.textSecondary }]}>
                    {room.messageCount} {room.messageCount === 1 ? 'message' : 'messages'} · {room.mediaCount} media · {formatBytes(room.totalBytes)}
                  </Text>
                  {room.mediaCount > 0 ? (
                    <View style={styles.mediaSummary}>
                      <MediaSummary icon="image-outline" count={room.media.image.count} bytes={room.media.image.bytes} color={Colors.textTertiary} />
                      <MediaSummary icon="videocam-outline" count={room.media.video.count} bytes={room.media.video.bytes} color={Colors.textTertiary} />
                      <MediaSummary icon="mic-outline" count={room.media.voice.count} bytes={room.media.voice.bytes} color={Colors.textTertiary} />
                      <MediaSummary icon="document-text-outline" count={room.media.document.count} bytes={room.media.document.bytes} color={Colors.textTertiary} />
                    </View>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deleteButton, { backgroundColor: Colors.highlight, borderColor: Colors.neonBorder, opacity: isDeleting ? 0.55 : 1 }]}
                  onPress={() => handleDeleteRoom(room.roomId, roomName)}
                  disabled={isDeleting}
                  accessibilityLabel={`Delete ${roomName} data from this device`}
                >
                  {isDeleting ? <ActivityIndicator size="small" color={Colors.primary} /> : <Ionicons name="trash-outline" size={18} color={Colors.primary} />}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : !loading && stats ? (
        <Text style={[styles.empty, { color: Colors.textSecondary }]}>No messages are stored on this device yet.</Text>
      ) : null}
      <Text style={[styles.footnote, { color: Colors.textTertiary }]}>Per-chat database amounts are estimates because SQLite shares storage pages and indexes across chats.</Text>
    </ScrollView>
  );
}

function MediaSummary({
  icon,
  count,
  bytes,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  bytes: number;
  color: string;
}) {
  if (!count) return null;
  return (
    <View style={styles.mediaSummaryItem}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.mediaSummaryText, { color }]}>{count} · {formatBytes(bytes)}</Text>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  totalCard: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.lg },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1.5 },
  hint: { fontSize: Font.size.xs, marginTop: 3 },
  refresh: { width: 36, height: 36, borderWidth: 1, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  loading: { paddingVertical: Spacing.xl, alignItems: 'center' },
  total: { marginTop: Spacing.lg, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.lg, alignItems: 'center' },
  totalValue: { fontSize: Font.size.xxl, fontWeight: '800', letterSpacing: 1 },
  totalLabel: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 },
  detail: { fontSize: Font.size.xs, marginTop: 6 },
  error: { textAlign: 'center', paddingVertical: Spacing.xl, fontSize: Font.size.sm },
  sectionTitle: { marginTop: Spacing.xl, marginBottom: Spacing.sm, fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1.5 },
  list: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.lg },
  room: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md },
  roomInfo: { flex: 1, paddingRight: Spacing.md },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  roomName: { flex: 1, fontSize: Font.size.md, fontWeight: '700' },
  roomMeta: { fontSize: Font.size.xs, marginTop: 3 },
  mediaSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingTop: Spacing.sm },
  mediaSummaryItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  mediaSummaryText: { fontSize: Font.size.xs, fontVariant: ['tabular-nums'] },
  deleteButton: { width: 38, height: 38, borderWidth: 1, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', paddingVertical: Spacing.xl, fontSize: Font.size.sm },
  footnote: { fontSize: Font.size.xs, lineHeight: 17, marginTop: Spacing.lg, textAlign: 'center', paddingHorizontal: Spacing.md },
});
