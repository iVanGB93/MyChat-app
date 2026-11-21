import {t} from '../localization/language';
import {Chrome} from '../theme';
import {useAccountState,useNetworkState} from '../modules/ui/liveState';
import RenderBoundary from '../components/ui/RenderBoundary';
import {requestInitialNotificationPermission} from '../services/notificationPermission';
import {KeyboardFormScrollView} from '../components/ui/KeyboardForm';
import {startAppMaintenance} from '../modules/maintenance';
import {RootShareProvider} from '../components/chat/RootSharePicker';
import {ConfirmProvider,useConfirm} from '../contexts/ConfirmContext';
import {ThemedAlertBridge} from '../components/ui/ThemedAlert';
import {LiveNetworkPanel} from './profile/RootNetworkPanel';
import RootProfileScreen from './profile/RootProfileScreen';


import {rootCallMayRunBackground} from '../modules/calls';

import {subscribeLocalAccountCalls} from '../modules/calls';

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

import { Font, Spacing } from '../theme';


import React, { useEffect, useRef, useState } from 'react';
import {startDiagnosticLifecycle} from '../modules/maintenance';

import { AppState, Image, Switch, Share, StyleSheet, Text, View } from 'react-native';

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { identityUnlockErrorMessage, localAccount, removeAccountFromDevice, closeForDeviceRemoval, startLocalAccount, localAccountBiometrics as biometrics, localAccountUsername, localAccountSession } from '../modules/identity';

import { loadBootstrapEndpoint, startLocalAccountNetwork } from '../modules/network';
import BootstrapSettings from '../components/BootstrapSettings';
import {createForegroundNetworkLease} from '../services/foregroundNetworkLease';


/** Application shell for local identities and the neuron network. */

export default function LocalAccountApp() {
 useEffect(startDiagnosticLifecycle,[]);
 useEffect(startAppMaintenance,[]);
 useEffect(()=>{
  const ask=()=>void requestInitialNotificationPermission().catch(()=>{});
  ask();const listener=AppState.addEventListener('change',state=>{if(state==='active')ask();});
  return()=>listener.remove();
 },[]);

 return <RenderBoundary scope="app"><GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><ThemeProvider><ConfirmProvider><ThemedAlertBridge/><RootShareProvider><LocalAccountContent/></RootShareProvider></ConfirmProvider></ThemeProvider></SafeAreaProvider></GestureHandlerRootView></RenderBoundary>;

}

