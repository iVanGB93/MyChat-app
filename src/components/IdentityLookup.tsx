import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { validAccountId } from '../services/identity/identityProtocol';
import type { DirectoryLookupResult } from '../services/identity/identityDirectoryLookup';
const messages: Record<DirectoryLookupResult['status'], string> = {
  found: 'Signed identity verified', conflict: 'Conflicting signed records found. No record selected.',
  'missing-history': 'More signed history is needed to connect these records. No record selected.',
  stale: 'These neurons have an older record than this device. No record selected.',
  'not-found': 'No available record was found among the neurons that replied.',
  unavailable: 'No usable replies. Connect to neurons and try again.', cancelled: 'Lookup interrupted. Try again.',
  busy: 'A lookup is already running.', invalid: 'Enter a complete Axonic identity code.',
};
export default function IdentityLookup({ lookup, color = '#e6edf7', muted = '#a2b4c8', border = '#49637f' }: {
  lookup(account: string): Promise<DirectoryLookupResult>; color?: string; muted?: string; border?: string;
}) {
  const [account, setAccount] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState<DirectoryLookupResult | null>(null);
  const generation = useRef(0), running = useRef(false);
  useEffect(() => {
    const state = AppState.addEventListener('change', next => { if (next !== 'active') { generation.current++; setResult(null); } });
    return () => { generation.current++; state.remove(); };
  }, []);
  async function find() {
    if (running.current || !validAccountId(account.trim())) return;
    running.current = true; setBusy(true); setResult(null); const epoch = generation.current;
    try { const found = await lookup(account.trim()); if (epoch === generation.current) setResult(found); }
    catch { if (epoch === generation.current) setResult({ status: 'unavailable', queried: 0, answered: 0, rejected: 0, sources: [] }); }
    finally { running.current = false; setBusy(false); }
  }
  return <View style={{ gap: 12, marginTop: 22 }}>
    <Text accessibilityRole="header" style={{ color, fontSize: 20, fontWeight: '600' }}>Find identity</Text>
    <Text style={{ color: muted, lineHeight: 22 }}>Ask connected neurons for a signed public identity record.</Text>
    <TextInput accessibilityLabel="Public identity code" placeholder="axonic:1:…" placeholderTextColor={muted} autoCapitalize="none" autoCorrect={false}
      value={account} maxLength={73} editable={!busy} onChangeText={value => { setAccount(value); setResult(null); }}
      style={{ color, borderColor: border, borderWidth: 1, borderRadius: 10, padding: 12 }} />
    <Pressable accessibilityRole="button" disabled={busy || !validAccountId(account.trim())} onPress={() => void find()}
      style={{ borderColor: border, borderWidth: 1, borderRadius: 10, padding: 14, opacity: busy || !validAccountId(account.trim()) ? 0.5 : 1 }}>
      <Text style={{ color, textAlign: 'center' }}>{busy ? 'Checking neurons…' : 'Find identity'}</Text>
    </Pressable>
    {result && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      <Text style={{ color, fontWeight: '600' }}>{messages[result.status]}</Text>
      {result.status === 'found' && <Text style={{ color: muted }}>Revision {result.packet?.record.revision} · returned by {result.sources.length} {result.sources.length === 1 ? 'neuron' : 'neurons'}</Text>}
      <Text style={{ color: muted }}>Checked {result.queried} neurons · {result.answered} valid replies · {result.rejected} unavailable or rejected</Text>
      <Text style={{ color: muted, lineHeight: 22 }}>This checks the records we could reach. It does not prove that no newer record exists elsewhere. Your trusted keys and account remain unchanged.</Text>
    </View>}
  </View>;
}
