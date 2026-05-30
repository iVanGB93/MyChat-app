/* ------------------------------------------------------------------ */
/*  DebugOverlay                                                       */
/*                                                                     */
/*  Floating panel showing real-time global store state. Visible only  */
/*  in dev mode (__DEV__). Tap the FAB to expand/collapse, long-press  */
/*  to hide for the rest of the session.                               */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useAppStore } from './appStore';

const COLOR_OK = '#10B981';
const COLOR_WARN = '#F59E0B';
const COLOR_BAD = '#EF4444';
const COLOR_MUTED = '#9CA3AF';

function statusColor(status: string): string {
  if (status === 'connected' || status === 'online' || status === 'active') return COLOR_OK;
  if (status === 'connecting' || status === 'reconnecting' || status === 'inactive') return COLOR_WARN;
  if (status === 'disconnected' || status === 'no-internet' || status === 'offline') return COLOR_BAD;
  return COLOR_MUTED;
}

export function DebugOverlay() {
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  const user = useAppStore((s) => s.user);
  const net = useAppStore((s) => s.net);
  const appLifecycle = useAppStore((s) => s.appLifecycle);
  const notifWs = useAppStore((s) => s.notifWs);
  const chatRooms = useAppStore((s) => s.chatRooms);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const unreadByRoom = useAppStore((s) => s.unreadByRoom);
  const activeCall = useAppStore((s) => s.activeCall);
  const fgService = useAppStore((s) => s.foregroundServiceRunning);

  if (!__DEV__ || hidden) return null;

  const dotColor = notifWs.authenticated
    ? COLOR_OK
    : statusColor(notifWs.status);

  if (!expanded) {
    return (
      <TouchableOpacity
        onPress={() => setExpanded(true)}
        onLongPress={() => setHidden(true)}
        style={styles.fab}
        activeOpacity={0.7}
      >
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.fabLabel}>DBG</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>App Store</Text>
        <TouchableOpacity onPress={() => setExpanded(false)}>
          <Text style={styles.close}>×</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 8 }}>
        <Row label="user" value={user ? `${user.username} (#${user.id})` : '—'} />

        <Section title="lifecycle" />
        <Row label="appLifecycle" value={appLifecycle} color={statusColor(appLifecycle)} />
        <Row label="net" value={net} color={statusColor(net)} />
        <Row label="fgService" value={fgService ? 'running' : 'stopped'} color={fgService ? COLOR_OK : COLOR_MUTED} />

        <Section title="notifWs" />
        <Row label="status" value={notifWs.status} color={statusColor(notifWs.status)} />
        <Row label="auth" value={notifWs.authenticated ? 'yes' : 'no'} color={notifWs.authenticated ? COLOR_OK : COLOR_MUTED} />
        {notifWs.lastCloseCode !== null && (
          <Row label="lastClose" value={String(notifWs.lastCloseCode)} color={notifWs.lastCloseCode === 1011 ? COLOR_BAD : COLOR_MUTED} />
        )}
        {notifWs.suspendedUntil > Date.now() && (
          <Row label="suspended" value={`${Math.round((notifWs.suspendedUntil - Date.now()) / 1000)}s`} color={COLOR_BAD} />
        )}

        <Section title="chat" />
        <Row label="activeRoom" value={activeRoomId ?? '—'} />
        {Object.entries(chatRooms).map(([id, r]) => (
          <Row
            key={id}
            label={`room ${id}`}
            value={`${r.status}${r.authenticated ? ' ✓' : ''}`}
            color={statusColor(r.status)}
          />
        ))}
        {Object.entries(unreadByRoom).length > 0 && (
          <>
            <Section title="unread" />
            {Object.entries(unreadByRoom).map(([id, count]) => (
              <Row key={id} label={`room ${id}`} value={String(count)} />
            ))}
          </>
        )}

        {activeCall && (
          <>
            <Section title="call" />
            <Row label="peer" value={activeCall.peerName} />
            <Row label="state" value={activeCall.state} color={statusColor(activeCall.state === 'connected' ? 'connected' : 'connecting')} />
          </>
        )}
      </ScrollView>

      <Text style={styles.hint}>Long-press FAB to hide</Text>
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  fabLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  panel: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 8,
    width: 260,
    maxHeight: 460,
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    zIndex: 9999,
    elevation: 9999,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  close: {
    color: '#fff',
    fontSize: 18,
    paddingHorizontal: 6,
  },
  body: {
    maxHeight: 380,
  },
  section: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  rowLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    flex: 1,
  },
  rowValue: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 150,
    textAlign: 'right',
  },
  hint: {
    color: '#6B7280',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
  },
});
