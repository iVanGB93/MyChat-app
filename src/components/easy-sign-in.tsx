import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useConfirm } from '../contexts/ConfirmContext';
import Input from './ui/Input';
import Button from './ui/Button';
import { formatApiError } from '../services/errorMessages';
import { adoptEasyAuthResult, easyAuthRequest, EasyAuthError, googleSignInAvailable, signInWithGoogle, type EasyAuthResult, type SignInChallenge } from '../services/easy-auth';

export default function EasySignIn({ disabled, onBusy, googleOnly = false }: { disabled: boolean; onBusy: (value: boolean) => void; googleOnly?: boolean }) {
  const { colors: c } = useTheme();
  const { loginWithTokens } = useAuth();
  const { alert } = useConfirm();
  // This package enforces native availability on import. Older clients must
  // never load it; configured new builds use Google's provided branded button.
  const GoogleButton: typeof import('@react-native-google-signin/google-signin').GoogleSigninButton | null =
    googleSignInAvailable() ? require('@react-native-google-signin/google-signin').GoogleSigninButton : null;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [needsUsername, setNeedsUsername] = useState(false);
  const [challenge, setChallenge] = useState<SignInChallenge>();
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!challenge) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [challenge]);
  const handle = async (result: EasyAuthResult | null) => {
    if (!result) return;
    if (await adoptEasyAuthResult(result)) { await loginWithTokens(); return; }
    if ('needs_username' in result) { setNeedsUsername(true); return; }
    if ('challenge_id' in result) {
      setChallenge(result); setEmail(result.email); setCode(''); setNeedsUsername(false);
      setExpanded(true); setResendAt(Date.now() + 60_000); setNow(Date.now());
    }
  };
  const run = async (work: () => Promise<EasyAuthResult | null>) => {
    if (locked.current || disabled) return;
    locked.current = true; setBusy(true); onBusy(true);
    try { const result = await work(); if (mounted.current) await handle(result); }
    catch (error) { if (mounted.current) alert('Could not sign in', error instanceof EasyAuthError ? error.message : formatApiError(error, { fallback: 'Please check your connection and try again.' })); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  };
  const requestEmail = () => easyAuthRequest('email', { email: email.trim().toLowerCase() });
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return <View style={{ gap: 12, marginBottom: 20 }}>
    {!googleOnly && <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>Welcome to Axonic</Text>}
    {!googleOnly && <Text style={{ color: c.textSecondary }}>Sign in or create an account. Your conversations stay with the same account.</Text>}
    {googleOnly && !challenge && <Button title="Sign in with Google" variant="outline" style={{ backgroundColor: c.surface }} loading={busy} disabled={disabled || !GoogleButton} onPress={() => { void run(signInWithGoogle); }} />}
    {!googleOnly && GoogleButton && !challenge && <GoogleButton size={GoogleButton.Size.Wide} style={{ width: '100%', height: 48 }} disabled={disabled} onPress={() => { void run(signInWithGoogle); }} />}
    {!googleOnly && !expanded && <Button title="Continue with email" disabled={disabled} onPress={() => setExpanded(true)} />}
    {!googleOnly && expanded && !challenge && <>
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" editable={!disabled} />
      <Button title="Send sign-in code" disabled={disabled || !email.trim()} onPress={() => { void run(requestEmail); }} />
    </>}
    {challenge && <>
      <Text selectable style={{ color: c.textSecondary }}>Enter the code sent to {challenge.email}. It expires in 10 minutes.</Text>
      {challenge.google_link && <Text style={{ color: c.text }}>Verifying links this Google account to your Axonic account. Your existing chats will stay in that account.</Text>}
      <Input label="Six-digit code" value={code} onChangeText={(value) => setCode(value.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} editable={!disabled} />
      {needsUsername && <Input label="Choose your username" value={username} onChangeText={setUsername} autoCapitalize="none" maxLength={150} editable={!disabled} />}
      <Button title={needsUsername ? 'Create account' : challenge.google_link ? 'Verify and link Google' : 'Verify and continue'} disabled={disabled || code.length !== 6 || (needsUsername && !username.trim())} onPress={() => { void run(() => easyAuthRequest('verify', { challenge_id: challenge.challenge_id, code, ...(needsUsername ? { username: username.trim() } : {}) })); }} />
      <Button title={remaining ? `Resend code in ${remaining}s` : 'Resend code'} variant="ghost" disabled={disabled || remaining > 0} onPress={() => { void run(challenge.google_link ? signInWithGoogle : requestEmail); }} />
      <Button title="Use another sign-in method" variant="ghost" disabled={disabled} onPress={() => { setChallenge(undefined); setCode(''); setUsername(''); setNeedsUsername(false); setExpanded(false); }} />
    </>}
    {!googleOnly && <Text style={{ color: c.textSecondary, textAlign: 'center' }}>Or use your password below</Text>}
  </View>;
}
