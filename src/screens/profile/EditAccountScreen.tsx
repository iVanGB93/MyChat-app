/* ------------------------------------------------------------------ */
/*  Edit Account — change username / email, plus password-confirmed   */
/*  account deletion (used as the Android fallback for delete UX).    */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Font, Radius, Spacing } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { deleteAccount, updateProfile } from '../../services/authService';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

export default function EditAccountScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { colors: Colors } = useTheme();
  const { confirm, alert } = useConfirm();
  const navigation = useNavigation();

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);

  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    const u = username.trim();
    const e = email.trim();
    if (!u) {
      alert('Validation', 'Username cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ username: u, email: e });
      await refreshUser();
      alert('Saved', 'Account info updated.', () => navigation.goBack());
    } catch (err: any) {
      const data = err?.response?.data;
      const msg =
        data?.username?.[0] ||
        data?.email?.[0] ||
        data?.detail ||
        'Failed to update account';
      alert('Error', String(msg));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!confirmPassword.trim()) {
      alert('Password required', 'Enter your current password to confirm.');
      return;
    }
    confirm({
      title: 'Delete account',
      message: 'This permanently deletes your account and all related data. This cannot be undone. Continue?',
      icon: 'trash-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount(confirmPassword.trim());
              await logout();
            } catch (err: any) {
              const msg =
                err?.response?.data?.password?.[0] ||
                err?.response?.data?.detail ||
                'Could not delete account';
              alert('Error', String(msg));
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
          <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ ACCOUNT INFO</Text>
          <Text style={[styles.label, { color: Colors.textSecondary }]}>USERNAME</Text>
          <Input
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.label, { color: Colors.textSecondary, marginTop: Spacing.md }]}>EMAIL</Text>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button title="SAVE" onPress={handleSave} loading={saving} style={{ marginTop: Spacing.md }} />
        </View>

        <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.error }]}>
          <Text style={[styles.cardTitle, { color: Colors.error }]}>◈ DELETE ACCOUNT</Text>
          <Text style={[styles.dangerDesc, { color: Colors.textSecondary }]}>
            Deleting your account is permanent — all data is removed and cannot be recovered.
            Enter your current password to confirm.
          </Text>
          <Input
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Current password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.deleteBtn, { borderColor: Colors.error, opacity: deleting ? 0.6 : 1 }]}
            onPress={handleDelete}
            disabled={deleting}
            activeOpacity={0.7}
          >
            <Text style={[styles.deleteBtnText, { color: Colors.error }]}>
              {deleting ? 'DELETING…' : 'DELETE MY ACCOUNT'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.sm, paddingBottom: Spacing.xxl },
  card: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  cardTitle: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.md },
  label: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1, marginBottom: Spacing.xs },
  dangerDesc: {
    fontSize: Font.size.sm,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  deleteBtn: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1.5,
  },
  deleteBtnText: { fontSize: Font.size.sm, fontWeight: '800', letterSpacing: 1.5 },
});
