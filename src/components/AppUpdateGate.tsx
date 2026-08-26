/* ------------------------------------------------------------------ */
/*  AppUpdateGate                                                       */
/*                                                                      */
/*  Checks Google Play on launch/foreground (with a backend fallback):  */
/*   - forces an update (blocking overlay) when the installed version is */
/*     below the backend's min_supported (e.g. breaking protocol change) */
/*   - suggests an update (dismissible banner) when a newer version is    */
/*     available.                                                        */
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
    void runCheck(true);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void runCheck();
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [runCheck]);

  const openStore = () => {
    const url = result?.storeUrl;
    if (url) Linking.openURL(url).catch(() => {});
  };

  const dismiss = () => {
    setDismissed(true);
    if (result?.updateId) {
      AsyncStorage.setItem(DISMISS_KEY, serializeUpdateDismissal(result.updateId)).catch(() => {});
    }
  };

  if (!result || result.status === 'ok') return null;

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
              onPress={openStore}
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

  // ---- Optional update: dismissible top banner ----
  if (dismissed) return null;
  return (
    <View style={[styles.banner, { top: insets.top + 4, backgroundColor: Colors.primary }]}>
      <Ionicons name="arrow-up-circle-outline" size={20} color="#fff" />
      <Text style={styles.bannerText} numberOfLines={1}>
        A new version is available
      </Text>
      <TouchableOpacity onPress={openStore} style={styles.bannerAction} activeOpacity={0.8}>
        <Text style={styles.bannerActionText}>Update</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );
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
  bannerActionText: { color: '#fff', fontWeight: '800', fontSize: Font.size.xs, letterSpacing: 0.5 },
});
