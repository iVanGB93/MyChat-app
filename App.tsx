import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/contexts/AuthContext';
import { NotificationProvider } from './src/contexts/NotificationContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { ConfirmProvider } from './src/contexts/ConfirmContext';
import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import {
  setupNotificationChannels,
  addNotificationResponseListener,
} from './src/services/pushNotificationService';
import { registerBackgroundTask } from './src/services/backgroundNotificationService';
import * as Notifications from 'expo-notifications';
import {
  setupCallNotifications,
  subscribeCallActions,
  cancelIncomingCallNotification,
} from './src/services/callNotificationService';
import { joinCall, endCall } from './src/services/callService';
import { AppLifecycleBridge } from './src/store/AppLifecycleBridge';
import { DebugOverlay } from './src/store/DebugOverlay';
import { ConnectionBanner } from './src/store/ConnectionBanner';
import { ActiveCallBanner } from './src/store/ActiveCallBanner';
import { IncomingCallBanner } from './src/store/IncomingCallBanner';

export default function App() {
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // Setup notification channels (Android)
    setupNotificationChannels();

    // Notifee call-style notification setup (channel, permission, iOS category,
    // foreground event listener for Accept / Decline).
    setupCallNotifications().catch((err) =>
      console.warn('[App] setupCallNotifications failed:', err),
    );

    // Handle Accept / Decline / Press from the call notification.
    const unsubCallActions = subscribeCallActions((action) => {
      const { type, data } = action;
      console.log('[App] CallNotif action:', type, data.callId);

      if (type === 'decline') {
        endCall(data.callId, 'reject').catch(() => {});
        cancelIncomingCallNotification(data.callId).catch(() => {});
        return;
      }

      // accept / press → open the IncomingCall screen so the existing flow
      // (joinCall, navigate to ActiveCall) handles the rest.
      cancelIncomingCallNotification(data.callId).catch(() => {});

      if (type === 'accept') {
        // Optimistically join; IncomingCallScreen would normally call this on
        // tap Accept, but the action button bypasses that screen.
        joinCall(data.callId).catch(() => {});
        const tryNavigate = () => {
          if (!navigationRef.isReady()) {
            setTimeout(tryNavigate, 100);
            return;
          }
          navigationRef.navigate('ActiveCall', {
            callId: data.callId,
            otherName: data.callerName,
            callType: data.callType,
            roomName: data.roomName,
            isOutgoing: false,
            peerUserId: data.callerId,
          });
        };
        tryNavigate();
        return;
      }

      // 'press' → open the full incoming-call screen so the user can decide.
      const tryNav = () => {
        if (!navigationRef.isReady()) {
          setTimeout(tryNav, 100);
          return;
        }
        navigationRef.navigate('IncomingCall', {
          callId: data.callId,
          callerName: data.callerName,
          callerId: data.callerId,
          callType: data.callType,
          roomName: data.roomName,
        });
      };
      tryNav();
    });

    // Register background task for polling notifications when app is closed
    registerBackgroundTask();

    // Handle notification taps — navigate to the relevant screen
    responseListener.current = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      console.log('[App] Notification tapped:', data);

      if (!navigationRef.isReady() || !data) return;

      if (data.type === 'incoming_call') {
        navigationRef.navigate('IncomingCall', {
          callId: String(data.callId ?? ''),
          callerName: String(data.callerName ?? 'Unknown'),
          callerId: Number(data.callerId ?? 0),
          callType: (data.callType as 'voice' | 'video') ?? 'voice',
          roomName: String(data.roomName ?? ''),
        });
      } else if (data.type === 'new_message' && data.roomId) {
        navigationRef.navigate('ChatRoom', {
          roomId: String(data.roomId),
          roomName: String(data.roomName ?? ''),
        });
      }
    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
      unsubCallActions();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <NotificationProvider>
              <ConfirmProvider>
                <AppLifecycleBridge />
                <ThemedStatusBar />
                <AppNavigator />
                <ConnectionBanner />
                <ActiveCallBanner />
                <IncomingCallBanner />
                <DebugOverlay />
              </ConfirmProvider>
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'light'} />;
}
