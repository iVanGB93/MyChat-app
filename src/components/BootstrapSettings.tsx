import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {useTheme} from '../contexts/ThemeContext';
import {t} from '../localization/language';
import {bootstrapEndpoint, defaultBootstrapEndpoint, loadBootstrapEndpoint, parseBootstrapEndpoint,
  saveBootstrapEndpoint, testBootstrapEndpoint} from '../modules/network';
import Button from './ui/Button';
import {KeyboardAwareTextInput} from './ui/KeyboardForm';

export default function BootstrapSettings() {
  const {colors} = useTheme();
  const [saved, setSaved] = useState(bootstrapEndpoint);
  const [input, setInput] = useState(bootstrapEndpoint);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let current = true;
    loadBootstrapEndpoint().then(() => {
      if (current) { setSaved(bootstrapEndpoint()); setInput(bootstrapEndpoint()); }
    }).catch(() => {
      if (current) setMessage(t("Could not load the bootstrap address."));
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, []);
  const valid = parseBootstrapEndpoint(input);
  async function change(action: 'test' | 'save' | 'reset') {
    setBusy(true); setMessage('');
    try {
      if (action === 'test') {
        await testBootstrapEndpoint(input);
        setMessage(t("FirstNeuron identity verified."));
      } else {
        const endpoint = action === 'reset' ? defaultBootstrapEndpoint : input;
        if (action === 'save') await testBootstrapEndpoint(endpoint);
        await saveBootstrapEndpoint(endpoint);
        setSaved(bootstrapEndpoint()); setInput(bootstrapEndpoint());
        setMessage(t("Address saved for the next connection."));
      }
    } catch {
      setMessage(t("Could not verify or save the bootstrap address."));
    } finally { setBusy(false); }
  }
  return <View style={{gap:12, marginBottom:24}}>
    <Text accessibilityRole="header" style={{color:colors.text,fontSize:20,fontWeight:'700'}}>{t("Bootstrap AoN")}</Text>
    <Text style={{color:colors.textSecondary}}>{t("FirstNeuron connection address. Enter a secure WebSocket address ending in /v2/axon.")}</Text>
    <Text selectable style={{color:colors.textSecondary}}>{t("Current address")}{' · '}{saved}</Text>
    <Text selectable style={{color:colors.textSecondary}}>{t("Default address")}{' · '}{defaultBootstrapEndpoint}</Text>
    <KeyboardAwareTextInput accessibilityLabel={t("Bootstrap AoN")} value={input} editable={!busy}
      autoCapitalize="none" autoCorrect={false} inputMode="url" maxLength={270}
      onChangeText={value=>{setInput(value);setMessage('');}}
      style={{color:colors.text,borderColor:colors.border,borderWidth:1,borderRadius:16,padding:14}}/>
    <Button title={t("Test connection")} variant="outline" disabled={busy || !valid} onPress={()=>void change('test')}/>
    <Button title={t("Save address")} disabled={busy || !valid || valid === saved} onPress={()=>void change('save')}/>
    <Button title={t("Restore default address")} variant="outline" disabled={busy || saved === defaultBootstrapEndpoint}
      onPress={()=>void change('reset')}/>
    {!!message && <Text accessibilityLiveRegion="polite" style={{color:colors.text}}>{message}</Text>}
  </View>;
}
