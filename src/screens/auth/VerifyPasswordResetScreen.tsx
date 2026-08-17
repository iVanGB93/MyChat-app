import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/ui/Button';
import { formatApiError } from '../../services/errorMessages';
import {
  resendPasswordResetCode,
  verifyPasswordReset,
} from '../../services/authService';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyPasswordReset'>;

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyPasswordResetScreen({ route, navigation }: Props) {
  const { email, expiresIn } = route.params;
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [sending, setSending] = useState(true);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [secondsLeft, setSecondsLeft] = useState(expiresIn);

  const inputRef = useRef<TextInput>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!sending) return;
    const id = setTimeout(() => setSending(false), 4000);
    return () => clearTimeout(id);
  }, [sending]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const handleVerify = async (submitted: string) => {
    if (submitted.length !== CODE_LENGTH) return;
    setVerifying(true);
    try {
      await verifyPasswordReset(email, submitted);
      navigation.navigate('ResetPassword', { email, code: submitted });
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Verification failed. Please check the code and try again.',
        statusMessages: {
          400: 'Invalid reset code. Please check your inbox and try again.',
          404: 'No password reset request found for this email.',
          410: 'Reset code expired. Tap “Resend code” for a fresh one.',
          429: 'Too many attempts. Please start over.',
        },
      });
      alert('Verification failed', msg);
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    try {
      const result = await resendPasswordResetCode(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setSecondsLeft(result.expires_in);
      setCode('');
      setSending(true);
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Could not resend the code. Please try again.',
      });
      alert('Resend failed', msg);
    } finally {
      setResending(false);
    }
  };

  const expiryLabel = (() => {
    if (secondsLeft <= 0) return 'Code expired';
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `Expires in ${m}:${String(s).padStart(2, '0')}`;
  })();

  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');
  const focusedIndex = code.length;

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
          <View style={[styles.iconWrap, { borderColor: Colors.accent, shadowColor: Colors.accent }]}>
            <Image source={require('../../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={[styles.title, { color: Colors.primary }]}>VERIFY RESET CODE</Text>
          <View style={[styles.titleUnderline, { backgroundColor: Colors.primary }]} />
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            {`Enter the 6-digit code sent to\n${email}`}
          </Text>
        </View>

        <View style={[styles.statusBanner, { backgroundColor: Colors.surface, borderColor: sending ? Colors.primary : Colors.accent, shadowColor: sending ? Colors.primary : Colors.accent }]}>
          {sending ? (
            <>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={[styles.statusText, { color: Colors.text }]}>Sending reset email…</Text>
            </>
          ) : (
            <>
              <Text style={[styles.statusIcon, { color: Colors.accent }]}>✓</Text>
              <Text style={[styles.statusText, { color: Colors.textSecondary }]}>Code sent — check your inbox.</Text>
            </>
          )}
        </View>

        <TouchableOpacity
          activeOpacity={1}
          onPress={() => inputRef.current?.focus()}
          style={[styles.codeCardWrap, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.accent }]}
        >
          <View style={styles.codeRow}>
            {cells.map((digit, i) => {
              const isFocused = i === focusedIndex && !verifying;
              return (
                <View
                  key={i}
                  style={[
                    styles.codeCell,
                    {
                      borderColor: isFocused ? Colors.primary : digit ? Colors.accent : Colors.neonBorder,
                      backgroundColor: digit ? Colors.highlight : 'transparent',
                      shadowColor: isFocused ? Colors.primary : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.codeDigit, { color: Colors.text }]}>{digit}</Text>
                </View>
              );
            })}
          </View>
          <Text style={[styles.expiryHint, { color: secondsLeft <= 0 ? Colors.error : Colors.textTertiary }]}>{expiryLabel}</Text>
        </TouchableOpacity>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(raw) => {
            const cleaned = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
            setCode(cleaned);
            if (cleaned.length === CODE_LENGTH) {
              handleVerify(cleaned);
            }
          }}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          editable={!verifying}
          style={styles.hiddenInput}
        />

        <Button
          title={verifying ? 'VERIFYING…' : 'VERIFY'}
          onPress={() => handleVerify(code)}
          loading={verifying}
          disabled={code.length !== CODE_LENGTH || verifying}
          style={styles.verifyBtn}
        />

        <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || resending}>
          <Text style={[styles.resendText, { color: cooldown > 0 ? Colors.textTertiary : Colors.primary }]}>
            {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </Text>
        </TouchableOpacity>
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
  header: { alignItems: 'center', marginBottom: Spacing.xl },
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
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    marginBottom: Spacing.md,
  },
  statusText: {
    fontSize: Font.size.sm,
    marginLeft: Spacing.sm,
  },
  statusIcon: {
    fontSize: 16,
    fontWeight: '800',
  },
  codeCardWrap: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  codeCell: {
    width: 42,
    height: 54,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  codeDigit: {
    fontSize: 24,
    fontWeight: '800',
  },
  expiryHint: {
    textAlign: 'center',
    fontSize: Font.size.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
  verifyBtn: { marginTop: Spacing.lg },
  resendText: {
    marginTop: Spacing.lg,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 1,
  },
});
