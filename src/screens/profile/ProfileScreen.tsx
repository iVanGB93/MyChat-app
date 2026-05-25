/* ------------------------------------------------------------------ */
/*  Profile Screen — modern purple theme                                */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Font, Spacing, Radius } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { updateProfile } from '../../services/authService';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import type { ConnectivityMode } from '../../types';

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { colors: Colors, preference, setPreference } = useTheme();
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [connectivityMode, setConnectivityModeState] = useState<ConnectivityMode>(
    user?.connectivity_mode ?? 'auto'
  );
  const [savingConnectivity, setSavingConnectivity] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ bio });
      await refreshUser();
      Alert.alert('Saved', 'Profile updated');
    } catch {
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConnectivity = async (mode: ConnectivityMode) => {
    setConnectivityModeState(mode);
    setSavingConnectivity(true);
    try {
      await updateProfile({ connectivity_mode: mode } as any);
      await refreshUser();
    } catch {
      Alert.alert('Error', 'Failed to save connectivity preference');
    } finally {
      setSavingConnectivity(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  if (!user) return null;

  return (
    <ScrollView style={[styles.container, { backgroundColor: Colors.surfaceVariant }]} contentContainerStyle={styles.content}>
      {/* Avatar section */}
      <View style={[styles.avatarSection, { backgroundColor: Colors.surface }]}>
        <View style={[styles.avatarRing, { borderColor: Colors.primary }]}>
          <Avatar name={user.username} uri={user.avatar} size={100} />
        </View>
        <Text style={[styles.username, { color: Colors.text }]}>{user.username}</Text>
        <Text style={[styles.email, { color: Colors.textSecondary }]}>{user.email}</Text>
        <View style={[styles.statusBadge, { backgroundColor: Colors.surfaceVariant }]}>
          <View style={[styles.statusDot, { backgroundColor: Colors.online }]} />
          <Text style={[styles.statusText, { color: Colors.textSecondary }]}>Online</Text>
        </View>
      </View>

      {/* About card */}
      <View style={[styles.card, { backgroundColor: Colors.surface }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: Colors.primary }]}>About</Text>
        </View>
        <Input
          placeholder="Write something about yourself…"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={200}
        />
        <Button title="Save" onPress={handleSave} loading={saving} style={[styles.saveBtn, { backgroundColor: Colors.primary, shadowColor: Colors.primary }]} />
      </View>

      {/* Account info card */}
      <View style={[styles.card, { backgroundColor: Colors.surface }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: Colors.primary }]}>Account</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomColor: Colors.border }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>Username</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.username}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomColor: Colors.border }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>Email</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.email}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0, borderBottomColor: Colors.border }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>User ID</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.id}</Text>
        </View>
      </View>

      {/* Theme card */}
      <View style={[styles.card, { backgroundColor: Colors.surface }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: Colors.primary }]}>Theme</Text>
        </View>
        <View style={styles.themeRow}>
          {([
            { key: 'system' as const, label: '📱 System', desc: 'Follow device' },
            { key: 'light' as const,  label: '☀️ Light',  desc: '' },
            { key: 'dark' as const,   label: '🌙 Dark',   desc: '' },
          ]).map((opt) => {
            const active = preference === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.themeOption,
                  { borderColor: active ? Colors.primary : Colors.border,
                    backgroundColor: active ? Colors.primaryLight + '22' : 'transparent' },
                ]}
                onPress={() => setPreference(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.themeLabel, { color: active ? Colors.primary : Colors.text }]}>
                  {opt.label}
                </Text>
                {opt.desc ? (
                  <Text style={[styles.themeDesc, { color: Colors.textSecondary }]}>{opt.desc}</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Connectivity card */}
      <View style={[styles.card, { backgroundColor: Colors.surface }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: Colors.primary }]}>Call Connectivity</Text>
        </View>
        <Text style={[styles.connectivityDesc, { color: Colors.textSecondary }]}>
          Controls how call connections are established. "Auto" tries a direct peer-to-peer path
          first and falls back to a relay server automatically.
        </Text>
        <View style={styles.connectivityRow}>
          {([
            {
              key: 'auto' as ConnectivityMode,
              label: '🔀 Auto',
              desc: 'P2P → relay',
            },
            {
              key: 'p2p' as ConnectivityMode,
              label: '⚡ P2P Only',
              desc: 'No relay',
            },
            {
              key: 'server' as ConnectivityMode,
              label: '🖥️ Server',
              desc: 'Always relay',
            },
          ]).map((opt) => {
            const active = connectivityMode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.connectivityOption,
                  {
                    borderColor: active ? Colors.primary : Colors.border,
                    backgroundColor: active ? Colors.primaryLight + '22' : 'transparent',
                    opacity: savingConnectivity ? 0.6 : 1,
                  },
                ]}
                onPress={() => handleSaveConnectivity(opt.key)}
                disabled={savingConnectivity}
                activeOpacity={0.7}
              >
                <Text style={[styles.connectivityLabel, { color: active ? Colors.primary : Colors.text }]}>
                  {opt.label}
                </Text>
                <Text style={[styles.connectivitySubLabel, { color: Colors.textSecondary }]}>
                  {opt.desc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={[styles.logoutBtn, { backgroundColor: Colors.surface, borderColor: Colors.error }]} onPress={handleLogout} activeOpacity={0.7}>
        <Text style={[styles.logoutText, { color: Colors.error }]}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: Spacing.xxl },

  avatarSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  avatarRing: {
    padding: 4,
    borderRadius: 60,
    borderWidth: 2.5,
  },
  username: { fontSize: Font.size.xl, marginTop: Spacing.md, ...Font.bold },
  email: { fontSize: Font.size.sm, marginTop: Spacing.xs },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: Spacing.xs },
  statusText: { fontSize: Font.size.sm, ...Font.medium },

  card: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.sm,
  },
  cardHeader: {
    marginBottom: Spacing.md,
  },
  cardTitle: { fontSize: Font.size.sm, ...Font.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  saveBtn: {
    marginTop: Spacing.sm,
    borderRadius: Radius.pill,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  infoLabel: { fontSize: Font.size.md },
  infoValue: { fontSize: Font.size.md, ...Font.medium },

  logoutBtn: {
    marginTop: Spacing.md,
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  logoutText: { fontSize: Font.size.md, ...Font.semiBold },

  themeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  themeLabel: {
    fontSize: Font.size.sm,
    ...Font.semiBold,
  },
  themeDesc: {
    fontSize: Font.size.xs,
    marginTop: 2,
  },

  connectivityDesc: {
    fontSize: Font.size.sm,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  connectivityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  connectivityOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  connectivityLabel: {
    fontSize: Font.size.sm,
    ...Font.semiBold,
    textAlign: 'center',
  },
  connectivitySubLabel: {
    fontSize: Font.size.xs,
    marginTop: 2,
    textAlign: 'center',
  },
});
