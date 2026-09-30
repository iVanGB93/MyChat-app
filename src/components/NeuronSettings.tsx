import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Share, StyleSheet } from 'react-native';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../contexts/ThemeContext';
import { MAILBOX_ENABLED } from '../services/transports/p2pTextBridge';
import { mailboxPublicIdentity, mailboxSessionStatus, rememberMailboxPairing, forgetMailboxPairing } from '../services/mailboxComposition';

// Public trust anchor. Private credentials and device keys never ship in the app.
const firstNeuron = {
  url: 'https://143.198.121.2', user: 34, node: '570dc38c-b3dd-41dc-9c39-7252534fb4c4',
  signing: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkvsng3qLw6VLA9khCBFud6W9T7mFIIv7iK0evKA2tS0Ldhk+WLCztrdObDvfbGlnRHl4yeQTkJYa6m5hWKeqrw==',
};
export default function NeuronSettings() {
  const { colors } = useTheme();
  const owner = useAppStore(s => s.user?.id);
  const [status, setStatus] = useState(mailboxSessionStatus);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setStatus(mailboxSessionStatus()); const timer = setInterval(() => setStatus(mailboxSessionStatus()), 2000); return () => clearInterval(timer); }, [owner]);
  if (!MAILBOX_ENABLED || !owner) return null;
  const enabled = status.owner === owner;
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); setStatus(mailboxSessionStatus()); }
    catch { setError('Unable to complete setup. Check your connection and device registration.'); }
    finally { setBusy(false); }
  }
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
    <Text style={[styles.title, { color: colors.text }]}>Connection setup</Text>
    <Text style={[styles.text, { color: colors.textSecondary }]}>This early version requires device registration. Share your device code with the operator of FirstNeuron, then connect.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void action(async () => {
      const identity = await mailboxPublicIdentity();
      await Share.share({ message: JSON.stringify({ version: 1, ...identity }), title: 'Axonic device registration' });
    })}><Text style={styles.label}>Share device code</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void action(() => enabled
      ? forgetMailboxPairing()
      : rememberMailboxPairing([{ user: firstNeuron.user, encryption: '', signing: firstNeuron.signing }], firstNeuron))}>
      <Text style={styles.label}>{busy ? 'Please wait…' : enabled ? 'Disconnect from network' : 'Connect to FirstNeuron'}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 18, marginVertical: 16, borderRadius: 14, backgroundColor: '#112532' },
  title: { color: '#ffffff', fontWeight: '700', fontSize: 17, marginBottom: 8 },
  text: { color: '#b9d3df', fontSize: 14, lineHeight: 21, marginBottom: 10 },
  button: { padding: 12, borderRadius: 8, backgroundColor: '#203e4d', marginTop: 8 },
  label: { color: '#65e1f4', fontWeight: '600' }, error: { color: '#ffb9b9' },
});
