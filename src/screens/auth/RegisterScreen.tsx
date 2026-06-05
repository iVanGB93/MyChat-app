/* ------------------------------------------------------------------ */
/*  Register Screen — futuristic cyberpunk theme                      */
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
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Spacing, Radius } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { requestRegistration } from '../../services/authService';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { formatApiError } from '../../services/errorMessages';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!username.trim()) e.username = 'Username is required';
    if (!email.trim()) e.email = 'Email is required';
    if (password.length < 8) e.password = 'At least 8 characters';
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      // Strict gating: the server does NOT create the User yet — it
      // only emails a 6-digit code. We hand off to VerifyEmailScreen
      // where the account actually gets created on successful verify.
      const trimmedEmail = email.trim().toLowerCase();
      const result = await requestRegistration(
        username.trim(),
        trimmedEmail,
        password,
        displayName.trim(),
      );
      navigation.navigate('VerifyEmail', {
        email: result.email,
        expiresIn: result.expires_in,
      });
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Registration failed. Please try again.',
        statusMessages: {
          503: 'We could not send a verification email right now. Please try again in a moment.',
        },
      });
      alert('Registration failed', msg);
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
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.logoMark, { borderColor: Colors.accent, shadowColor: Colors.accent }]}>
            <Image source={require('../../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={[styles.title, { color: Colors.primary }]}>CREATE ACCOUNT</Text>
          <View style={[styles.titleUnderline, { backgroundColor: Colors.primary }]} />
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>INITIALIZE YOUR PROFILE</Text>
        </View>

        {/* Form */}
        <View style={[styles.form, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.accent }]}>
          <Input
            label="Username"
            placeholder="Choose a username"
            value={username}
            onChangeText={setUsername}
            error={errors.username}
            autoComplete="username"
          />
          <Input
            label="Display name"
            placeholder="Shown to other users (optional)"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            maxLength={50}
          />
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            keyboardType="email-address"
            autoComplete="email"
          />
          <Input
            label="Password"
            placeholder="Min. 8 characters"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            isPassword
          />
          <Input
            label="Confirm Password"
            placeholder="Re-enter password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={errors.confirmPassword}
            isPassword
          />

          <Button title="INITIALIZE" onPress={handleRegister} loading={loading} style={styles.btn} />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: Colors.textSecondary }]}>ALREADY REGISTERED?</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={[styles.link, { color: Colors.primary }]}> SIGN IN</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  containerAndroid: { justifyContent: 'flex-start', paddingTop: Spacing.xxl },
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
  logoImage: { width: 46, height: 46 },
  title: {
    fontSize: Font.size.xxl,
    fontWeight: '800',
    letterSpacing: 5,
  },
  titleUnderline: {
    width: 40,
    height: 2,
    marginTop: 6,
    marginBottom: Spacing.sm,
  },
  subtitle: { fontSize: Font.size.xs, letterSpacing: 2, marginTop: Spacing.xs },
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
