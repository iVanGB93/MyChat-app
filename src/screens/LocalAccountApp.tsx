import {KeyboardFormScrollView} from '../components/ui/KeyboardForm';
import {startAppMaintenance} from '../modules/maintenance';
import {RootShareProvider} from '../components/chat/RootSharePicker';
import {ConfirmProvider,useConfirm} from '../contexts/ConfirmContext';
import {ThemedAlertBridge} from '../components/ui/ThemedAlert';
import RootNetworkPanel from './profile/RootNetworkPanel';
import RootProfileScreen from './profile/RootProfileScreen';
import { backupWordPositions, checkBackupWords } from '../modules/identity';


import {rootCallMayRunBackground} from '../modules/messaging';

import {subscribeLocalAccountCalls} from '../modules/messaging';

import RootAccountNavigator from '../navigation/RootAccountNavigator';

import {GestureHandlerRootView} from 'react-native-gesture-handler';

import RootAccountCallScreen from './calls/RootAccountCallScreen';

import {ThemeProvider,useTheme} from '../contexts/ThemeContext';

import notifee,{AuthorizationStatus} from '@notifee/react-native';

import { createMobileRecoveryDiscovery } from '../modules/identity';

import { checkRecoveryRecord, findRecoveryRecord } from '../modules/identity';

import { accountFromRecoveryPhrase } from '../modules/identity';

import Input from '../components/ui/Input';
import RecoveryWordsInput from '../components/ui/RecoveryWordsInput';

import Button from '../components/ui/Button';

import { Font, Spacing, Radius } from '../theme';


import React, { useEffect, useRef, useState } from 'react';

import { AppState, Image, Switch, Share, StyleSheet, Text, View } from 'react-native';

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { localAccount, removeAccountFromDevice, closeForDeviceRemoval, startLocalAccount, localAccountBiometrics as biometrics, localAccountUsername, localAccountSession } from '../modules/identity';

import { localAccountDirectorySnapshot, startLocalAccountNetwork } from '../modules/network';


/** Application shell for local identities and the neuron network. */

export default function LocalAccountApp() {
 useEffect(startAppMaintenance,[]);

 return <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><ThemeProvider><ConfirmProvider><ThemedAlertBridge/><RootShareProvider><LocalAccountContent/></RootShareProvider></ConfirmProvider></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>;

}

