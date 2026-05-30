/* ------------------------------------------------------------------ */
/*  ConnectionBanner                                                   */
/*                                                                     */
/*  Slim status bar shown at the top of the app when something is      */
/*  wrong with connectivity. Hidden when everything is fine.           */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from './appStore';

interface BannerState {
  show: boolean;
  text: string;
  color: string;
}

function deriveBanner(
  net: string,
  notifStatus: string,
  authenticated: boolean,
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
  if (notifStatus === 'disconnected') {
    return { show: true, text: 'Disconnected', color: '#6B7280' };
  }
  return { show: false, text: '', color: '' };
}

export function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const net = useAppStore((s) => s.net);
  const notifStatus = useAppStore((s) => s.notifWs.status);
  const authenticated = useAppStore((s) => s.notifWs.authenticated);
  const suspendedUntil = useAppStore((s) => s.notifWs.suspendedUntil);
  const appLifecycle = useAppStore((s) => s.appLifecycle);

  const banner = deriveBanner(net, notifStatus, authenticated, suspendedUntil, appLifecycle);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: banner.show ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [banner.show, slide]);

  if (!banner.show) return null;

  return (
    <Animated.View
      pointerEvents="none"
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
      <Text style={styles.text}>{banner.text}</Text>
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
});
