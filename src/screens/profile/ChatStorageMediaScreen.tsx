import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import {
  getLocalChatMediaItems,
  type LocalChatMediaType,
  type LocalChatStorageMediaItem,
} from '../../services/localMessageStore';
import type { RootStackParamList } from '../../types';

type MediaFilter = 'all' | LocalChatMediaType;
type ScreenRoute = RouteProp<RootStackParamList, 'ChatStorageMedia'>;

const FILTERS: Array<{ key: MediaFilter; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'image', label: 'Photos', icon: 'image-outline' },
  { key: 'video', label: 'Videos', icon: 'videocam-outline' },
  { key: 'voice', label: 'Voice', icon: 'mic-outline' },
  { key: 'document', label: 'Files', icon: 'document-text-outline' },
];

export default function ChatStorageMediaScreen() {
  const { colors: Colors } = useTheme();
  const route = useRoute<ScreenRoute>();
  const { roomId, roomName } = route.params;
  const [items, setItems] = useState<LocalChatStorageMediaItem[]>([]);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [loading, setLoading] = useState(true);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getLocalChatMediaItems(roomId));
    } catch (error) {
      console.warn('[ChatStorageMedia] failed to load local media', error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useFocusEffect(useCallback(() => {
    loadMedia().catch(() => {});
  }, [loadMedia]));

  const counts = useMemo(() => {
    const result: Record<LocalChatMediaType, number> = { image: 0, video: 0, voice: 0, document: 0 };
    for (const item of items) result[item.type] += 1;
    return result;
  }, [items]);

  const visibleItems = useMemo(
    () => filter === 'all' ? items : items.filter((item) => item.type === filter),
    [filter, items],
  );

  const storedBytes = useMemo(() => {
    const counted = new Set<string>();
    return items.reduce((total, item) => {
      if (!item.fileUri || counted.has(item.fileUri)) return total;
      counted.add(item.fileUri);
      return total + item.sizeBytes;
    }, 0);
  }, [items]);

  const unavailableCount = useMemo(() => items.filter((item) => !item.isAvailable).length, [items]);

  const renderItem = ({ item }: { item: LocalChatStorageMediaItem }) => {
    const typeInfo = FILTERS.find((entry) => entry.key === item.type)!;
    return (
      <View style={[styles.mediaRow, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <View style={[styles.preview, { backgroundColor: Colors.highlight, borderColor: Colors.neonBorder }]}>
          {item.type === 'image' && item.isAvailable && item.fileUri ? (
            <Image source={{ uri: item.fileUri }} style={styles.image} contentFit="cover" recyclingKey={item.messageId} />
          ) : (
            <Ionicons name={typeInfo.icon} size={28} color={item.isAvailable ? Colors.primary : Colors.textTertiary} />
          )}
        </View>

        <View style={styles.mediaInfo}>
          <Text style={[styles.fileName, { color: Colors.text }]} numberOfLines={1}>{item.fileName}</Text>
          <Text style={[styles.mediaMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
            {typeInfo.label.replace(/s$/, '')} · {item.isAvailable ? formatBytes(item.sizeBytes) : 'Not stored'}
          </Text>
          <Text style={[styles.mediaMeta, { color: Colors.textTertiary }]} numberOfLines={1}>
            {item.isMine ? 'You' : item.senderName} · {formatDate(item.createdAt)}
          </Text>
        </View>

        <Ionicons
          name={item.isAvailable ? 'checkmark-circle-outline' : 'cloud-offline-outline'}
          size={20}
          color={item.isAvailable ? Colors.success : Colors.textTertiary}
        />
      </View>
    );
  };

  return (
    <FlatList
      style={[styles.container, { backgroundColor: Colors.background }]}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={visibleItems}
      keyExtractor={(item) => item.messageId}
      renderItem={renderItem}
      refreshing={loading && items.length > 0}
      onRefresh={loadMedia}
      ListHeaderComponent={(
        <>
          <View style={[styles.summary, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
            <Text style={[styles.eyebrow, { color: Colors.primary }]}>MEDIA IN CHAT</Text>
            <Text style={[styles.roomName, { color: Colors.text }]} numberOfLines={1}>{roomName}</Text>
            <View style={styles.summaryNumbers}>
              <View style={styles.summaryValue}>
                <Text style={[styles.summaryNumber, { color: Colors.primary }]}>{items.length}</Text>
                <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>ITEMS</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: Colors.divider }]} />
              <View style={styles.summaryValue}>
                <Text style={[styles.summaryNumber, { color: Colors.primary }]}>{formatBytes(storedBytes)}</Text>
                <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>ON DEVICE</Text>
              </View>
            </View>
            {unavailableCount > 0 ? (
              <Text style={[styles.missingHint, { color: Colors.textTertiary }]}>
                {unavailableCount} {unavailableCount === 1 ? 'item is' : 'items are'} listed in the chat but not currently stored on this device.
              </Text>
            ) : null}
          </View>

          <FlatList
            horizontal
            data={FILTERS}
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
            renderItem={({ item }) => {
              const active = filter === item.key;
              const count = item.key === 'all' ? items.length : counts[item.key];
              return (
                <TouchableOpacity
                  style={[
                    styles.filter,
                    {
                      backgroundColor: active ? Colors.primary : Colors.surface,
                      borderColor: active ? Colors.primary : Colors.neonBorder,
                    },
                  ]}
                  onPress={() => setFilter(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons name={item.icon} size={16} color={active ? Colors.textInverse : Colors.primary} />
                  <Text style={[styles.filterText, { color: active ? Colors.textInverse : Colors.text }]}>
                    {item.label} {count}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>ALL MEDIA</Text>
        </>
      )}
      ListEmptyComponent={loading ? (
        <View style={styles.empty}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={36} color={Colors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: Colors.text }]}>No media here</Text>
          <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>This chat does not contain media in the selected category.</Text>
        </View>
      )}
    />
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  summary: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.lg },
  eyebrow: { fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1.5 },
  roomName: { fontSize: Font.size.xl, fontWeight: '800', marginTop: Spacing.xs },
  summaryNumbers: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.lg },
  summaryValue: { flex: 1, alignItems: 'center' },
  summaryNumber: { fontSize: Font.size.xl, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryLabel: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1, paddingTop: 2 },
  summaryDivider: { width: 1, height: 36 },
  missingHint: { fontSize: Font.size.xs, lineHeight: 17, textAlign: 'center', paddingTop: Spacing.md },
  filters: { gap: Spacing.sm, paddingVertical: Spacing.md },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  filterText: { fontSize: Font.size.xs, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1.5, paddingTop: Spacing.xs },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.sm },
  preview: { width: 64, height: 64, borderRadius: Radius.sm, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  mediaInfo: { flex: 1, minWidth: 0 },
  fileName: { fontSize: Font.size.sm, fontWeight: '700' },
  mediaMeta: { fontSize: Font.size.xs, paddingTop: 3 },
  empty: { alignItems: 'center', paddingVertical: Spacing.xxxl, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Font.size.md, fontWeight: '700', paddingTop: Spacing.md },
  emptyText: { fontSize: Font.size.sm, lineHeight: 19, textAlign: 'center', paddingTop: Spacing.xs },
});
