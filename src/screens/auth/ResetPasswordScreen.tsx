import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { formatApiError } from '../../services/errorMessages';
import { confirmPasswordReset } from '../../services/authService';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen({ route, navigation }: Props) {
  const { email, code } = route.params;
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  const validate = () => {
    const next: typeof errors = {};
    if (!password) next.password = 'New password is required';
    if (password.length < 8) next.password = 'Password must be at least 8 characters';
    if (!confirm) next.confirm = 'Please confirm your new password';
    if (confirm && password !== confirm) next.confirm = 'Passwords do not match';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await confirmPasswordReset(email, code, password);
      alert('Password updated', 'Your password has been reset. Please sign in with your new password.');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Unable to reset the password. Please try again.',
        statusMessages: {
          400: 'The reset code is invalid or the password is too weak.',
          404: 'No reset request found for this email.',
          410: 'The reset code has expired. Please request a new one.',
        },
      });
      alert('Reset failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      enabled={Platform.OS === 'ios'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          Platform.OS === 'android' && styles.containerAndroid,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={[styles.iconWrap, { borderColor: Colors.primary, shadowColor: Colors.primary }]}>
            <Image source={require('../../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={[styles.title, { color: Colors.primary }]}>NEW PASSWORD</Text>
          <View style={[styles.titleUnderline, { backgroundColor: Colors.accent }]} />
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>Choose a strong password for {email}.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.primary }]}>
          <Input
            label="New password"
            placeholder="Enter a new password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            error={errors.password}
            isPassword
          />
          <Input
            label="Confirm password"
            placeholder="Repeat your new password"
            value={confirm}
            onChangeText={(value) => {
              setConfirm(value);
              if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: undefined }));
            }}
            error={errors.confirm}
            isPassword
          />

          <Button title={loading ? 'UPDATING…' : 'UPDATE PASSWORD'} onPress={submit} loading={loading} style={styles.button} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  containerAndroid: {
    justifyContent: 'flex-start',
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
  },
  header: { alignItems: 'center', marginBottom: Spacing.xxl },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  logoImage: { width: 46, height: 46 },
  title: { fontSize: Font.size.title, fontWeight: '800', letterSpacing: 4 },
  titleUnderline: { width: 52, height: 2, marginTop: 6, marginBottom: Spacing.md },
  subtitle: { fontSize: Font.size.sm, textAlign: 'center', lineHeight: 20, letterSpacing: 0.4 },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  button: { marginTop: Spacing.md, borderRadius: Radius.md },
});
