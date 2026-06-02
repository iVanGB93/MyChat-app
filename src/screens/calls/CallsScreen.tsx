/* ------------------------------------------------------------------ */
/*  Call History Screen — futuristic cyberpunk theme                  */
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Font, Spacing, Radius } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
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
  const { alert } = useConfirm();
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
      alert('Error', 'Failed to start call');
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
    const directionLabel = isOutgoing ? 'OUT' : 'IN';
    const statusColor = isMissed ? Colors.error : Colors.primary;

    const durationStr = item.duration_seconds > 0
      ? `${Math.floor(item.duration_seconds / 60)}:${String(item.duration_seconds % 60).padStart(2, '0')}`
      : null;

    return (
      <TouchableOpacity
        style={[styles.callItem, { borderColor: isMissed ? Colors.error + '30' : Colors.neonBorder }]}
        onPress={() => handleCallback(item)}
        activeOpacity={0.7}
      >
        {/* Accent bar */}
        <View style={[styles.accentBar, { backgroundColor: statusColor }]} />

        <Avatar name={otherName} size={46} />

        <View style={styles.callInfo}>
          <Text style={[styles.callName, { color: isMissed ? Colors.error : Colors.text }]}>
            {otherName.toUpperCase()}
          </Text>
          <View style={styles.callMeta}>
            <Text style={[styles.directionTag, { color: statusColor, borderColor: statusColor }]}>
              {directionLabel}
            </Text>
            <Text style={[styles.callType, { color: Colors.textSecondary }]}>
              {item.call_type === 'video' ? 'VIDEO' : 'AUDIO'}
              {durationStr ? `  ${durationStr}` : `  ${item.status.toUpperCase()}`}
            </Text>
          </View>
        </View>

        <View style={styles.callRight}>
          <Text style={[styles.callTime, { color: Colors.primary }]}>
            {formatCallTime(item.started_at)}
          </Text>
          <View style={[styles.callbackBtn, { borderColor: Colors.primary }]}>
            <Ionicons
              name={item.call_type === 'video' ? 'videocam-outline' : 'call-outline'}
              size={16}
              color={Colors.primary}
            />
          </View>
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
        data={calls}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={calls.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <EmptyState iconName="call-outline" title="No call history" subtitle="Start a call from a chat conversation" />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchCalls(); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.divider }]} />}
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
    paddingVertical: Spacing.md,
    paddingRight: Spacing.lg,
    borderBottomWidth: 0,
  },
  accentBar: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: Spacing.md,
    borderRadius: 2,
  },
  callInfo: { flex: 1, marginLeft: Spacing.md },
  callName: { fontSize: Font.size.sm, fontWeight: '700', letterSpacing: 1 },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  directionTag: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  callType: { fontSize: Font.size.xs, letterSpacing: 0.8 },
  callRight: { alignItems: 'flex-end', gap: 6 },
  callTime: { fontSize: Font.size.xs, fontWeight: '600', letterSpacing: 0.5 },
  callbackBtn: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callbackIcon: { fontSize: 14, fontWeight: '600' },
  separator: { height: 1, marginLeft: 56 },
});
