import {t} from '../localization/language';
import {Chrome} from '../theme';
import {useTheme} from '../contexts/ThemeContext';
import Button from './ui/Button';
import {KeyboardAwareTextInput as TextInput} from './ui/KeyboardForm';
import {displayIdentity, localAccount, parseIdentityInput} from '../modules/identity';
import {conversations} from '../modules/messaging';
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
  const [nickname, setNickname] = useState<string | null>(null);
  const [contacts, setContacts] = useState<{account:string; alias:string}[] | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [contactError, setContactError] = useState(false);
  const generation = useRef(0), running = useRef(false);
  useEffect(() => {
    const clear = () => {
      generation.current++;
      setAccount(''); setResult(null); setNickname(null);
      setContacts(null); setContactSearch(''); setContactError(false);
    };
    const state = AppState.addEventListener('change', next => { if (next !== 'active') clear(); });
    const unsubscribe = localAccount.subscribe(clear);
    return () => { generation.current++; state.remove(); unsubscribe(); };
  }, []);
  function select(value: string) {
    generation.current++; setAccount(value); setResult(null); setNickname(null);
  }
  async function showContacts() {
    if (contacts) { setContacts(null); return; }
    const epoch = ++generation.current;
    setContactSearch(''); setContactError(false);
    try {
      const snapshot = await conversations().metadataSnapshot();
      if (epoch !== generation.current) return;
      setContacts(snapshot.contacts.filter(contact => !contact.blocked && parseIdentityInput(contact.account)));
    } catch {
      if (epoch === generation.current) setContactError(true);
    }
  }
  async function find() {
    const id = parseIdentityInput(account);
    if (running.current || !id) return;
    running.current = true; setBusy(true); setResult(null); setNickname(null); const epoch = ++generation.current;
    void Promise.resolve().then(()=>conversations().metadataSnapshot()).then(snapshot=>{
      if(epoch===generation.current)setNickname(snapshot.contacts.find(contact=>contact.account===id)?.alias.trim()||null);
    }).catch(()=>{ /* The signed lookup can still complete if local storage is unavailable. */ });
    try { const found = await lookup(id); if (epoch === generation.current) setResult(found); }
    catch { if (epoch === generation.current) setResult({ status: 'unavailable', queried: 0, answered: 0, rejected: 0, sources: [] }); }
    finally { running.current = false; setBusy(false); }
  }
  return <View style={{ gap: 12, marginTop: 22 }}>
    <Text accessibilityRole="header" style={{ color, fontSize: 20, fontWeight: '600' }}>{t("Refresh contact identity")}</Text>
    <Text style={{ color: muted, lineHeight: 22 }}>{t("Ask connected neurons for a signed public identity record.")}</Text>
    <Button title={t(contacts ? "Close contacts" : "Choose a contact")} variant="outline" disabled={busy} onPress={()=>void showContacts()}/>
    {contactError && <Text accessibilityRole="alert" style={{color:muted}}>{t("Could not load saved contacts.")}</Text>}
    {contacts && <>
      {contacts.length === 0 ? <Text style={{color:muted}}>{t("No saved contacts available.")}</Text> :
        <TextInput accessibilityLabel={t("Search contacts")} placeholder={t("Search contacts")} placeholderTextColor={muted}
          value={contactSearch} onChangeText={setContactSearch} style={{color,borderColor:border,borderWidth:1,borderRadius:Chrome.controlRadius,padding:12}}/>}
      {contacts.filter(contact => {
        const query = contactSearch.trim().toLowerCase();
        return contact.alias.toLowerCase().includes(query) || displayIdentity(contact.account).toLowerCase().includes(query);
      }).slice(0, 12).map(contact =>
        <Button key={contact.account} variant="outline" title={contact.alias.trim() || displayIdentity(contact.account)} onPress={()=>{
          select(contact.account); setContacts(null);
        }}/>)}
      {contacts.length > 12 && <Text style={{color:muted}}>{t("Search to find more contacts.")}</Text>}
    </>}
    <TextInput accessibilityLabel={t("Public identity code")} placeholder={t("Paste an ID or identity link…")} placeholderTextColor={muted} autoCapitalize="none" autoCorrect={false}
      value={account} maxLength={256} editable={!busy} onChangeText={select}
      style={{ color, borderColor: border, borderWidth: 1, backgroundColor:colors.inputBg,borderRadius: Chrome.controlRadius, padding: 14,minHeight:48,fontSize:16 }} />
    <Button title={t("Refresh identity")} loading={busy} disabled={!parseIdentityInput(account)} onPress={()=>void find()}/>
    {nickname && <Text accessibilityLiveRegion="polite" style={{color}}>{t("Nickname saved on this phone")}{' · '}{nickname}</Text>}
    {result && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      <Text style={{ color, fontWeight: '600' }}>{t(messages[result.status])}</Text>
      {result.status === 'found' && <Text style={{ color: muted }}>{t("Revision")}{' '}{result.packet?.record.revision} {t("· returned by")}{' '}{result.sources.length} {result.sources.length === 1 ? 'neuron' : 'neurons'}</Text>}
      {result.status === 'found' && result.packet && <>
        <Text style={{color:muted}}>{t("Registered devices")}{' · '}{result.packet.record.devices.length}</Text>
        <Text style={{color:muted}}>{t("Identity record valid until")}{' · '}{new Date(result.packet.record.expiresAt).toLocaleString()}</Text>
      </>}
      <Text style={{ color: muted }}>{t("Checked")}{' '}{result.queried} {t("neurons ·")}{result.answered} {t("valid replies ·")}{result.rejected} {t("unavailable or rejected")}</Text>
      <Text style={{ color: muted, lineHeight: 22 }}>{t("Axonic saves a record only after verifying its signature and its history against any record already saved.")}</Text>
    </View>}
  </View>;
}
