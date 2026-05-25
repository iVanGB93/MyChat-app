/* ------------------------------------------------------------------ */
/*  Call History Screen — modern purple theme                            */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Font, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { getCallHistory, initiateCall } from '../../services/callService';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import type { CallLog, RootStackParamList } from '../../types';

dayjs.extend(relativeTime);

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CallsScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { colors: Colors } = useTheme();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCalls = useCallback(async () => {
    try {
      const data = await getCallHistory();
      setCalls(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  const handleCallback = async (call: CallLog) => {
    const otherId = call.caller === user?.id ? call.callee : call.caller;
    const otherName = call.caller === user?.id ? call.callee_username : call.caller_username;
    try {
      const res = await initiateCall(otherId, call.call_type);
      navigation.navigate('ActiveCall', {
        callId: res.call_id,
        otherName,
        callType: call.call_type,
        roomName: res.room_name,
        isOutgoing: true,
        peerUserId: otherId,
      });
    } catch {
      Alert.alert('Error', 'Failed to start call');
    }
  };

  const formatCallTime = (dateStr: string) => {
    const d = dayjs(dateStr);
    const now = dayjs();
    if (d.isSame(now, 'day')) return d.format('HH:mm');
    if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday';
    return d.format('DD/MM/YY');
  };

  const renderItem = ({ item }: { item: CallLog }) => {
    const isOutgoing = item.caller === user?.id;
    const otherName = isOutgoing ? item.callee_username : item.caller_username;

    const isMissed = item.status === 'missed' || item.status === 'rejected';
    const directionArrow = isOutgoing ? '↗' : '↙';
    const arrowColor = isMissed ? Colors.error : Colors.teal;

    const durationStr = item.duration_seconds > 0
      ? `${Math.floor(item.duration_seconds / 60)}:${String(item.duration_seconds % 60).padStart(2, '0')}`
      : null;

    return (
      <TouchableOpacity style={[styles.callItem, { backgroundColor: Colors.surface }]} onPress={() => handleCallback(item)} activeOpacity={0.7}>
        <Avatar name={otherName} size={48} />
        <View style={styles.callInfo}>
          <Text style={[styles.callName, { color: Colors.text }, isMissed && { color: Colors.error }]}>{otherName}</Text>
          <View style={styles.callMeta}>
            <Text style={[styles.direction, { color: arrowColor }]}>{directionArrow}</Text>
            <Text style={[styles.callType, { color: Colors.textSecondary }]}>
              {item.call_type === 'video' ? '📹' : '📞'}{' '}
              {durationStr ?? item.status}
            </Text>
          </View>
        </View>
        <View style={styles.callRight}>
          <Text style={[styles.callTime, { color: Colors.textTertiary }]}>{formatCallTime(item.started_at)}</Text>
          <Text style={[styles.callbackIcon, { color: Colors.primary }]}>{item.call_type === 'video' ? '📹' : '📞'}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.teal} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <FlatList
        data={calls}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={calls.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <EmptyState icon="📞" title="No calls yet" subtitle="Start a call from a chat conversation" />
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchCalls(); }} colors={[Colors.primary]} />
        }
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.border }]} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: Spacing.xs },
  emptyContainer: { flexGrow: 1 },
  callItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  callInfo: { flex: 1, marginLeft: Spacing.md },
  callName: { fontSize: Font.size.md, ...Font.semiBold },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  direction: { fontSize: 14, ...Font.bold },
  callType: { fontSize: Font.size.sm },
  callRight: { alignItems: 'flex-end', gap: 6 },
  callTime: { fontSize: Font.size.xs },
  callbackIcon: { fontSize: 18 },
  separator: { height: 1, marginLeft: 80 },
});
