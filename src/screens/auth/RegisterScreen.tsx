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
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Spacing, Radius } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const { colors: Colors } = useTheme();
  const [username, setUsername] = useState('');
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
      await register(username.trim(), email.trim(), password);
    } catch (err: any) {
      const data = err.response?.data;
      if (data && typeof data === 'object') {
        const msgs = Object.values(data).flat().join('\n');
        Alert.alert('Registration Error', msgs || 'Something went wrong');
      } else {
        Alert.alert('Error', 'Registration failed');
      }
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
          <View style={[styles.logoMark, { borderColor: Colors.accent, shadowColor: Colors.accent }]}>
            <Text style={[styles.logoText, { color: Colors.accent }]}>+</Text>
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
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 0,
  },
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
