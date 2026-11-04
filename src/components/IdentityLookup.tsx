import {t} from '../localization/language';
import {Chrome} from '../theme';
import {useTheme} from '../contexts/ThemeContext';
import Button from './ui/Button';
import {KeyboardAwareTextInput as TextInput} from './ui/KeyboardForm';
import {parseIdentityInput} from '../modules/identity';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { type DirectoryLookupResult } from '../modules/identity';
const messages: Record<DirectoryLookupResult['status'], string> = {
  found: "Signed identity verified", conflict: "Conflicting signed records found. No record selected.",
  'missing-history': "More signed history is needed to connect these records. No record selected.",
  stale: "These neurons have an older record than this device. No record selected.",
  'not-found': "No available record was found among the neurons that replied.",
  unavailable: "No usable replies. Connect to neurons and try again.", cancelled: "Lookup interrupted. Try again.",
  busy: "A lookup is already running.", invalid: "Enter a complete Axonic identity code.",
};
export default function IdentityLookup({ lookup, color:customColor, muted:customMuted, border:customBorder }: {
  lookup(account: string): Promise<DirectoryLookupResult>; color?: string; muted?: string; border?: string;
}) {
  const {colors}=useTheme(),color=customColor??colors.text,muted=customMuted??colors.textSecondary,border=customBorder??colors.neonBorder;
  const [account, setAccount] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState<DirectoryLookupResult | null>(null);
  const generation = useRef(0), running = useRef(false);
  useEffect(() => {
    const state = AppState.addEventListener('change', next => { if (next !== 'active') { generation.current++; setResult(null); } });
    return () => { generation.current++; state.remove(); };
  }, []);
  async function find() {
    if (running.current || !parseIdentityInput(account)) return;
    running.current = true; setBusy(true); setResult(null); const epoch = generation.current;
    try { const found = await lookup(parseIdentityInput(account)!); if (epoch === generation.current) setResult(found); }
    catch { if (epoch === generation.current) setResult({ status: 'unavailable', queried: 0, answered: 0, rejected: 0, sources: [] }); }
    finally { running.current = false; setBusy(false); }
  }
  return <View style={{ gap: 12, marginTop: 22 }}>
    <Text accessibilityRole="header" style={{ color, fontSize: 20, fontWeight: '600' }}>{t("Find identity")}</Text>
    <Text style={{ color: muted, lineHeight: 22 }}>{t("Ask connected neurons for a signed public identity record.")}</Text>
    <TextInput accessibilityLabel={t("Public identity code")} placeholder={t("Paste an ID or identity link…")} placeholderTextColor={muted} autoCapitalize="none" autoCorrect={false}
      value={account} maxLength={256} editable={!busy} onChangeText={value => { setAccount(value); setResult(null); }}
      style={{ color, borderColor: border, borderWidth: 1, backgroundColor:colors.inputBg,borderRadius: Chrome.controlRadius, padding: 14,minHeight:48,fontSize:16 }} />
    <Button title={t("FIND IDENTITY")} loading={busy} disabled={!parseIdentityInput(account)} onPress={()=>void find()}/>
    {result && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      <Text style={{ color, fontWeight: '600' }}>{t(messages[result.status])}</Text>
      {result.status === 'found' && <Text style={{ color: muted }}>{t("Revision")}{' '}{result.packet?.record.revision} {t("· returned by")}{' '}{result.sources.length} {result.sources.length === 1 ? 'neuron' : 'neurons'}</Text>}
      <Text style={{ color: muted }}>{t("Checked")}{' '}{result.queried} {t("neurons ·")}{result.answered} {t("valid replies ·")}{result.rejected} {t("unavailable or rejected")}</Text>
      <Text style={{ color: muted, lineHeight: 22 }}>{t("This checks the records we could reach. It does not prove that no newer record exists elsewhere. Your trusted keys and account remain unchanged.")}</Text>
    </View>}
  </View>;
}
