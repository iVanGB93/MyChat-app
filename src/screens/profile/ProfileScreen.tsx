/* ------------------------------------------------------------------ */
/*  Profile Screen — futuristic cyberpunk theme                       */
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
    <ScrollView style={[styles.container, { backgroundColor: Colors.background }]} contentContainerStyle={styles.content}>
      {/* Avatar section */}
      <View style={[styles.avatarSection, { backgroundColor: Colors.surface, borderBottomColor: Colors.neonBorder }]}>
        <Avatar name={user.username} uri={user.avatar} size={100} />
        <Text style={[styles.username, { color: Colors.primary }]}>{user.username.toUpperCase()}</Text>
        <Text style={[styles.email, { color: Colors.textSecondary }]}>{user.email}</Text>
        <View style={[styles.statusBadge, { backgroundColor: Colors.surface, borderColor: Colors.online, shadowColor: Colors.online }]}>
          <View style={[styles.statusDot, { backgroundColor: Colors.online, shadowColor: Colors.online }]} />
          <Text style={[styles.statusText, { color: Colors.online }]}>ONLINE</Text>
        </View>
      </View>

      {/* About card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ ABOUT</Text>
        <Input
          placeholder="Write something about yourself…"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={200}
        />
        <Button title="SAVE" onPress={handleSave} loading={saving} style={styles.saveBtn} />
      </View>

      {/* Account info card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ ACCOUNT</Text>
        <View style={[styles.infoRow, { borderBottomColor: Colors.divider }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>USERNAME</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.username}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomColor: Colors.divider }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>EMAIL</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.email}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>NODE ID</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.id}</Text>
        </View>
      </View>

      {/* Theme card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ DISPLAY</Text>
        <View style={styles.themeRow}>
          {([
            { key: 'system' as const, label: 'SYSTEM' },
            { key: 'light' as const,  label: 'LIGHT' },
            { key: 'dark' as const,   label: 'DARK' },
          ]).map((opt) => {
            const active = preference === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.themeOption,
                  {
                    borderColor: active ? Colors.primary : Colors.neonBorder,
                    backgroundColor: active ? Colors.highlight : 'transparent',
                    shadowColor: active ? Colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setPreference(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.themeLabel, { color: active ? Colors.primary : Colors.textSecondary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Connectivity card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ CALL CONNECTIVITY</Text>
        <Text style={[styles.connectivityDesc, { color: Colors.textSecondary }]}>
          Controls how call connections are established. Auto tries P2P first and falls back to relay.
        </Text>
        <View style={styles.connectivityRow}>
          {([
            { key: 'auto' as ConnectivityMode,   label: 'AUTO',   desc: 'P2P → relay' },
            { key: 'p2p' as ConnectivityMode,    label: 'P2P',    desc: 'Direct only' },
            { key: 'server' as ConnectivityMode, label: 'RELAY',  desc: 'Server only' },
          ]).map((opt) => {
            const active = connectivityMode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.connectivityOption,
                  {
                    borderColor: active ? Colors.primary : Colors.neonBorder,
                    backgroundColor: active ? Colors.highlight : 'transparent',
                    opacity: savingConnectivity ? 0.6 : 1,
                    shadowColor: active ? Colors.primary : 'transparent',
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
      <TouchableOpacity
        style={[styles.logoutBtn, { borderColor: Colors.error, shadowColor: Colors.error }]}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Text style={[styles.logoutText, { color: Colors.error }]}>◉ DISCONNECT</Text>
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
    borderBottomWidth: 1,
  },
  username: { fontSize: Font.size.xl, marginTop: Spacing.md, fontWeight: '800', letterSpacing: 3 },
  email: { fontSize: Font.size.sm, marginTop: Spacing.xs, letterSpacing: 0.5 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: Spacing.xs,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.5 },

  card: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.sm,
    borderWidth: 1,
  },
  cardTitle: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.md },
  saveBtn: {
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
  },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  infoLabel: { fontSize: Font.size.sm, letterSpacing: 1, fontWeight: '600' },
  infoValue: { fontSize: Font.size.sm, fontWeight: '500' },

  logoutBtn: {
    marginTop: Spacing.md,
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  logoutText: { fontSize: Font.size.sm, fontWeight: '800', letterSpacing: 2 },

  themeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  themeLabel: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 1,
  },

  connectivityDesc: {
    fontSize: Font.size.sm,
    lineHeight: 20,
    marginBottom: Spacing.md,
    letterSpacing: 0.2,
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
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  connectivityLabel: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
  },
  connectivitySubLabel: {
    fontSize: Font.size.xs,
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
