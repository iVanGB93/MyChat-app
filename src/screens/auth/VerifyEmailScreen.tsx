/* ------------------------------------------------------------------ */
/*  VerifyEmailScreen — step 2 of registration.                        */
/*  User types the 6-digit code we emailed them; on success the        */
/*  server creates the account and returns a token pair which          */
/*  authService.verifyRegistration persists, so we can hand off to     */
/*  AuthContext.loginWithTokens() and drop the user into the app.      */
/* ------------------------------------------------------------------ */

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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/ui/Button';
import { formatApiError } from '../../services/errorMessages';
import {
  resendRegistrationCode,
  verifyRegistration,
} from '../../services/authService';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyEmail'>;

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyEmailScreen({ route, navigation }: Props) {
  const { email, expiresIn } = route.params;
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const { loginWithTokens } = useAuth();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  // Backend sends the email asynchronously (it can take a few seconds),
  // so we show a "sending" banner for a short window after arriving on
  // this screen / after a resend tap. SMTP through Office 365 usually
  // completes in 1\u20133s but we give it a generous buffer.
  const SEND_INDICATOR_MS = 4000;
  const [sending, setSending] = useState(true);

  // Cooldown countdown matches the backend's resend window so the user
  // doesn't tap a button that's guaranteed to 429.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  // Expiry countdown — purely informational, lets the user know when
  // the code will stop working.
  const [secondsLeft, setSecondsLeft] = useState(expiresIn);

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Show the "sending\u2026" banner for a short window, then assume the
  // email has landed (the server's send is fire-and-forget).
  useEffect(() => {
    if (!sending) return;
    const id = setTimeout(() => setSending(false), SEND_INDICATOR_MS);
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
      await verifyRegistration(email, submitted);
      // Tokens saved by verifyRegistration() — hydrate auth state and
      // navigation will swap to the Main stack automatically.
      await loginWithTokens();
    } catch (err: unknown) {
      const msg = formatApiError(err, {
        fallback: 'Verification failed. Please check the code and try again.',
        statusMessages: {
          400: 'Invalid code. Please check your inbox and try again.',
          404: 'No pending registration for this email. Please start over.',
          410: 'Verification code expired. Tap "Resend code" for a fresh one.',
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
      const result = await resendRegistrationCode(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setSecondsLeft(result.expires_in);
      setCode('');
      setSending(true); // show the "sending\u2026" banner again
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

  // Render the 6 cells as a visual proxy for the hidden TextInput so
  // the digits show one-per-box with a focused-cell highlight.
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');
  const focusedIndex = code.length;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={[styles.logoMark, { borderColor: Colors.accent, shadowColor: Colors.accent }]}>
            <Text style={[styles.logoText, { color: Colors.accent }]}>✉</Text>
          </View>
          <Text style={[styles.title, { color: Colors.primary }]}>VERIFY EMAIL</Text>
          <View style={[styles.titleUnderline, { backgroundColor: Colors.primary }]} />
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            Enter the 6-digit code we sent to{'\n'}
            <Text style={{ color: Colors.text, fontWeight: '700' }}>{email}</Text>
          </Text>
        </View>

        <View
          style={[
            styles.statusBanner,
            {
              backgroundColor: Colors.surface,
              borderColor: sending ? Colors.primary : Colors.accent,
              shadowColor: sending ? Colors.primary : Colors.accent,
            },
          ]}
        >
          {sending ? (
            <>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={[styles.statusText, { color: Colors.text }]}>
                Sending verification email…
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.statusIcon, { color: Colors.accent }]}>✓</Text>
              <Text style={[styles.statusText, { color: Colors.textSecondary }]}>
                Code sent — check your inbox (and spam).
              </Text>
            </>
          )}
        </View>

        <TouchableOpacity
          activeOpacity={1}
          onPress={() => inputRef.current?.focus()}
          style={[
            styles.codeCardWrap,
            { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.accent },
          ]}
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
                      borderColor: isFocused
                        ? Colors.primary
                        : digit
                        ? Colors.accent
                        : Colors.neonBorder,
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
          <Text style={[styles.expiryHint, { color: secondsLeft <= 0 ? Colors.error : Colors.textTertiary }]}>
            {expiryLabel}
          </Text>
        </TouchableOpacity>

        {/* The actual input is invisible — the cells above are only visual. */}
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

        <TouchableOpacity
          onPress={handleResend}
          disabled={cooldown > 0 || resending}
          style={styles.resendBtn}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.resendText,
              {
                color: cooldown > 0 || resending ? Colors.textTertiary : Colors.primary,
              },
            ]}
          >
            {resending
              ? 'Sending…'
              : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : 'Resend code'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={[styles.backText, { color: Colors.textSecondary }]}>
            Wrong email? Go back
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  header: { alignItems: 'center', marginBottom: Spacing.xl },
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
  logoText: { fontSize: 32, fontWeight: '800' },
  title: { fontSize: Font.size.xxl, fontWeight: '800', letterSpacing: 5 },
  titleUnderline: { width: 40, height: 2, marginTop: 6, marginBottom: Spacing.md },
  subtitle: {
    fontSize: Font.size.sm,
    letterSpacing: 0.5,
    marginTop: Spacing.xs,
    textAlign: 'center',
    lineHeight: 20,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  statusIcon: {
    fontSize: Font.size.md,
    fontWeight: '800',
    marginRight: Spacing.sm,
  },
  statusText: {
    fontSize: Font.size.sm,
    letterSpacing: 0.5,
    marginLeft: Spacing.sm,
  },
  codeCardWrap: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
    marginBottom: Spacing.md,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeCell: {
    flex: 1,
    aspectRatio: 1,
    marginHorizontal: 4,
    borderWidth: 2,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  codeDigit: { fontSize: Font.size.xl, fontWeight: '800', letterSpacing: 1 },
  expiryHint: {
    fontSize: Font.size.xs,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  verifyBtn: { marginTop: Spacing.sm, borderRadius: Radius.md },
  resendBtn: { marginTop: Spacing.lg, alignItems: 'center' },
  resendText: { fontSize: Font.size.sm, fontWeight: '700', letterSpacing: 1 },
  backBtn: { marginTop: Spacing.md, alignItems: 'center' },
  backText: { fontSize: Font.size.sm, letterSpacing: 1 },
});
