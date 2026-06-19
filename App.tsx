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
  addNotificationReceivedListener,
} from './src/services/pushNotificationService';
import { registerBackgroundTask, registerPushReceiveTask } from './src/services/backgroundNotificationService';
import { startRingerModeListener } from './src/services/ringerService';
import * as Notifications from 'expo-notifications';
import {
  setupCallNotifications,
  subscribeCallActions,
  cancelIncomingCallNotification,
} from './src/services/callNotificationService';
import { joinCall, endCall } from './src/services/callService';
import { registerFcmForegroundHandler } from './src/services/fcmService';
import { ensureMessageChannel } from './src/services/messageNotificationService';
import notifee, { EventType } from '@notifee/react-native';
import { AppLifecycleBridge } from './src/store/AppLifecycleBridge';
import { DebugOverlay } from './src/store/DebugOverlay';
import { ConnectionBanner } from './src/store/ConnectionBanner';
import { IncomingCallBanner } from './src/store/IncomingCallBanner';
import ShareIntentBridge from './src/store/ShareIntentBridge';
import { savePushMessage } from './src/services/pushMessageStore';

export default function App() {
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const receivedListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // Setup notification channels (Android)
    setupNotificationChannels();

    // Start listening for ringer / mute-switch changes so soundService
    // and IncomingCallScreen can read the current mode synchronously.
    startRingerModeListener();

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
    // Register push-receive task: saves message to SQLite the moment FCM
    // delivers the push, even if the user never taps the notification.
    registerPushReceiveTask();

    // FCM (WhatsApp-style) message notifications: ensure the channel exists and
    // persist data messages that arrive while the app is in the foreground.
    ensureMessageChannel().catch(() => {});
    const unsubFcmForeground = registerFcmForegroundHandler();

    // Navigate to the chat when a MessagingStyle (Notifee) message notification
    // is tapped while the app is alive.
    const navigateToRoomWhenReady = (
      d: Record<string, string>,
      attempt = 0,
    ) => {
      if (!navigationRef.isReady()) {
        if (attempt > 100) return;
        setTimeout(() => navigateToRoomWhenReady(d, attempt + 1), 100);
        return;
      }
      const senderIdNum = d.senderId != null ? Number(d.senderId) : undefined;
      navigationRef.navigate('ChatRoom', {
        roomId: String(d.roomId),
        roomName: String(d.roomName ?? ''),
        otherUserId: senderIdNum && !Number.isNaN(senderIdNum) ? senderIdNum : undefined,
      });
    };
    const unsubNotifeeMsg = notifee.onForegroundEvent(({ type, detail }) => {
      // Direct-reply action typed on a message notification while the app is
      // foregrounded — relay it the same way the background dispatcher does.
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'reply') {
        import('./src/services/notificationReplyService')
          .then((m) => m.handleMessageReplyEvent({ type, detail }))
          .catch(() => {});
        return;
      }
      if (type !== EventType.PRESS) return;
      const d = detail.notification?.data as Record<string, string> | undefined;
      if (!d || d.type !== 'new_message' || !d.roomId) return;
      navigateToRoomWhenReady(d);
    });

    // Cold start: if the app was launched by tapping a message notification,
    // route straight to the room.
    notifee.getInitialNotification().then((initial) => {
      const d = initial?.notification?.data as Record<string, string> | undefined;
      if (d?.type === 'new_message' && d.roomId) navigateToRoomWhenReady(d);
    }).catch(() => {});

    // Handle notification taps — navigate to the relevant screen and save msg
    responseListener.current = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      console.log('[App] Notification tapped:', data);

      // Save message to SQLite whenever a new_message push is tapped
      if (data?.type === 'new_message') {
        savePushMessage(data).catch(() => {});
      }

      if (!data) return;

      // On a cold launch from a killed app the navigation container isn't ready
      // yet when this fires — retry until it is, otherwise the navigate is a
      // no-op and the user lands on the default (chat list) instead of the room.
      const navigateWhenReady = (run: () => void, attempt = 0) => {
        if (!navigationRef.isReady()) {
          if (attempt > 100) return; // ~10s safety cap
          setTimeout(() => navigateWhenReady(run, attempt + 1), 100);
          return;
        }
        run();
      };

      if (data.type === 'incoming_call') {
        navigateWhenReady(() => {
          navigationRef.navigate('IncomingCall', {
            callId: String(data.callId ?? ''),
            callerName: String(data.callerName ?? 'Unknown'),
            callerId: Number(data.callerId ?? 0),
            callType: (data.callType as 'voice' | 'video') ?? 'voice',
            roomName: String(data.roomName ?? ''),
          });
        });
      } else if (data.type === 'new_message' && data.roomId) {
        const senderIdNum = data.senderId != null ? Number(data.senderId) : undefined;
        navigateWhenReady(() => {
          navigationRef.navigate('ChatRoom', {
            roomId: String(data.roomId),
            roomName: String(data.roomName ?? ''),
            otherUserId: senderIdNum && !Number.isNaN(senderIdNum) ? senderIdNum : undefined,
          });
        });
      }
    });

    // Save message to SQLite when push arrives while app is in background
    // (foreground service / background JS context keeps the app alive)
    receivedListener.current = addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, string> | undefined;
      if (data?.type === 'new_message') {
        savePushMessage(data).catch(() => {});
      }
    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
      if (receivedListener.current) {
        receivedListener.current.remove();
      }
      unsubCallActions();
      unsubFcmForeground();
      unsubNotifeeMsg();
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
                <IncomingCallBanner />
                <ShareIntentBridge />
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
