/* ------------------------------------------------------------------ */
/*  ConnectionStatusBar — animated bar showing WS connection state     */
/*  Shows at top of screen when not connected, with status + retry     */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useNotificationContext,
  ConnectionStatus,
} from '../../contexts/NotificationContext';
import { Font, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';

function getStatusConfig(Colors: any): Record<
  ConnectionStatus,
  { label: string; bg: string; icon: string; showRetry: boolean; showSpinner: boolean }
> {
  return {
    connected: {
      label: 'Connected',
      bg: Colors.success,
      icon: '✓',
      showRetry: false,
      showSpinner: false,
    },
    connecting: {
      label: 'Connecting…',
      bg: Colors.warning,
      icon: '⟳',
      showRetry: false,
      showSpinner: true,
    },
    reconnecting: {
      label: 'Reconnecting…',
      bg: Colors.warning,
      icon: '⟳',
      showRetry: true,
      showSpinner: true,
    },
    disconnected: {
      label: 'Disconnected',
      bg: Colors.error,
      icon: '✕',
      showRetry: true,
      showSpinner: false,
    },
    'no-internet': {
      label: 'No internet connection',
      bg: '#64748B',
      icon: '📡',
      showRetry: true,
      showSpinner: false,
    },
  };
}

export default function ConnectionStatusBar() {
  const { connectionStatus, reconnectAttempt, reconnectNow } = useNotificationContext();
  const { colors: Colors } = useTheme();
  const insets = useSafeAreaInsets();

  const slideAnim = useRef(new Animated.Value(-60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const isVisible = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldShow = connectionStatus !== 'connected';

  useEffect(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }

    if (shouldShow && !isVisible.current) {
      isVisible.current = true;
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!shouldShow && isVisible.current) {
      hideTimer.current = setTimeout(() => {
        isVisible.current = false;
        Animated.parallel([
          Animated.timing(slideAnim, {
            toValue: -60,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 2000);

      isVisible.current = true;
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [shouldShow, connectionStatus]);

  const STATUS_CONFIG = getStatusConfig(Colors);
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <Animated.View
      pointerEvents={shouldShow ? 'auto' : 'none'}
      style={[
        styles.container,
        {
          backgroundColor: config.bg,
          paddingTop: insets.top > 0 ? insets.top : Platform.OS === 'android' ? 30 : 0,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <View style={styles.inner}>
        <View style={styles.left}>
          {config.showSpinner ? (
            <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
          ) : (
            <Text style={styles.icon}>{config.icon}</Text>
          )}
          <Text style={styles.label}>
            {config.label}
            {connectionStatus === 'reconnecting' && reconnectAttempt > 1
              ? ` (${reconnectAttempt})`
              : ''}
          </Text>
        </View>

        {config.showRetry && (
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={reconnectNow}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
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
    zIndex: 9998,
    elevation: 9,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    fontSize: 14,
    marginRight: Spacing.sm,
  },
  spinner: {
    marginRight: Spacing.sm,
  },
  label: {
    color: '#FFFFFF',
    fontSize: Font.size.sm,
    ...Font.semiBold,
  },
  retryBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: Font.size.sm,
    ...Font.semiBold,
  },
});
