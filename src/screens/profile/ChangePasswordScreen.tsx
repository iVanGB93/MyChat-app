/* ------------------------------------------------------------------ */
/*  Change Password screen                                             */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { changePassword } from '../../services/authService';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

export default function ChangePasswordScreen() {
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const navigation = useNavigation();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!current.trim()) {
      alert('Validation', 'Enter your current password.');
      return;
    }
    if (next.length < 8) {
      alert('Validation', 'New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      alert('Validation', 'The two new password fields do not match.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(current, next);
      alert('Password updated', 'Your password has been changed.', () => navigation.goBack());
    } catch (err: any) {
      const data = err?.response?.data;
      const msg =
        data?.current_password?.[0] ||
        data?.new_password?.[0] ||
        data?.detail ||
        'Failed to change password';
      alert('Error', String(msg));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
          <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ CHANGE PASSWORD</Text>
          <Text style={[styles.label, { color: Colors.textSecondary }]}>CURRENT PASSWORD</Text>
          <Input
            value={current}
            onChangeText={setCurrent}
            placeholder="Current password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.label, { color: Colors.textSecondary, marginTop: Spacing.md }]}>
            NEW PASSWORD
          </Text>
          <Input
            value={next}
            onChangeText={setNext}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.label, { color: Colors.textSecondary, marginTop: Spacing.md }]}>
            CONFIRM NEW PASSWORD
          </Text>
          <Input
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Repeat new password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.helper, { color: Colors.textTertiary }]}>
            Changing your password will sign out other devices.
          </Text>
          <Button
            title="UPDATE PASSWORD"
            onPress={handleSave}
            loading={saving}
            style={{ marginTop: Spacing.md }}
          />
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
  helper: { fontSize: Font.size.xs, marginTop: Spacing.md, letterSpacing: 0.3 },
});
