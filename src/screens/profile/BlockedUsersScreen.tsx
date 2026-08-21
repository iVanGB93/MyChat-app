/* ------------------------------------------------------------------ */
/*  Blocked Users screen — list and unblock                            */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  BlockedUserRow,
  getBlockedUsers,
  unblockUser,
} from '../../services/contactService';
import { useAppStore } from '../../store/appStore';
import { setCachedRelationship } from '../../services/localMessageStore';
import { resolveMediaUrl } from '../../services/api';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';

export default function BlockedUsersScreen() {
  const { user } = useAuth();
  const { colors: Colors } = useTheme();
  const { confirm, alert } = useConfirm();
  const [rows, setRows] = useState<BlockedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await getBlockedUsers();
      setRows(data);
      // Keep the global store in sync so other parts of the app
      // (notifications, chat) drop blocked senders consistently.
      useAppStore.getState().setBlockedIds(data.map((r) => r.blocked));
    } catch (err) {
      console.warn('[BlockedUsers] load failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnblock = (row: BlockedUserRow) => {
    confirm({
      title: 'Unblock user',
      message: `Unblock ${row.blocked_detail.username}? They will be able to message and call you again.`,
      icon: 'person-add-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: async () => {
            setPending((p) => ({ ...p, [row.id]: true }));
            try {
              await unblockUser(row.id);
              if (user?.id != null) await setCachedRelationship(user.id, row.blocked, null);
              setRows((prev) => {
                const next = prev.filter((r) => r.id !== row.id);
                useAppStore.getState().setBlockedIds(next.map((r) => r.blocked));
                return next;
              });
            } catch (err) {
              alert('Error', 'Failed to unblock user.');
            } finally {
              setPending((p) => {
                const { [row.id]: _drop, ...rest } = p;
                return rest;
              });
            }
          },
        },
      ],
    });
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: Colors.background }}
      contentContainerStyle={rows.length === 0 ? { flex: 1 } : { paddingVertical: Spacing.sm }}
      data={rows}
      keyExtractor={(row) => String(row.id)}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={Colors.primary}
        />
      }
      ListEmptyComponent={
        <EmptyState
          icon="🚫"
          title="No blocked users"
          subtitle="People you block will appear here. You can unblock them at any time."
        />
      }
      renderItem={({ item }) => (
        <View
          style={[
            styles.row,
            {
              backgroundColor: Colors.surface,
              borderColor: Colors.neonBorder,
            },
          ]}
        >
          <Avatar
            name={item.blocked_detail.username}
            uri={resolveMediaUrl(item.blocked_detail.avatar)}
            size={44}
          />
          <View style={styles.rowInfo}>
            <Text style={[styles.username, { color: Colors.text }]} numberOfLines={1}>
              {item.blocked_detail.username}
            </Text>
            {!!item.blocked_detail.email && (
              <Text style={[styles.email, { color: Colors.textSecondary }]} numberOfLines={1}>
                {item.blocked_detail.email}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[
              styles.unblockBtn,
              {
                borderColor: Colors.primary,
                opacity: pending[item.id] ? 0.5 : 1,
              },
            ]}
            onPress={() => handleUnblock(item)}
            disabled={!!pending[item.id]}
            activeOpacity={0.7}
          >
            <Text style={[styles.unblockText, { color: Colors.primary }]}>
              {pending[item.id] ? '…' : 'UNBLOCK'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  rowInfo: { flex: 1, marginLeft: Spacing.md },
  username: { fontSize: Font.size.md, fontWeight: '700', letterSpacing: 0.4 },
  email: { fontSize: Font.size.xs, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
  },
  unblockText: { fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1 },
});