function LocalAccountContent() {

  const {colors}=useTheme(),styles=makeLocalStyles(colors),{confirm}=useConfirm();

  const [status, setStatus] = useState(localAccount.status());

  const [autoLock, setAutoLock] = useState(false), autoLockRef = useRef(false);
  const [positions, setPositions] = useState<[number, number]>([0, 1]);
  const [answers, setAnswers] = useState<[string, string]>(['', '']);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);

  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  const [newPassword,setNewPassword]=useState(''),[newRepeat,setNewRepeat]=useState('');
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');

  const [phrase, setPhrase] = useState(''), [words, setWords] = useState(''), [record, setRecord] = useState('');

  const [checkedRecord, setCheckedRecord] = useState('');

  const [setup, setSetup] = useState(false), [saved, setSaved] = useState(false), [enableBiometrics, setEnableBiometrics] = useState(false);

  const [username, setUsername] = useState(''), [loginName, setLoginName] = useState<string | null>(null);

  const recovery = useRef<ReturnType<typeof createMobileRecoveryDiscovery> | null>(null);

  const closeRecovery = () => { recovery.current?.stop(); recovery.current = null; setCheckedRecord(''); };

  const [restoring, setRestoring] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');

  const [network, setNetwork] = useState<ReturnType<ReturnType<typeof startLocalAccountNetwork>['snapshot']> | null>(null);

  const [replicas, setReplicas] = useState(localAccountDirectorySnapshot);


  const generation = useRef(0), actionRunning = useRef(false);

  const clearSecrets = () => { closeRecovery(); setPassword(''); setRepeat(''); setPhrase(''); setWords(''); setRecord(''); setSetup(false); setSaved(false); setEnableBiometrics(false); setRestoring(false); setAnswers(['', '']); setNewPassword('');setNewRepeat(''); };

  const locked = status.state !== 'unlocked';

  const disabled = busy || status.busy || !ready;

  const connections = network?.pool?.connections.filter(c => c.state === 'connected').length ?? 0;

  async function action(work: () => Promise<void>) {

    if (actionRunning.current || status.busy) return;

    actionRunning.current = true;

    const own = generation.current; setBusy(true); setError(''); setNotice('');

    try { await work(); }

    catch (e) { if (restoring && !setup) { closeRecovery(); } if (generation.current === own) setError(e instanceof Error ? e.message : 'Unable to complete this action'); }

    finally { if (generation.current === own && !setup) { setPassword(''); setRepeat('');setNewPassword('');setNewRepeat(''); } actionRunning.current = false; setBusy(false); }

  }

  async function inspect() {

    await startLocalAccount(); autoLockRef.current = localAccountSession.autoLock(); setAutoLock(autoLockRef.current);

    const account = localAccount.status().account;

    setLoginName(account ? await localAccountUsername.read(account) : null); setReady(true);

  }

  useEffect(() => {

    const stop = localAccount.subscribe(() => setStatus(localAccount.status()));

    const stopCallState=subscribeLocalAccountCalls(view=>{if(autoLockRef.current&&AppState.currentState==='background'&&(!view||view.status==='ended'))biometrics.lock();});

    void inspect().catch(() => setError('Unable to read local account storage. Retry without creating a replacement account.'));

    let runtime: ReturnType<typeof startLocalAccountNetwork> | null = null;

    try { runtime = startLocalAccountNetwork(); } catch { setError('Network transport unavailable in this build.'); }

    const timer = setInterval(() => { setNetwork(runtime?.snapshot() ?? null); setReplicas(localAccountDirectorySnapshot()); }, 1000);

    const state = AppState.addEventListener('change', next => {

      setForeground(next === 'active');
      if (next === 'active') runtime?.resume();

      // iOS biometric prompts briefly make the app inactive;

      // Setup secrets and opt-in locked accounts are cleared on backgrounding.

      if (next === 'background' && (autoLockRef.current || localAccount.status().state !== 'unlocked')) { generation.current++; if(!rootCallMayRunBackground())biometrics.lock(); clearSecrets(); setNotice(''); setError(''); }

    });

    return () => { generation.current++; clearInterval(timer); state.remove(); stop(); stopCallState(); recovery.current?.stop(); recovery.current = null; runtime?.stop(); biometrics.lock(); };

  }, []);

  const button = (label:string,onPress:()=>void,extraDisabled=false)=><Button title={label.toUpperCase()} onPress={onPress} loading={busy} disabled={disabled||extraDisabled}/>;
  const passwordInput=<Input accessibilityLabel="Local password" label="CURRENT PASSWORD" placeholder="Current local password" isPassword autoCapitalize="none" autoCorrect={false} textContentType="none" autoComplete="off" maxLength={256} value={password} onChangeText={setPassword} editable={!disabled}/>;

  const confirmPassword = () => { if (password.length < 6) throw Error('Password must contain at least 6 characters.'); if (password.length > 256) throw Error('Password must contain no more than 256 characters.'); if (password !== repeat) throw Error('Passwords do not match. Enter the same password in both fields.'); };

  if(status.removalPending)return <SafeAreaView style={styles.root}><View style={styles.card}>
    <Text style={styles.heading}>Finish removing this account</Text>
    <Text style={styles.text}>Your account is locked. Close Axonic below, then reopen it to finish removing this device’s identity, chats and private files. Saved gallery media and other people’s messages stay unchanged.</Text>
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Button title="CLOSE AXONIC" onPress={()=>void closeForDeviceRemoval().catch(e=>setError(e instanceof Error?e.message:'Unable to close Axonic'))}/>
  </View></SafeAreaView>;

  if(ready&&!locked&&!setup)return <View style={styles.root}><RootAccountNavigator profile={<RootProfileScreen account={status.account!} loginName={loginName} connected={connections}>

    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!notice&&<Text style={styles.text}>{notice}</Text>}

          <View style={styles.row}><View style={{flex:1}}><Text style={styles.heading}>Lock when leaving app</Text><Text style={styles.text}>Off by default. Keep this device signed in, or require your password or biometrics when you return.</Text></View><Switch accessibilityLabel="Lock when leaving app" value={autoLock} disabled={disabled} onValueChange={value=>void action(async()=>{if(value)autoLockRef.current=true;try {await localAccountSession.setAutoLock(value,password);} finally {autoLockRef.current=localAccountSession.autoLock();setAutoLock(autoLockRef.current);}})}/></View>
          {autoLock&&<Text style={styles.text}>To turn locking off, enter your current password below, then turn the switch off.</Text>}
          {button('Enable notifications',()=>void action(async()=>{const settings=await notifee.requestPermission();setNotice(settings.authorizationStatus>=AuthorizationStatus.AUTHORIZED?'Notifications enabled.':'Notifications are disabled in system settings.');}))}

          {button('Save public recovery record', () => void action(async () => { await Share.share({ message: localAccount.recoveryRecord() }); }))}

          <Text style={styles.text}>Your recovery words restore your identity through its signed network record. Keep a public record as an optional extra backup.</Text>

          <Text style={styles.heading}>Unlock preferences</Text>

          {biometrics.available() && <>{passwordInput}{button('Enable biometric unlock', () => void action(async () => { await biometrics.enroll(password); setNotice('Biometric unlock enabled on this device.'); }))}</>}

          <Text style={styles.heading}>Local login</Text>
          <Text style={styles.text}>Change your login on this device. Your public identity and chats stay the same.</Text>
          <Input label="Local username" accessibilityLabel="New local username" value={username} onChangeText={setUsername} maxLength={80} placeholder={loginName??'Choose a username'} editable={!disabled}/>
          {passwordInput}
          {button('Save local username',()=>void action(async()=>{if(!username.trim())throw Error('Choose a username.');await localAccount.unlock(password);await localAccountUsername.write(status.account!,username);setLoginName(username.trim());setNotice('Local username saved.');}))}
          <Input label="New password" accessibilityLabel="New local password" value={newPassword} onChangeText={setNewPassword} isPassword maxLength={256} autoComplete="off" textContentType="none" editable={!disabled}/>
          <Input label="Confirm new password" accessibilityLabel="Confirm new local password" value={newRepeat} onChangeText={setNewRepeat} isPassword maxLength={256} autoComplete="off" textContentType="none" editable={!disabled}/>
          {button('Change local password',()=>void action(async()=>{
            if(newPassword.length<6)throw Error('New password must contain at least 6 characters.');
            if(newPassword!==newRepeat)throw Error('New passwords do not match. Enter the same password in both fields.');
            await localAccount.unlock(password);await biometrics.disable();await localAccountSession.forget(); await localAccount.changePassword(password,newPassword); await localAccountSession.remember(newPassword);
            setNotice('Password changed. Enable biometric unlock again with your new password if you want to use it.');
          }))}
          {button('Remove account from this device',()=>confirm({title:'Remove from this device?',message:'This removes your local identity, password, chats, call history and app-private media after you close and reopen Axonic. Your 12 recovery words can restore your identity, but not these chats. Gallery copies, the network identity and other people’s messages are not deleted. Enter your current password above before continuing.',buttons:[{text:'Cancel',style:'cancel'},{text:'Remove from device',style:'destructive',onPress:()=>void action(async()=>{await removeAccountFromDevice({account:status.account!,password,confirmed:true});clearSecrets();})}]}))}
          {button('Disable biometric unlock', () => void action(async () => { await biometrics.disable(); setNotice('Biometric unlock disabled.'); }))}

          {button('Lock account', () => void action(async () => { generation.current++; await localAccountSession.lock(); clearSecrets(); setNotice(''); }))}

  </RootProfileScreen>} network={<RootNetworkPanel snapshot={network} replicas={replicas}/>}/><RootAccountCallScreen/></View>;

  const cancelSetup = () => { generation.current++; biometrics.lock(); clearSecrets(); setRestoring(false); setUsername(''); };

  const usernameInput = <Input label="Username" accessibilityLabel="Local username" placeholder="Username on this device"

    autoCorrect={false} autoComplete="username" maxLength={80} value={username} onChangeText={setUsername} editable={!disabled}/>;

  const authButton = (title: string, onPress: () => void, extraDisabled = false) =>

    <Button title={title} onPress={onPress} loading={busy} disabled={disabled || extraDisabled}/>;

  return <SafeAreaView style={styles.root}>

    {!foreground ? <View style={styles.card}><Text style={styles.title}>Axonic is locked</Text></View> :

    <KeyboardFormScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>

          <View style={styles.logoMark}><Image source={require('../../assets/logo.png')} style={{width:46,height:46}} resizeMode="contain"/></View>

          <Text style={styles.title}>AXONIC</Text><View style={styles.underline}/>

          <Text style={styles.subtitle}>SECURE COMMUNICATION NETWORK</Text>

        </View>

        {!!error && !setup && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

        {!!notice && <Text style={styles.text}>{notice}</Text>}

        {!ready && <Text style={styles.text}>Opening local account…</Text>}

        {!ready && <Button title="RETRY" onPress={() => void action(inspect)} loading={busy} disabled={busy||status.busy}/>}

        {ready && status.state === 'empty' && !restoring && <View style={styles.card}>

          <Text style={styles.heading}>Your identity starts here</Text>

          <Text style={styles.text}>Create an identity or recover yours with your private recovery words.</Text>

          {authButton('CREATE IDENTITY', () => void action(async () => { const created = await localAccount.beginCreate(); const selected = await backupWordPositions(created.split(' ').length); if (localAccount.status().state === 'backup') {setPhrase(created);setPositions(selected);setAnswers(['','']);} }))}

          {authButton('RECOVER IDENTITY', () => {setRestoring(true);setError('');})}

        </View>}

        {ready && (status.state === 'backup' || restoring || setup) && <View style={styles.card}>

          {!setup ? <>

            <Text style={styles.heading}>{restoring ? 'Recover your identity' : 'Save your 12 recovery words'}</Text>

            <Text style={styles.text}>{restoring

              ? 'Enter your 12 recovery words in their original order, separated by spaces. Do not type numbers or punctuation. If your original backup has 24 words, enter all 24 instead. Recovery replaces previous devices; it does not restore messages stored only on a lost phone.'

              : 'Write these words down in order and keep them somewhere safe. Anyone with these words can control your identity.'}</Text>

            {!!phrase && <View style={styles.wordGrid}>{phrase.split(' ').map((word,index)=><Text key={index} style={styles.word}>{index+1}. {word}</Text>)}</View>}

            {restoring ? <RecoveryWordsInput value={words} onChangeText={setWords} editable={!disabled}/> : <>
              <Text style={styles.text}>Confirm two words from your backup.</Text>
              {positions.map((position,index)=><Input key={position} label={`Word #${position+1}`} accessibilityLabel={`Confirm word ${position+1}`} placeholder={`Enter word #${position+1}`} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={32} value={answers[index]} onChangeText={value=>setAnswers(old=>index===0?[value,old[1]]:[old[0],value])} editable={!disabled}/>)}
            </>}

            {authButton('CONTINUE', () => void action(async () => {

              const own = generation.current;

              if (restoring) {

                const discovery = recovery.current ??= createMobileRecoveryDiscovery();

                const raw = await findRecoveryRecord(words, discovery.lookup, Date.now);

                if (own !== generation.current) return;

                setRecord(raw);setCheckedRecord(raw);

              } else { if (!checkBackupWords(phrase,positions,answers)) throw Error('The two words do not match. Check their numbers in your backup.'); setWords(phrase); }

              setSetup(true);

            }), restoring ? !words.trim() : answers.some(answer=>!answer.trim()))}

          </> : <>

            <Text style={styles.heading}>Set up local login</Text>

            <Text style={styles.text}>Your username and password unlock this phone. They stay on this device.</Text>

            {usernameInput}

            <Input label="Password" accessibilityLabel="Local password" placeholder="At least 6 characters" isPassword

              autoCorrect={false} autoComplete="off" textContentType="none" maxLength={256} value={password} onChangeText={setPassword} editable={!disabled}/>

            <Input label="Confirm password" accessibilityLabel="Confirm local password" placeholder="Repeat your password" isPassword

              autoCorrect={false} autoComplete="off" textContentType="none" maxLength={256} value={repeat} onChangeText={setRepeat} editable={!disabled}/>

            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}

            <View style={styles.row}><Text style={styles.text}>Enable biometric login</Text><Switch accessibilityLabel="Enable biometric login"

              value={enableBiometrics} onValueChange={setEnableBiometrics} disabled={disabled || !biometrics.available()}/></View>

            {!biometrics.available() && <Text style={styles.text}>Set up biometrics in your phone settings to enable this option.</Text>}

            {authButton(saved ? 'FINISH SETUP' : 'CONNECT', () => void action(async () => {

              confirmPassword();

              if (!username.trim()) throw Error('Choose a local username.');

              const own = generation.current, secret = password;

              // Bind the login name before the vault can become usable. Orphaned public metadata is harmless if saving fails.

              const expectedAccount = accountFromRecoveryPhrase(restoring ? words : phrase);

              await localAccountUsername.write(expectedAccount, username);

              if (own !== generation.current) return;

              setLoginName(username.trim());

              if (!saved) {

                if (restoring) {

                  if (!checkedRecord || checkedRecord !== record || !recovery.current) throw Error('Look up your identity again.');

                  const discovery = recovery.current;

                  await localAccount.restore(words, record, secret, async () => { await checkRecoveryRecord(record, discovery.lookup, Date.now, true); });

                } else await localAccount.confirmBackup(phrase, secret);

                if (own !== generation.current) return;

                setSaved(true);

              }

              const account = localAccount.status().account;

              if (!account || account !== expectedAccount) throw Error('Local identity unavailable.');

              await localAccountUsername.write(account, username);


              if (own !== generation.current) return;

              setLoginName(username.trim());

              if (enableBiometrics) await biometrics.enroll(secret);

              else await localAccount.unlock(secret);
              await localAccountSession.remember(secret);

              if (own !== generation.current) return;

              clearSecrets();setRestoring(false);

            }))}

          </>}

          {authButton('CANCEL', cancelSetup)}

        </View>}

        {ready && status.state === 'locked' && !setup && <View style={styles.card}>

          <Text style={styles.heading}>Welcome back</Text>

          {loginName !== null && usernameInput}

          <Input label="Password" accessibilityLabel="Local password" placeholder="Enter your password" isPassword autoCorrect={false}

            autoComplete="off" textContentType="none" maxLength={256} value={password} onChangeText={setPassword} editable={!disabled}/>

          {authButton('CONNECT', () => void action(async () => {

            if (loginName !== null && username.trim() !== loginName) throw Error('Check your local username and password.');

            await localAccount.unlock(password);
            await localAccountSession.remember(password);

          }))}

          {biometrics.available() && authButton('USE BIOMETRICS', () => void action(() => biometrics.unlock()))}

          <Text style={styles.text}>Your password unlocks this device. It is never sent to another neuron.</Text>

        </View>}

    </KeyboardFormScrollView>}

  </SafeAreaView>;

}

