import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { localIdentity, identityCreationSupported } from '../services/identity/localIdentity';
import { mobileIdentityNetworkSnapshot, mobileIdentityNetworkSupported, mobileInternetAxonsSupported } from '../services/identity/mobileIdentityNetwork';

/** Development-only local preview; never enrolls or replaces the signed-in account. */
export default function IdentityPreview() {
  const [status, setStatus] = useState(localIdentity.status);
  const [phrase, setPhrase] = useState(''), [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState(''), [error, setError] = useState('');
  const [network, setNetwork] = useState<{ connected: number; limit: number; rtc: number; introduced: number; internet: number; pending: number; discovering: boolean; error: string | null } | null>(null);
  const focused = useRef(false);
  const clear = () => { setPhrase(''); setConfirmation(''); setPassword(''); };
  useFocusEffect(useCallback(() => {
    focused.current = true;
    let active = true, inspectionStarted = false;
    const inspectWhenIdle = () => {
      if (!active || inspectionStarted || localIdentity.status().busy) return;
      inspectionStarted = true;
      if (['unlocked', 'backup'].includes(localIdentity.status().state)) return;
      void localIdentity.inspect().catch(() => {
        if (active) setError('Local identity storage could not be opened.');
      });
    };
    const refresh = () => {
      const next = localIdentity.status(); setStatus(next);
      if (next.state !== 'backup') { setPhrase(''); setConfirmation(''); }
      if (next.state === 'locked' || next.state === 'empty') setPassword('');
      inspectWhenIdle();
    };
    const unsubscribe = localIdentity.subscribe(refresh);
    const refreshNetwork = () => {
      const snapshot = mobileIdentityNetworkSnapshot();
      setNetwork(snapshot ? { limit: snapshot.limit, connected: snapshot.pool?.connections.filter(c => c.state === 'connected').length ?? 0,
        pending: snapshot.pool?.connections.filter(c => c.state === 'authenticating').length ?? 0,
        rtc: snapshot.rtc.filter(r => r.open && snapshot.pool?.connections.some(c => c.account === r.account && c.state === 'connected')).length,
        introduced: new Set(snapshot.introductions.map(p => p.account)).size,
        internet: snapshot.pool?.connections.filter(c => c.state === 'connected' && c.route === 'internet').length ?? 0,
        discovering: snapshot.discovering, error: snapshot.error } : null);
    };
    const networkTimer = setInterval(refreshNetwork, 1000); refreshNetwork();
    setError('');
    refresh();
    return () => {
      active = false; focused.current = false; clearInterval(networkTimer); unsubscribe();
      // Cancel unfinished setup/unlock, but navigation does not lock an already-unlocked neuron.
      if (localIdentity.status().state !== 'unlocked') localIdentity.lock();
      clear();
    };
  }, []));
  async function action(work: () => Promise<unknown>) {
    setError('');
    try { await work(); }
    catch (e) { if (focused.current) setError(e instanceof Error ? e.message : 'Local account operation failed.'); }
    finally { if (focused.current) setPassword(''); }
  }
  const supported = identityCreationSupported();
  const label = { color: '#b9d3df', fontSize: 14, lineHeight: 21 } as const;
  const input = { color: '#fff', borderColor: '#487080', borderWidth: 1, borderRadius: 8, padding: 12 };
  const button = (title: string, onPress: () => void, disabled = status.busy) => <Pressable accessibilityRole="button"
    disabled={disabled} onPress={onPress} style={{ backgroundColor: '#203e4d', padding: 14, borderRadius: 8, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: '#65e1f4', fontWeight: '600' }}>{title}</Text>
  </Pressable>;
  return <View style={{ padding: 18, gap: 12, marginVertical: 16, borderRadius: 14, backgroundColor: '#112532' }}>
    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Local identity preview</Text>
    <Text style={label}>Create and unlock a separate experimental identity offline. It cannot send messages yet and does not replace your current account.</Text>
    {!supported && <Text style={label}>Install an updated development client before creating an identity here.</Text>}
    {!!status.account && <Text selectable style={label}>{status.account}</Text>}
    <Text style={label}>{status.busy ? 'Working…' : status.state === 'unlocked' ? 'Unlocked on this device' : status.state === 'locked' ? 'Account locked' : status.state === 'backup' ? 'Save your recovery words' : 'No local identity yet'}</Text>
    <Text style={{ ...label, fontWeight: '700' }}>Identity network</Text>
    {!mobileIdentityNetworkSupported() ? <Text style={label}>Update the development client to test nearby neurons.</Text>
      : status.state !== 'unlocked' ? <Text style={label}>Unlock this identity to find nearby neurons.</Text>
      : <>
        <Text style={label}>{network?.discovering ? 'Discovering neurons on Wi-Fi' : 'Waiting for Wi-Fi discovery'}</Text>
        {!mobileInternetAxonsSupported() && <Text style={label}>Update the development client to connect through the internet.</Text>}
        <Text style={label}>Direct WebRTC axons: {network?.rtc ?? 0}</Text>
        <Text style={label}>Other neurons reported: {network?.introduced ?? 0}</Text>
        <Text style={label}>Internet axons: {network?.internet ?? 0}</Text>
        <Text style={label}>Connected axons: {network?.connected ?? 0} / {network?.limit ?? 5} · Authenticating: {network?.pending ?? 0}</Text>
        {!!network?.error && <Text style={label}>{network.error}</Text>}
      </>}
    <Text style={label}>While unlocked, your neuron stays connected across app screens. Leaving the app locks it and closes these connections. They prove identity; they do not carry conversations yet.</Text>
    {status.state === 'empty' && button('Create local identity', () => void action(async () => {
      const words = await localIdentity.beginCreate(); if (focused.current) setPhrase(words);
    }), status.busy || !supported)}
    {status.state === 'backup' && <>
      <Text style={label}>Write these words down privately, in order. They control this experimental identity. Do not send them to anyone. They do not back up messages.</Text>
      <Text style={{ ...label, color: '#fff', lineHeight: 25 }}>{phrase}</Text>
      <TextInput accessibilityLabel="Confirm recovery words" placeholder="Enter your saved recovery words"
        placeholderTextColor="#91a6b1" style={input} value={confirmation} onChangeText={setConfirmation}
        autoCorrect={false} autoCapitalize="none" secureTextEntry textContentType="none" autoComplete="off" />
    </>}
    {(status.state === 'backup' || status.state === 'locked') && <>
      <TextInput accessibilityLabel="Local account password" placeholder="Local password (12–256 characters)"
        placeholderTextColor="#91a6b1" style={input} value={password} onChangeText={setPassword}
        secureTextEntry autoCorrect={false} autoCapitalize="none" autoComplete="off" textContentType="none" maxLength={256} />
      {button(status.state === 'backup' ? 'Save and unlock' : 'Unlock', () => void action(() => status.state === 'backup'
        ? localIdentity.confirmBackup(confirmation, password) : localIdentity.unlock(password)))}
    </>}
    {(status.state === 'unlocked' || status.state === 'backup') && button(status.state === 'backup' ? 'Cancel creation' : 'Lock account', () => { localIdentity.lock(); clear(); }, false)}
    {!!error && <Text selectable accessibilityRole="alert" style={{ color: '#ffb9b9' }}>{error}</Text>}
  </View>;
}
