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
import { formatApiError } from '../../services/errorMessages';
import { requestPasswordReset } from '../../services/authService';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen({ navigation }: Props) {
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const result = await requestPasswordReset(trimmed);
      navigation.navigate('VerifyPasswordReset', {
        email: result.email,
        expiresIn: result.expires_in,
      });
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Could not send the reset email. Please try again.',
      });
      alert('Reset request failed', msg);
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
          <Text style={[styles.title, { color: Colors.primary }]}>RESET PASSWORD</Text>
          <View style={[styles.titleUnderline, { backgroundColor: Colors.accent }]} />
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            Enter your email address and we’ll send a 6-digit code to reset your password.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.primary }]}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (error) setError(undefined);
            }}
            error={error}
            autoComplete="email"
            keyboardType="email-address"
          />

          <Button
            title={loading ? 'SENDING…' : 'SEND CODE'}
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            style={styles.button}
          />
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
  title: {
    fontSize: Font.size.title,
    fontWeight: '800',
    letterSpacing: 4,
  },
  titleUnderline: {
    width: 52,
    height: 2,
    marginTop: 6,
    marginBottom: Spacing.md,
  },
  subtitle: {
    fontSize: Font.size.sm,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0.4,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  button: {
    marginTop: Spacing.md,
    borderRadius: Radius.md,
  },
});
