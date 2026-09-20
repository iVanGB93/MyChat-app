/* ------------------------------------------------------------------ */
/*  AppUpdateGate                                                       */
/*                                                                      */
/*  Checks Google Play on launch/foreground (with a backend fallback):  */
/*   - forces an update (blocking overlay) when the installed version is */
/*     below the backend's min_supported (e.g. breaking protocol change) */
/*   - suggests optional updates through the native Google Play sheet   */
/*   - offers restart after Play finishes downloading an update          */
/*  Fails open: any error → renders nothing.                            */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Spacing, Radius, Font } from '../theme';
import { checkAppVersion, VersionCheckResult } from '../services/versionCheckService';
import {
  serializeUpdateDismissal,
  shouldShowOptionalUpdate,
} from '../services/versionPolicy';
import { completePlayUpdateAsync, getPlayUpdateInfoAsync, startPlayUpdateAsync, supportsPlayUpdateFlow, observePlayInstallStatus } from '../../modules/axonic-app-update';

const DISMISS_KEY = 'axonic_update_dismissed_version';
const FOREGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function AppUpdateGate() {
  const { colors: Colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<VersionCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const mountedRef = useRef(false);
  const checkingRef = useRef(false);
  const lastCheckedAtRef = useRef(0);
  const [installStatus, setInstallStatus] = useState(0);
  const [watchDownload, setWatchDownload] = useState(false);
  const installRevision = useRef(0);
  const applyInstallStatus = useCallback((status: number) => {
    setInstallStatus(status);
    if ([1, 2, 3].includes(status)) setWatchDownload(true);
    if ([4, 5, 6, 11].includes(status)) setWatchDownload(false);
    if (status === 5 || status === 6) setDismissed(false);
  }, []);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const flowRef = useRef(false);
  const promptedRef = useRef('');
  const downloading = installStatus === 1 || installStatus === 2 || installStatus === 3;

  const refreshInstallStatus = useCallback(async () => {
    if (Platform.OS !== 'android' || !supportsPlayUpdateFlow()) return;
    try {
      const revision = installRevision.current;
      const info = await getPlayUpdateInfoAsync();
      if (!mountedRef.current || !info || revision !== installRevision.current) return;
      applyInstallStatus(info.installStatus ?? 0);
      // Resume a Play-owned immediate update after the app returns to foreground.
      if (info.availability === 'in_progress' && !flowRef.current && AppState.currentState === 'active') {
        flowRef.current = true;
        try { await startPlayUpdateAsync(true); } finally { flowRef.current = false; }
      }
    } catch { /* Offline/unsupported store must not interrupt the app. */ }
  }, [applyInstallStatus]);

  const runCheck = useCallback(async (force = false) => {
    const now = Date.now();
    if (checkingRef.current) return;
    if (!force && now - lastCheckedAtRef.current < FOREGROUND_CHECK_INTERVAL_MS) return;

    checkingRef.current = true;
    lastCheckedAtRef.current = now;
    try {
      const res = await checkAppVersion();
      if (!mountedRef.current) return;
      setResult(res);
      if (res.status === 'optional') {
        try {
          const storedDismissal = await AsyncStorage.getItem(DISMISS_KEY);
          if (!mountedRef.current) return;
          setDismissed(!shouldShowOptionalUpdate(res.updateId, storedDismissal, now));
        } catch {
          setDismissed(false);
        }
      } else {
        setDismissed(true);
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const installSubscription = observePlayInstallStatus((status) => {
      if (!mountedRef.current) return;
      installRevision.current += 1;
      applyInstallStatus(status);
    });
    void runCheck(true);
    void refreshInstallStatus();
    const subscription = AppState.addEventListener('change', (nextState) => {
      setForeground(nextState === 'active');
      if (nextState === 'active') { void runCheck(); void refreshInstallStatus(); }
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
      installSubscription?.remove();
    };
  }, [runCheck, refreshInstallStatus, applyInstallStatus]);

  useEffect(() => {
    if ((!downloading && !watchDownload) || !foreground) return;
    const timer = setInterval(() => { void refreshInstallStatus(); }, 10_000);
    return () => clearInterval(timer);
  }, [downloading, watchDownload, foreground, refreshInstallStatus]);

  const openStore = () => {
    const url = result?.storeUrl;
    if (url) Linking.openURL(url).catch(() => Alert.alert('Could not open store', 'Please open the app store and search for Axonic.'));
  };

  const startUpdate = async (automatic = false) => {
    if (flowRef.current || !result || AppState.currentState !== 'active') return;
    flowRef.current = true;
    setNativeBusy(true);
    try {
      const outcome = Platform.OS === 'android' ? await startPlayUpdateAsync(result.status === 'forced') : 'unavailable';
      if (!mountedRef.current) return;
      if (outcome === 'downloaded') { installRevision.current += 1; applyInstallStatus(11); }
      else if (outcome === 'accepted') { setWatchDownload(true); void refreshInstallStatus(); }
      else if (outcome === 'cancelled') { if (result.status === 'optional') dismiss(); }
      else if (outcome !== 'busy' && !automatic) openStore();
    } catch {
      if (!automatic) openStore();
    } finally {
      flowRef.current = false;
      if (mountedRef.current) setNativeBusy(false);
    }
  };

  // Google Play owns optional update prompts. Do not render a second app banner
  // before/after the native sheet or when the native flow is unavailable.
  useEffect(() => {
    if (!foreground || !result || result.status === 'ok' || nativeBusy || downloading || installStatus === 11) return;
    if (result.status === 'optional' && dismissed) return;
    if (Platform.OS !== 'android' || !supportsPlayUpdateFlow() || promptedRef.current === result.updateId) return;
    promptedRef.current = result.updateId;
    void startUpdate(true);
  }, [result, dismissed, foreground, nativeBusy, downloading, installStatus]);

  const dismiss = () => {
    setDismissed(true);
    if (result?.updateId) {
      AsyncStorage.setItem(DISMISS_KEY, serializeUpdateDismissal(result.updateId)).catch(() => {});
    }
  };

  if (installStatus === 11) return (
    <View style={[styles.banner, { top: insets.top + 4, backgroundColor: Colors.surface }]}>
      <Text style={[styles.bannerText, { color: Colors.text }]}>Update ready to install</Text>
      <TouchableOpacity disabled={nativeBusy} style={styles.bannerAction} onPress={() => {
        Alert.alert('Restart Axonic?', 'The update will close and restart Axonic. Finish any active call first.', [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart', onPress: () => {
            setNativeBusy(true);
            void completePlayUpdateAsync().catch(() => Alert.alert('Could not install update', 'Please try again or update from Google Play.')).finally(() => { if (mountedRef.current) setNativeBusy(false); });
          } },
        ]);
      }}><Text style={{ color: Colors.primary, fontWeight: '700' }}>Restart to update</Text></TouchableOpacity>
    </View>
  );
  if (!result || result.status === 'ok' || nativeBusy) return null;
  if (downloading && result.status !== 'forced') return null;

  // ---- Forced update: blocking full-screen overlay ----
  if (result.status === 'forced') {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.divider }]}>
            <Ionicons name="rocket-outline" size={40} color={Colors.primary} />
            <Text style={[styles.title, { color: Colors.text }]}>Update required</Text>
            <Text style={[styles.body, { color: Colors.textSecondary }]}>
              This version of Axonic is no longer supported. Please update to the latest
              version to keep chatting.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: Colors.primary }]}
              onPress={() => { void startUpdate(); }}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {Platform.OS === 'ios' ? 'Update on the App Store' : 'Update on Google Play'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: { fontSize: Font.size.lg, fontWeight: '800', letterSpacing: 0.3 },
  body: { fontSize: Font.size.sm, textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
  banner: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 1000,
  },
  bannerText: { flex: 1, color: '#fff', fontSize: Font.size.sm, fontWeight: '600' },
  bannerAction: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
});
