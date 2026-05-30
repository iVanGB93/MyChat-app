import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/contexts/AuthContext';
import { NotificationProvider } from './src/contexts/NotificationContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import {
  setupNotificationChannels,
  addNotificationResponseListener,
} from './src/services/pushNotificationService';
import { registerBackgroundTask } from './src/services/backgroundNotificationService';
import * as Notifications from 'expo-notifications';

export default function App() {
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // Setup notification channels (Android)
    setupNotificationChannels();

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
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <NotificationProvider>
              <ThemedStatusBar />
              <AppNavigator />
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
