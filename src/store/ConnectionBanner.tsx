/* ------------------------------------------------------------------ */
/*  ConnectionBanner                                                   */
/*                                                                     */
/*  Slim status bar shown at the top of the app when something is      */
/*  wrong with connectivity. Hidden when everything is fine.           */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { selectNotifWsConnected, useAppStore } from './appStore';
import { reconnectWsNow } from '../services/notificationWsManager';
import { navigationRef } from '../navigation/AppNavigator';

interface BannerState {
  show: boolean;
  text: string;
  color: string;
}

function deriveBanner(
  net: string,
  notifStatus: string,
  authenticated: boolean,
  verifiedConnected: boolean,
  suspendedUntil: number,
  appLifecycle: string,
): BannerState {
  // Skip while the app is backgrounded — banners only matter when visible.
  if (appLifecycle !== 'active') return { show: false, text: '', color: '' };

  if (net === 'offline') {
    return { show: true, text: 'No internet connection', color: '#EF4444' };
  }
  if (suspendedUntil > Date.now()) {
    const sec = Math.ceil((suspendedUntil - Date.now()) / 1000);
    return { show: true, text: `Server unavailable — retrying in ${sec}s`, color: '#EF4444' };
  }
  if (notifStatus === 'connecting' || notifStatus === 'reconnecting') {
    return { show: true, text: 'Connecting…', color: '#F59E0B' };
  }
  if (notifStatus === 'connected' && !authenticated) {
    return { show: true, text: 'Authenticating…', color: '#F59E0B' };
  }
  if (notifStatus === 'connected' && authenticated && !verifiedConnected) {
    return { show: true, text: 'Connection stale — recovering…', color: '#F59E0B' };
  }
  if (notifStatus === 'disconnected') {
    return { show: true, text: 'Disconnected', color: '#6B7280' };
  }
  return { show: false, text: '', color: '' };
}

export function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const [currentRoute, setCurrentRoute] = useState<string | undefined>();
  const net = useAppStore((s) => s.net);
  const notifStatus = useAppStore((s) => s.notifWs.status);
  const authenticated = useAppStore((s) => s.notifWs.authenticated);
  const verifiedConnected = useAppStore(selectNotifWsConnected);
  const suspendedUntil = useAppStore((s) => s.notifWs.suspendedUntil);
  const appLifecycle = useAppStore((s) => s.appLifecycle);

  // Track current route to hide banner on auth screens.
  // Navigation may not be ready on first render, so attach lazily.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const syncCurrentRoute = () => {
      if (!navigationRef.isReady()) return;
      const route = navigationRef.getCurrentRoute()?.name;
      setCurrentRoute(route);
    };

    const attachStateListener = () => {
      if (unsubscribe || !navigationRef.isReady()) return;
      unsubscribe = navigationRef.addListener('state', syncCurrentRoute);
      syncCurrentRoute();
    };

    attachStateListener();

    const retryTimer = setInterval(() => {
      if (!unsubscribe) {
        attachStateListener();
      } else {
        clearInterval(retryTimer);
      }
    }, 120);

    return () => {
      clearInterval(retryTimer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const banner = deriveBanner(net, notifStatus, authenticated, verifiedConnected, suspendedUntil, appLifecycle);
  const canReconnect = notifStatus === 'disconnected' || notifStatus === 'reconnecting';
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: banner.show ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [banner.show, slide]);

  // Don't show banner on login/register/verify screens
  const isAuthScreen = currentRoute === 'Login' || currentRoute === 'Register' || currentRoute === 'VerifyEmail';
  if (isAuthScreen) return null;

  if (!banner.show) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          paddingTop: insets.top + 4,
          backgroundColor: banner.color,
          opacity: slide,
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [-30, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.text}>{banner.text}</Text>
        {canReconnect ? (
          <Pressable
            onPress={reconnectWsNow}
            style={styles.reconnectBtn}
            hitSlop={8}
          >
            <Text style={styles.reconnectText}>Reconnect</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 4,
    alignItems: 'center',
    zIndex: 9998,
    elevation: 9998,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reconnectBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  reconnectText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