function LocalAccountContent() {

  const {colors}=useTheme(),styles=makeLocalStyles(colors),{confirm}=useConfirm();

  const status=useAccountState();

  const [autoLock, setAutoLock] = useState(false), autoLockRef = useRef(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);

  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  const [newPassword,setNewPassword]=useState(''),[newRepeat,setNewRepeat]=useState('');
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');

  const [phrase, setPhrase] = useState(''), [words, setWords] = useState(''), [record, setRecord] = useState('');

  const [checkedRecord, setCheckedRecord] = useState('');

  const [setup, setSetup] = useState(false), [saved, setSaved] = useState(false), [enableBiometrics, setEnableBiometrics] = useState(false);

  const [username, setUsername] = useState(''), [loginName, setLoginName] = useState<string | null>(null);

  const recovery = useRef<ReturnType<typeof createMobileRecoveryDiscovery> | null>(null);

  const [lockedRecovery,setLockedRecovery]=useState<string|null>(null),[forgotPassword,setForgotPassword]=useState(false),[startOver,setStartOver]=useState(false);
  const closeRecovery = () => { recovery.current?.stop(); recovery.current = null; setCheckedRecord(''); };

  const [restoring, setRestoring] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');

  const connections=useNetworkState(s=>s.liveConnections.length);

  const generation = useRef(0), actionRunning = useRef(false);

  const clearSecrets = () => { closeRecovery(); setLockedRecovery(null); setForgotPassword(false); setStartOver(false); setPassword(''); setRepeat(''); setPhrase(''); setWords(''); setRecord(''); setSetup(false); setSaved(false); setEnableBiometrics(false); setRestoring(false); setNewPassword('');setNewRepeat(''); };

  const locked = status.state !== 'unlocked';

  const disabled = busy || status.busy || !ready;



  async function action(work: () => Promise<void>) {

    if (actionRunning.current || status.busy) return;

    actionRunning.current = true;

    const own = generation.current; setBusy(true); setError(''); setNotice('');

    try { await work(); }

    catch (e) { if (restoring && !setup) { closeRecovery(); } if (generation.current === own) setError(e instanceof Error ? (e.message === identityUnlockErrorMessage ? t(identityUnlockErrorMessage) : e.message) : t("Unable to complete this action")); }

    finally { if (generation.current === own && !setup) { setPassword(''); setRepeat('');setNewPassword('');setNewRepeat(''); } actionRunning.current = false; setBusy(false); }

  }

  async function inspect() {

    await loadBootstrapEndpoint().catch(() => {});
    await startLocalAccount(); autoLockRef.current = localAccountSession.autoLock(); setAutoLock(autoLockRef.current);

    const account = localAccount.status().account;

    setReady(true);
    // The display name is optional and must not gate account startup.
    if(account)void localAccountUsername.read(account).then(name=>{
      if(localAccount.status().account===account)setLoginName(current=>current??name);
    }).catch(()=>{});

  }

  useEffect(() => {


    const network=createForegroundNetworkLease(startLocalAccountNetwork);
    const stopCallState=subscribeLocalAccountCalls(view=>{network.call(!!view&&view.status!=='ended');if(autoLockRef.current&&AppState.currentState==='background'&&(!view||view.status==='ended'))biometrics.lock();});

    void inspect().catch(() => setError(t("Unable to read local account storage. Retry without creating a replacement account.")));

    try { network.activity(AppState.currentState==='active'); } catch { setError(t("Network transport unavailable in this build.")); }



    const state = AppState.addEventListener('change', next => {

      setForeground(next === 'active');
      // Ignore transient inactive states (permission prompts); background is definitive.
      if(next==='active'||next==='background')try{network.activity(next==='active');}catch{setError(t("Network transport unavailable in this build."));}

      // iOS biometric prompts briefly make the app inactive;

      // Setup secrets and opt-in locked accounts are cleared on backgrounding.

      if (next === 'background' && (autoLockRef.current || localAccount.status().state !== 'unlocked')) { generation.current++; if(!rootCallMayRunBackground())biometrics.lock(); clearSecrets(); setNotice(''); setError(''); }

    });

    return () => { generation.current++; state.remove(); stopCallState(); recovery.current?.stop(); recovery.current = null; network.stop(); biometrics.lock(); };

  }, []);

  const button = (label:string,onPress:()=>void,extraDisabled=false)=><Button title={label.toUpperCase()} onPress={onPress} loading={busy} disabled={disabled||extraDisabled}/>;
  const passwordInput=<Input accessibilityLabel={t("Local password")} label={t("CURRENT PASSWORD")} placeholder={t("Current local password")} isPassword autoCapitalize="none" autoCorrect={false} textContentType="none" autoComplete="off" maxLength={256} value={password} onChangeText={setPassword} editable={!disabled}/>;

  const confirmPassword = () => { if (password.length < 6) throw Error(t("Password must contain at least 6 characters.")); if (password.length > 256) throw Error(t("Password must contain no more than 256 characters.")); if (password !== repeat) throw Error(t("Passwords do not match. Enter the same password in both fields.")); };

  if(status.removalPending)return <SafeAreaView style={styles.root}><View style={styles.card}>
    <Text style={styles.heading}>{t("Finish removing this account")}</Text>
    <Text style={styles.text}>{t("Your account is locked. Close Axonic below, then reopen it to finish removing this device’s identity, chats and private files. Saved gallery media and other people’s messages stay unchanged.")}</Text>
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Button title={t("CLOSE AXONIC")} onPress={()=>void closeForDeviceRemoval().catch(e=>setError(e instanceof Error?e.message:t("Unable to close Axonic")))}/>
  </View></SafeAreaView>;

  if(ready&&!locked&&!setup)return <View style={styles.root}><RenderBoundary scope="screens"><RootAccountNavigator profile={<RootProfileScreen account={status.account!} loginName={loginName} connected={connections}>

    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!notice&&<Text style={styles.text}>{notice}</Text>}

          <View style={styles.row}><View style={{flex:1}}><Text style={styles.heading}>{t("Lock when leaving app")}</Text><Text style={styles.text}>{t("Off by default. Keep this device signed in, or require your password or biometrics when you return.")}</Text></View><Switch accessibilityLabel={t("Lock when leaving app")} value={autoLock} disabled={disabled} onValueChange={value=>void action(async()=>{if(value)autoLockRef.current=true;try {await localAccountSession.setAutoLock(value,password);} finally {autoLockRef.current=localAccountSession.autoLock();setAutoLock(autoLockRef.current);}})}/></View>
          {autoLock&&<Text style={styles.text}>{t("To turn locking off, enter your current password below, then turn the switch off.")}</Text>}
          {button(t("Enable notifications"),()=>void action(async()=>{const settings=await notifee.requestPermission();setNotice(settings.authorizationStatus>=AuthorizationStatus.AUTHORIZED?t("Notifications enabled."):t("Notifications are disabled in system settings."));}))}

          {button(t("Save public recovery record"), () => void action(async () => { await Share.share({ message: localAccount.recoveryRecord() }); }))}

          <Text style={styles.text}>{t("Your recovery words restore your identity through its signed network record. Keep a public record as an optional extra backup.")}</Text>

          <Text style={styles.heading}>{t("Unlock preferences")}</Text>

          {biometrics.available() && <>{passwordInput}{button(t("Enable biometric unlock"), () => void action(async () => { await biometrics.enroll(password); setNotice(t("Biometric unlock enabled on this device.")); }))}</>}

          <Text style={styles.heading}>{t("Local login")}</Text>
          <Text style={styles.text}>{t("Change your login on this device. Your public identity and chats stay the same.")}</Text>
          <Input label={t("Local username")} accessibilityLabel={t("New local username")} value={username} onChangeText={setUsername} maxLength={80} placeholder={loginName??t("Choose a username")} editable={!disabled}/>
          {passwordInput}
          {button(t("Save local username"),()=>void action(async()=>{if(!username.trim())throw Error(t("Choose a username."));await localAccount.unlock(password);await localAccountUsername.write(status.account!,username);setLoginName(username.trim());setNotice(t("Local username saved."));}))}
          <Input label={t("New password")} accessibilityLabel={t("New local password")} value={newPassword} onChangeText={setNewPassword} isPassword maxLength={256} autoComplete="off" textContentType="none" editable={!disabled}/>
          <Input label={t("Confirm new password")} accessibilityLabel={t("Confirm new local password")} value={newRepeat} onChangeText={setNewRepeat} isPassword maxLength={256} autoComplete="off" textContentType="none" editable={!disabled}/>
          {button(t("Change local password"),()=>void action(async()=>{
            if(newPassword.length<6)throw Error(t("New password must contain at least 6 characters."));
            if(newPassword!==newRepeat)throw Error(t("New passwords do not match. Enter the same password in both fields."));
            await localAccount.unlock(password);await biometrics.disable();await localAccountSession.forget(); await localAccount.changePassword(password,newPassword); await localAccountSession.remember(newPassword);
            setNotice(t("Password changed. Enable biometric unlock again with your new password if you want to use it."));
          }))}
          {button(t("Remove account from this device"),()=>confirm({title:t("Remove from this device?"),message:t("This removes your local identity, password, chats, call history and app-private media after you close and reopen Axonic. Your 12 recovery words can restore your identity, but not these chats. Gallery copies, the network identity and other people’s messages are not deleted. Enter your current password above before continuing."),buttons:[{text:t("Cancel"),style:'cancel'},{text:t("Remove from device"),style:'destructive',onPress:()=>void action(async()=>{await removeAccountFromDevice({account:status.account!,password,confirmed:true});clearSecrets();})}]}))}
          {button(t("Disable biometric unlock"), () => void action(async () => { await biometrics.disable(); setNotice(t("Biometric unlock disabled.")); }))}

          {button(t("Lock account"), () => void action(async () => { generation.current++; await localAccountSession.lock(); clearSecrets(); setNotice(''); }))}

  </RootProfileScreen>} network={<LiveNetworkPanel/>}/></RenderBoundary><RenderBoundary scope="calls"><RootAccountCallScreen/></RenderBoundary></View>;

  const cancelSetup = () => { generation.current++; biometrics.lock(); clearSecrets(); setRestoring(false); setUsername(''); };

  const usernameInput = <Input label={t("Username")} accessibilityLabel={t("Local username")} placeholder={t("Username on this device")}

    autoCorrect={false} autoComplete="username" maxLength={80} value={username} onChangeText={setUsername} editable={!disabled}/>;

  const authButton = (title: string, onPress: () => void, extraDisabled = false) =>

    <Button title={title} onPress={onPress} loading={busy} disabled={disabled || extraDisabled}/>;

  return <SafeAreaView style={styles.root}>

    {!foreground ? <View style={styles.card}><Text style={styles.title}>{t("Axonic is locked")}</Text></View> :

    <KeyboardFormScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>

          <View style={styles.logoMark}><Image source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain"/></View>

          <Text style={styles.title}>{t("AXONIC")}</Text><View style={styles.underline}/>

          <Text style={styles.subtitle}>{t("SECURE COMMUNICATION NETWORK")}</Text>

        </View>

        {!!error && !setup && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

        {!!notice && <Text style={styles.text}>{notice}</Text>}

        {!ready && <Text style={styles.text}>{t("Opening local account…")}</Text>}

        {!ready && <Button title={t("RETRY")} onPress={() => void action(inspect)} loading={busy} disabled={busy||status.busy}/>}

        {ready && status.state === 'empty' && !restoring && <View style={styles.card}>

          <Text style={styles.heading}>{t("Your identity starts here")}</Text>

          <Text style={styles.text}>{t("Create an identity or recover yours with your private recovery words.")}</Text>

          {authButton(t("CREATE IDENTITY"), () => void action(async () => { const created = await localAccount.beginCreate(); if (localAccount.status().state === 'backup') setPhrase(created); }))}

          {authButton(t("RECOVER IDENTITY"), () => {setRestoring(true);setError('');})}

          <BootstrapSettings/>

        </View>}

        {ready && (status.state === 'backup' || restoring || setup) && <View style={styles.card}>

          {!setup ? <>

            <Text style={styles.heading}>{restoring ? t("Recover your identity") : t("Save your 12 recovery words")}</Text>

            <Text style={styles.text}>{restoring

              ? t("Enter your 12 recovery words in their original order, separated by spaces. Do not type numbers or punctuation. If your original backup has 24 words, enter all 24 instead. Recovery replaces previous devices; it does not restore messages stored only on a lost phone.")

              : t("Write these words down in order and keep them somewhere safe. Anyone with these words can control your identity.")}</Text>

            {!!phrase && <View style={styles.wordGrid}>{phrase.split(' ').map((word,index)=><Text key={index} style={styles.word}>{index+1}. {word}</Text>)}</View>}

            {restoring && <RecoveryWordsInput value={words} onChangeText={setWords} editable={!disabled}/>}

            {authButton(t("CONTINUE"), () => {
              const own = generation.current;
              if (!restoring) {
                confirm({
                  title: t("Did you save your recovery words?"),
                  message: t("Axonic doesn’t keep a copy of your recovery words, and we can’t access them. Keeping them safe is your responsibility. If you forget your password and lose these words, you could lose access to your Axonic ID."),
                  icon: 'shield-checkmark-outline',
                  buttons: [
                    {text: t("Show me the words again"), style: 'cancel'},
                    {text: t("I saved my words"), onPress: () => {
                      if (generation.current === own && localAccount.status().state === 'backup') setSetup(true);
                    }},
                  ],
                });
                return;
              }

              void action(async () => {
                if(lockedRecovery&&accountFromRecoveryPhrase(words)!==lockedRecovery)throw Error(t("These recovery words belong to a different Axonic ID."));
                const discovery = recovery.current ??= createMobileRecoveryDiscovery();
                const raw = await findRecoveryRecord(words, discovery.lookup, Date.now);
                if (own !== generation.current) return;
                setRecord(raw);
                setCheckedRecord(raw);
                setSetup(true);
              });
            }, restoring ? !words.trim() : !phrase)}

          </> : <>

            <Text style={styles.heading}>{t("Set up local login")}</Text>

            <Text style={styles.text}>{t("Your username and password unlock this phone. They stay on this device.")}</Text>

            {usernameInput}

            <Input label={t("Password")} accessibilityLabel={t("Local password")} placeholder={t("At least 6 characters")} isPassword

              autoCorrect={false} autoComplete="off" textContentType="none" maxLength={256} value={password} onChangeText={setPassword} editable={!disabled}/>

            <Input label={t("Confirm password")} accessibilityLabel={t("Confirm local password")} placeholder={t("Repeat your password")} isPassword

              autoCorrect={false} autoComplete="off" textContentType="none" maxLength={256} value={repeat} onChangeText={setRepeat} editable={!disabled}/>

            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}

            <View style={styles.row}><Text style={styles.text}>{t("Enable biometric login")}</Text><Switch accessibilityLabel={t("Enable biometric login")}

              value={enableBiometrics} onValueChange={setEnableBiometrics} disabled={disabled || !biometrics.available()}/></View>

            {!biometrics.available() && <Text style={styles.text}>{t("Set up biometrics in your phone settings to enable this option.")}</Text>}

            {authButton(saved ? t("FINISH SETUP") : t("CONNECT"), () => void action(async () => {

              confirmPassword();

              if (!username.trim()) throw Error(t("Choose a local username."));

              const own = generation.current, secret = password;

              // Bind the login name before the vault can become usable. Orphaned public metadata is harmless if saving fails.

              const expectedAccount = accountFromRecoveryPhrase(restoring ? words : phrase);

              if(!lockedRecovery)await localAccountUsername.write(expectedAccount, username);

              if (own !== generation.current) return;

              if(!lockedRecovery)setLoginName(username.trim());

              if (!saved) {

                if (restoring) {

                  if (!checkedRecord || checkedRecord !== record || !recovery.current) throw Error(t("Look up your identity again."));

                  const discovery = recovery.current;

                  await localAccount.restore(words, record, secret, async () => { await checkRecoveryRecord(record, discovery.lookup, Date.now, true); }, lockedRecovery??undefined);

                } else await localAccount.confirmBackup(phrase, secret);

                if (own !== generation.current) return;

                setSaved(true);

              }

              const account = localAccount.status().account;

              if (!account || account !== expectedAccount) throw Error(t("Local identity unavailable."));

              await localAccountUsername.write(account, username);


              if (own !== generation.current) return;

              setLoginName(username.trim());

              if (lockedRecovery && !enableBiometrics) await biometrics.disable();
              if (enableBiometrics) await biometrics.enroll(secret);

              else await localAccount.unlock(secret);
              await localAccountSession.remember(secret);

              if (own !== generation.current) return;

              clearSecrets();setRestoring(false);

            }))}

          </>}

          {lockedRecovery&&!setup&&!startOver&&authButton(t("I don’t have my recovery words"),()=>setStartOver(true))}
          {lockedRecovery&&!setup&&startOver&&<>
            <Text style={styles.text}>{t("If another device is still signed in to this account, check it before starting over.")}</Text>
            {authButton(t("Start over with a new Axonic ID"),()=>confirm({
              title:t("Start over with a new Axonic ID?"),
              message:t("This removes the old account, chats, call history, and media stored only in Axonic from this device. Your new ID won’t inherit your old groups. Gallery copies and messages on other people’s devices stay."),
              buttons:[{text:t("Cancel"),style:'cancel'},{text:t("Remove account and start over"),style:'destructive',onPress:()=>void action(async()=>{
                await localAccount.prepareLockedDeviceRemoval(lockedRecovery,true);
                clearSecrets();
              })}],
            }))}
          </>}
          {authButton(t("CANCEL"), cancelSetup)}

        </View>}

        {ready&&status.state==='locked'&&forgotPassword&&!restoring&&<View style={styles.card}>
          <Text style={styles.heading}>{t("Forgot password?")}</Text>
          {biometrics.available()&&authButton(t("USE BIOMETRICS"),()=>void action(()=>biometrics.unlock()))}
          <Text style={styles.text}>{t("Your recovery words let you keep your Axonic ID and choose a new password. Recovery replaces the account’s device keys and can sign out other devices. Axonic keeps existing chat and media files on this phone, but pending deliveries to the old device keys may be lost.")}</Text>
          {authButton(t("RECOVER IDENTITY"),()=>{
            if(!status.account)return;
            setLockedRecovery(status.account);setRestoring(true);setError('');
          })}
          {authButton(t("CANCEL"),cancelSetup)}
        </View>}
        {ready && status.state === 'locked' && !restoring && !setup && !forgotPassword && <View style={styles.card}>

          <Text style={styles.heading}>{t("Welcome back")}</Text>

          {loginName !== null && usernameInput}

          <Input label={t("Password")} accessibilityLabel={t("Local password")} placeholder={t("Enter your password")} isPassword autoCorrect={false}

            autoComplete="off" textContentType="none" maxLength={256} value={password} onChangeText={setPassword} editable={!disabled}/>

          {authButton(t("CONNECT"), () => void action(async () => {

            if (loginName !== null && username.trim() !== loginName) throw Error(t("Check your local username and password."));

            await localAccount.unlock(password);
            await localAccountSession.remember(password);

          }))}

          {biometrics.available() && authButton(t("USE BIOMETRICS"), () => void action(() => biometrics.unlock()))}

          {authButton(t("Forgot password?"),()=>{setError('');setPassword('');setForgotPassword(true);})}
          <Text style={styles.text}>{t("Your password unlocks this device. It is never sent to another neuron.")}</Text>

        </View>}

    </KeyboardFormScrollView>}

  </SafeAreaView>;

}