const makeLocalStyles = (colors:ReturnType<typeof useTheme>['colors'])=>StyleSheet.create({

  root: { flex: 1, backgroundColor: colors.background }, content: { flexGrow:1, padding: Spacing.xl, paddingTop:Spacing.xxl, paddingBottom:Spacing.xxxl, gap:16 },

  title: { fontSize: Font.size.title, fontWeight: '800', letterSpacing:8, color: colors.primary }, subtitle: { fontSize: Font.size.xs, letterSpacing:2, color: colors.textSecondary },

  header:{alignItems:'center',marginBottom:Spacing.lg},logoMark:{width:72,height:72,borderRadius:12,borderWidth:2,borderColor:colors.primary,alignItems:'center',justifyContent:'center',marginBottom:Spacing.lg,shadowColor:colors.primary,shadowOpacity:0.6,shadowRadius:16,elevation:8},underline:{width:48,height:2,backgroundColor:colors.accent,marginTop:6,marginBottom:Spacing.sm},

  wordGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},word:{width:'46%',padding:8,color:colors.text,fontSize:16},

  heading: { fontSize: 21, fontWeight: '600', color: colors.text }, card: { gap:16, padding:Spacing.xl, backgroundColor:colors.surface,borderColor:colors.neonBorder,borderWidth:1,borderRadius:Radius.lg,shadowColor:colors.primary,shadowOpacity:0.15,shadowRadius:20,elevation:6 },

  text: { fontSize: 15, lineHeight: 23, color: colors.textSecondary }, error: { color: colors.error, fontSize: 15 },

  words: { fontSize: 18, lineHeight: 29, color: colors.text, backgroundColor: colors.surface, padding: 16, borderRadius: 12 },

  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },

  button: { backgroundColor: colors.primary, padding: 15, borderRadius: 12, alignItems: 'center' },

  buttonText: { color: colors.textInverse, fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.4 },

  row: { flexDirection: 'row', gap: 16 }, code: { fontSize: 13, color: colors.textSecondary },

});
