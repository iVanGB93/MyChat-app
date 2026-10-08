import {callHistoryStyles as styles} from './call-history-styles';
import { useContactName } from '../../hooks/useContactName';
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
import { useAuth } from '../../contexts/AuthContext';
import { getCallHistory } from '../../services/callService';
import { getCachedCallHistory } from '../../services/localMessageStore';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import type { CallLog, RootStackParamList } from '../../types';

dayjs.extend(relativeTime);

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CallsScreen() {
  const contactName = useContactName();
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { colors: Colors } = useTheme();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const syncCalls = useCallback(async (force = false) => {
    try {
      const data = await getCallHistory(force);
      setCalls(data);
    } catch { /* ignore */ } finally {
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cached = user?.id != null ? await getCachedCallHistory(user.id) : [];
        if (active && cached.length) setCalls(cached);
      } catch { /* cache is best-effort */ } finally {
        if (active) setLoading(false);
      }
      syncCalls().catch(() => {});
    })();
    return () => { active = false; };
  }, [user?.id, syncCalls]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { void syncCalls(); });
    return unsub;
  }, [navigation, syncCalls]);

  const handleCallback = async (call: CallLog) => {
    const otherId = call.caller === user?.id ? call.callee : call.caller;
    const otherName = contactName(otherId, call.caller === user?.id ? call.callee_username : call.caller_username);
    navigation.navigate('OutgoingCall', { otherName, callType: call.call_type, peerUserId: otherId });
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
    const otherName = contactName(isOutgoing ? item.callee : item.caller, isOutgoing ? item.callee_username : item.caller_username);
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
            onRefresh={() => { setRefreshing(true); syncCalls(true); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.divider }]} />}
      />
    </View>
  );
}

