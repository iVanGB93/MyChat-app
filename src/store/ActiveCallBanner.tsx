/* ------------------------------------------------------------------ */
/*  ActiveCallBanner                                                   */
/*                                                                     */
/*  Floating "call in progress" pill shown when an active call exists  */
/*  in the store BUT the user has navigated away from the call screen. */
/*  Tap to return to the call.                                         */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { navigationRef } from '../navigation/AppNavigator';
import { useAppStore } from './appStore';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ActiveCallBanner() {
  const insets = useSafeAreaInsets();
  const activeCall = useAppStore((s) => s.activeCall);

  // Internal timer that runs only while state==='connected'.
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (activeCall?.state === 'connected') {
      if (startedAt.current === null) startedAt.current = Date.now();
      const id = setInterval(() => {
        if (startedAt.current !== null) {
          setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(id);
    }
    startedAt.current = null;
    setSeconds(0);
  }, [activeCall?.state]);

  // Decide whether to render the banner. Skip if:
  //  - no active call
  //  - the user is currently on the ActiveCall / IncomingCall screen
  // Subscribe to navigation state so the banner reacts to route changes.
  const [currentRouteName, setCurrentRouteName] = useState<string | undefined>(
    navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined,
  );
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const attach = () => {
      // This banner mounts beside (not inside) NavigationContainer, so its
      // first effect can run before navigation is ready. Retry once it mounts;
      // otherwise it never learns that the user is already on ActiveCall.
      if (!navigationRef.isReady()) {
        retry = setTimeout(attach, 100);
        return;
      }
      if (cancelled) return;
      const update = () => setCurrentRouteName(navigationRef.getCurrentRoute()?.name);
      update();
      unsubscribe = navigationRef.addListener('state', update);
    };
    attach();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      unsubscribe?.();
    };
  }, []);
  const onCallScreen =
    currentRouteName === 'ActiveCall' || currentRouteName === 'IncomingCall';

  // Animated slide-in
  const slide = useRef(new Animated.Value(0)).current;
  const visible = !!activeCall && !onCallScreen && activeCall.state !== 'ended';
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  if (!activeCall) return null;

  const stateLabel =
    activeCall.state === 'ringing' ? 'Ringing…'
    : activeCall.state === 'connecting' ? 'Connecting…'
    : activeCall.state === 'connected' ? formatDuration(seconds)
    : 'Ended';

  const handlePress = () => {
    if (!navigationRef.isReady()) return;
    if (activeCall.state === 'ringing' && (activeCall as any).isOutgoing === false) {
      navigationRef.navigate('IncomingCall', {
        callId: activeCall.callId,
        callerName: activeCall.peerName,
        callerId: activeCall.peerId,
        callType: activeCall.callType,
        roomName: '',
      });
    } else {
      navigationRef.navigate('ActiveCall', {
        callId: activeCall.callId,
        otherName: activeCall.peerName,
        callType: activeCall.callType,
        roomName: '',
        isOutgoing: true,
        peerUserId: activeCall.peerId,
      });
    }
  };

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.wrapper,
        {
          top: insets.top + 8,
          opacity: slide,
          transform: [
            {
              translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }),
            },
          ],
        },
      ]}
    >
      <TouchableOpacity
        style={styles.pill}
        activeOpacity={0.85}
        onPress={handlePress}
      >
        <View style={styles.dot} />
        <Ionicons
          name={activeCall.callType === 'video' ? 'videocam' : 'call'}
          size={16}
          color="#fff"
          style={{ marginRight: 6 }}
        />
        <Text style={styles.text} numberOfLines={1}>
          {activeCall.peerName} · {stateLabel}
        </Text>
        <Text style={styles.tap}>Tap to return</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9997,
    elevation: 9997,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    maxWidth: '100%',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 8,
  },
  text: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    flexShrink: 1,
  },
  tap: {
    color: '#fff',
    fontSize: 11,
    opacity: 0.85,
    marginLeft: 8,
  },
});
