import { createMobileRecoveryDiscovery } from '../services/identity/mobileRecoveryDiscovery';
import { checkRecoveryRecord, parseRecoveryCheckpoint } from '../services/identity/recoveryDiscovery';
import IdentityLookup from '../components/IdentityLookup';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { localAccount, localAccountBiometrics as biometrics, localAccountName } from '../services/identity/localAccount';
import { localAccountLookupIdentity, localAccountDirectorySnapshot, startLocalAccountNetwork } from '../services/identity/localAccountNetwork';
import { allowedAxons, setAllowedAxons } from '../services/allowedAxons';

/** Opt-in development flow. Its storage and entry point are independent of Django sessions. */
export default function LocalAccountApp() {
  const [status, setStatus] = useState(localAccount.status());
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [name, setName] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [phrase, setPhrase] = useState(''), [words, setWords] = useState(''), [record, setRecord] = useState('');
  const [checkedRecord, setCheckedRecord] = useState('');
  const recovery = useRef<ReturnType<typeof createMobileRecoveryDiscovery> | null>(null);
  const closeRecovery = () => { recovery.current?.stop(); recovery.current = null; setCheckedRecord(''); };
  const [restoring, setRestoring] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [network, setNetwork] = useState<ReturnType<ReturnType<typeof startLocalAccountNetwork>['snapshot']> | null>(null);
  const [replicas, setReplicas] = useState(localAccountDirectorySnapshot);
  const [limit, setLimit] = useState(allowedAxons());
  const generation = useRef(0), actionRunning = useRef(false);
  const clearSecrets = () => { closeRecovery(); setPassword(''); setRepeat(''); setPhrase(''); setWords(''); setRecord(''); };
  const locked = status.state !== 'unlocked';
  const disabled = busy || status.busy || !ready;
  const connections = network?.pool?.connections.filter(c => c.state === 'connected').length ?? 0;
  async function action(work: () => Promise<void>) {
    if (actionRunning.current || status.busy) return;
    actionRunning.current = true;
    const own = generation.current; setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) { if (restoring) closeRecovery(); if (generation.current === own) setError(e instanceof Error ? e.message : 'Unable to complete this action'); }
    finally { if (generation.current === own) { setPassword(''); setRepeat(''); } actionRunning.current = false; setBusy(false); }
  }
  async function inspect() {
    await localAccount.inspect(); setName(await localAccountName.read() ?? ''); setReady(true);
  }
  useEffect(() => {
    const stop = localAccount.subscribe(() => setStatus(localAccount.status()));
    void inspect().catch(() => setError('Unable to read local account storage. Retry without creating a replacement account.'));
    let runtime: ReturnType<typeof startLocalAccountNetwork> | null = null;
    try { runtime = startLocalAccountNetwork(); } catch { setError('Network transport unavailable in this build.'); }
    const timer = setInterval(() => { setNetwork(runtime?.snapshot() ?? null); setReplicas(localAccountDirectorySnapshot()); setLimit(allowedAxons()); }, 1000);
    const state = AppState.addEventListener('change', next => {
      setForeground(next === 'active');
      // iOS biometric prompts briefly make the app inactive. Hide the UI then;
      // an actual background transition invalidates every pending unlock.
      if (next === 'background') { generation.current++; biometrics.lock(); clearSecrets(); setNotice(''); setError(''); }
    });
    return () => { generation.current++; clearInterval(timer); state.remove(); stop(); recovery.current?.stop(); recovery.current = null; runtime?.stop(); biometrics.lock(); };
  }, []);
  const button = (label: string, onPress: () => void, extraDisabled = false) => <Pressable accessibilityRole="button"
    disabled={disabled || extraDisabled} onPress={onPress} style={[styles.button, (disabled || extraDisabled) && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  const passwordInput = <TextInput accessibilityLabel="Local password" placeholder="Local password (12+ characters)" placeholderTextColor="#98a8b9"
    secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="none" autoComplete="off"
    maxLength={256} value={password} onChangeText={setPassword} style={styles.input} editable={!disabled} />;
  const confirmPassword = () => { if (password.length < 12 || password !== repeat) throw Error('Use at least 12 characters and enter the same password twice.'); };
  return <SafeAreaProvider><SafeAreaView style={styles.root}>
    {!foreground ? <View style={styles.card}><Text style={styles.title}>Axonic is locked</Text></View> :
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Axonic</Text>
        <Text style={styles.subtitle}>{!ready ? 'Opening local account…' : status.state === 'unlocked' ? name || 'Your neuron' : 'Your identity, on your device'}</Text>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!!notice && <Text style={styles.text}>{notice}</Text>}
        {!ready && <Pressable onPress={() => void action(inspect)}><Text style={styles.text}>Retry opening account</Text></Pressable>}
        {ready && status.state === 'empty' && !restoring && <View style={styles.card}>
          <Text style={styles.text}>Create an identity without an email address or a server login. Your local name is only a label; your public identity code identifies you on the network.</Text>
          {button('Create local account', () => void action(async () => { const created = await localAccount.beginCreate(); if (localAccount.status().state === 'backup') setPhrase(created); }))}
          {button('Restore an account', () => setRestoring(true))}
        </View>}
        {ready && (status.state === 'backup' || (status.state === 'empty' && restoring)) && <View style={styles.card}>
          <Text style={styles.heading}>{restoring ? 'Restore your identity' : 'Save your recovery words'}</Text>
          <Text style={styles.text}>{restoring ? 'Use your 24 words and latest saved public recovery record. Check the network before restoring. Reachable neurons may not know about a newer record elsewhere; do not restore concurrently on another device. Recovery replaces previous devices and does not restore old messages.' : 'Write these 24 words down privately. Anyone with them can control your identity. Also save the public recovery record after creation and refresh it after account changes.'}</Text>
          {!!phrase && <Text style={styles.words}>{phrase}</Text>}
          <TextInput accessibilityLabel="Recovery words" placeholder={restoring ? 'Enter your 24 recovery words' : 'Type the 24 words again to confirm your backup'}
            placeholderTextColor="#98a8b9" multiline autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={512}
            value={words} onChangeText={setWords} style={styles.input} editable={!disabled} />
          {restoring && <TextInput accessibilityLabel="Public recovery record" placeholder="Paste the latest public recovery record" placeholderTextColor="#98a8b9"
            multiline autoCapitalize="none" autoCorrect={false} maxLength={12000} value={record} onChangeText={value => { setRecord(value); setCheckedRecord(''); }} style={styles.input} editable={!disabled} />}
          {restoring && <>
            {button('Check recovery record on network', () => void action(async () => {
              const own = generation.current;
              setCheckedRecord('');
              parseRecoveryCheckpoint(record, Date.now());
              const discovery = recovery.current ??= createMobileRecoveryDiscovery();
              const found = await checkRecoveryRecord(record, discovery.lookup, Date.now);
              if (own !== generation.current) return;
              setRecord(found.raw); setCheckedRecord(found.raw);
              setNotice(`Verified revision ${found.revision} from ${found.sources} neuron. This does not prove global freshness. Restoring will check again and replace previous devices.`);
            }), !record.trim())}
            <Text style={styles.text}>Only public identity records are requested. Your words and password stay on this device. FirstNeuron is the initial lookup peer; it is not an authority.</Text>
          </>}
          <TextInput accessibilityLabel="Local name" placeholder="Name on this device" placeholderTextColor="#98a8b9" maxLength={80} value={name} onChangeText={setName} style={styles.input} editable={!disabled} />
          {passwordInput}
          <TextInput accessibilityLabel="Confirm local password" placeholder="Repeat local password" placeholderTextColor="#98a8b9" secureTextEntry autoCapitalize="none"
            autoCorrect={false} autoComplete="off" textContentType="none" maxLength={256} value={repeat} onChangeText={setRepeat} style={styles.input} editable={!disabled} />
          {button(restoring ? 'Restore and replace previous devices' : 'Save account', () => void action(async () => {
            confirmPassword();
            if (restoring) {
              if (!checkedRecord || checkedRecord !== record || !recovery.current) throw Error('Check the recovery record on the network first.');
              const discovery = recovery.current;
              await localAccount.restore(words, record, password, async () => { await checkRecoveryRecord(record, discovery.lookup, Date.now, true); });
            } else await localAccount.confirmBackup(words, password);
            await localAccountName.write(name); clearSecrets(); setRestoring(false);
          }), restoring && (!checkedRecord || checkedRecord !== record))}
          {button('Cancel', () => { generation.current++; biometrics.lock(); clearSecrets(); setRestoring(false); })}
        </View>}
        {ready && status.state === 'locked' && <View style={styles.card}>
          <Text style={styles.heading}>Unlock your account</Text>{passwordInput}
          {button('Unlock with password', () => void action(() => localAccount.unlock(password)))}
          {biometrics.available() && button('Unlock with biometrics', () => void action(() => biometrics.unlock()))}
          <Text style={styles.text}>Your password unlocks this device. It is never sent to another neuron. If biometrics change or become unavailable, use your password.</Text>
        </View>}
        {ready && !locked && <View style={styles.card}>
          <Text style={styles.heading}>Network</Text>
          <Text style={styles.text}>Allow axons: {limit}</Text>
          <View style={styles.row}>{button('−', () => void action(() => setAllowedAxons(limit - 1)), limit <= 3)}{button('+', () => void action(() => setAllowedAxons(limit + 1)), limit >= 10)}</View>
          <Text style={styles.text}>{connections} connected {connections === 1 ? 'neuron' : 'neurons'} · {network?.discovering ? 'Nearby discovery active' : 'Looking for neurons'}</Text>
          <Text style={styles.text}>Identity copies: {replicas?.confirmed ?? 0}/3 confirmed on connected neurons</Text>
          <Text style={styles.text}>Connects automatically through local Wi-Fi or FirstNeuron. Participation pauses when the app locks.</Text>
          {!!network?.error && <Text style={styles.error}>{network.error}</Text>}
          <IdentityLookup lookup={localAccountLookupIdentity} />
          <Text style={styles.heading}>Your public identity</Text><Text selectable style={styles.code}>{status.account}</Text>
          {button('Share public identity code', () => void action(async () => { await Share.share({ message: status.account! }); }))}
          {button('Save public recovery record', () => void action(async () => { await Share.share({ message: localAccount.recoveryRecord() }); }))}
          <Text style={styles.text}>Keep a current public recovery record with your private words. This early flow supports identity and network participation; chats and existing-account migration come next.</Text>
          <Text style={styles.heading}>Unlock preferences</Text>
          {biometrics.available() && <>{passwordInput}{button('Enable biometric unlock', () => void action(async () => { await biometrics.enroll(password); setNotice('Biometric unlock enabled on this device.'); }))}</>}
          {button('Disable biometric unlock', () => void action(async () => { await biometrics.disable(); setNotice('Biometric unlock disabled.'); }))}
          {button('Lock account', () => { generation.current++; biometrics.lock(); clearSecrets(); setNotice(''); })}
        </View>}
        {busy && <Text style={styles.text}>Working…</Text>}
      </ScrollView>}
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101820' }, content: { padding: 24, gap: 16 },
  title: { fontSize: 32, fontWeight: '700', color: '#f5f8fb' }, subtitle: { fontSize: 17, color: '#b9c8d8' },
  heading: { fontSize: 21, fontWeight: '600', color: '#f5f8fb' }, card: { gap: 16, paddingVertical: 8 },
  text: { fontSize: 15, lineHeight: 23, color: '#c8d5e3' }, error: { color: '#ffb4ab', fontSize: 15 },
  words: { fontSize: 18, lineHeight: 29, color: '#ecf8f4', backgroundColor: '#1c3540', padding: 16, borderRadius: 12 },
  input: { color: '#f5f8fb', borderColor: '#526476', borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  button: { backgroundColor: '#146b62', padding: 15, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', gap: 16 }, code: { fontSize: 13, color: '#c8d5e3' },
});
