/* ------------------------------------------------------------------ */
/*  Login Screen — futuristic cyberpunk theme                         */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Spacing, Radius } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { formatApiError } from '../../services/errorMessages';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!username.trim()) e.username = 'Username is required';
    if (!password) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Login failed. Please try again.',
        statusMessages: {
          400: 'Invalid username or password.',
          401: 'Invalid username or password.',
        },
      });
      alert('Sign in failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          {/* Hex logo mark */}
          <View style={[styles.logoMark, { borderColor: Colors.primary, shadowColor: Colors.primary }]}>
            <Text style={[styles.logoText, { color: Colors.primary }]}>AX</Text>
          </View>
          <Text style={[styles.title, { color: Colors.primary }]}>AXONIC</Text>
          <View style={[styles.titleUnderline, { backgroundColor: Colors.accent }]} />
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            SECURE COMMUNICATION NETWORK
          </Text>
        </View>

        {/* Form */}
        <View style={[styles.form, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.primary }]}>
          <Input
            label="Username"
            placeholder="Enter your username"
            value={username}
            onChangeText={setUsername}
            error={errors.username}
            autoComplete="username"
          />
          <Input
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            isPassword
          />

          <Button
            title="CONNECT"
            onPress={handleLogin}
            loading={loading}
            style={styles.btn}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: Colors.textSecondary }]}>NEW TO AXONIC?</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Register')}>
            <Text style={[styles.link, { color: Colors.primary }]}> REGISTER</Text>
          </TouchableOpacity>
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
  header: { alignItems: 'center', marginBottom: Spacing.xxl },
  logoMark: {
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
  logoText: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    fontSize: Font.size.title,
    fontWeight: '800',
    letterSpacing: 8,
  },
  titleUnderline: {
    width: 48,
    height: 2,
    marginTop: 6,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Font.size.xs,
    letterSpacing: 2,
    marginTop: Spacing.xs,
  },
  form: {
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
    marginBottom: Spacing.lg,
  },
  btn: {
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
  },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.sm },
  footerText: { fontSize: Font.size.sm, letterSpacing: 1 },
  link: { fontSize: Font.size.sm, fontWeight: '700', letterSpacing: 1 },
});