const makeLocalStyles = (colors:ReturnType<typeof useTheme>['colors'])=>StyleSheet.create({

  root: { flex: 1, backgroundColor: colors.background }, content: { flexGrow:1, padding: Spacing.xl, paddingTop:Spacing.xxl, paddingBottom:Spacing.xxxl, gap:16 },

  title: { fontSize: Font.size.title, fontWeight: '800', letterSpacing:8, color: colors.primary }, subtitle: { fontSize: Font.size.xs, letterSpacing:2, color: colors.textSecondary },

  logoImage:{width:64,height:64,borderRadius:Chrome.cardRadius-4},
  header:{alignItems:'center',marginBottom:Spacing.lg},logoMark:{width:72,height:72,borderRadius:Chrome.cardRadius,borderWidth:2,borderColor:colors.primary,alignItems:'center',justifyContent:'center',marginBottom:Spacing.lg,shadowColor:colors.primary,shadowOpacity:Chrome.shadowOpacity,shadowRadius:16,elevation:8},underline:{width:48,height:2,backgroundColor:colors.accent,marginTop:6,marginBottom:Spacing.sm},

  wordGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},word:{width:'46%',padding:8,color:colors.text,fontSize:16},

  heading: { fontSize: 21, fontWeight: '600', color: colors.text }, card: { gap:16, padding:Spacing.xl, backgroundColor:colors.surface,borderColor:colors.neonBorder,borderWidth:1,borderRadius:Chrome.cardRadius,shadowColor:colors.primary,shadowOpacity:0.15,shadowRadius:20,elevation:6 },

  text: { fontSize: 15, lineHeight: 23, color: colors.textSecondary }, error: { color: colors.error, fontSize: 15 },

  words: { fontSize: 18, lineHeight: 29, color: colors.text, backgroundColor: colors.surface, padding: 16, borderRadius: Chrome.controlRadius },

  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: Chrome.controlRadius, padding: 14, fontSize: 16 },

  button: { backgroundColor: colors.primary, padding: 15, borderRadius: Chrome.controlRadius, alignItems: 'center' },

  buttonText: { color: colors.textInverse, fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.4 },

  row: { flexDirection: 'row', gap: 16 },

});
