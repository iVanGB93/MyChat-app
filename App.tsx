import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
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
import { getMessaging, onNotificationOpenedApp, getInitialNotification } from '@react-native-firebase/messaging';
import { ensureMessageChannel } from './src/services/messageNotificationService';
import notifee, { EventType } from '@notifee/react-native';
import { AppLifecycleBridge } from './src/store/AppLifecycleBridge';
import { DebugOverlay } from './src/store/DebugOverlay';
import { ConnectionBanner } from './src/store/ConnectionBanner';
import { IncomingCallBanner } from './src/store/IncomingCallBanner';
import AppUpdateGate from './src/components/AppUpdateGate';
import ShareIntentBridge from './src/store/ShareIntentBridge';
import { savePushMessage } from './src/services/pushMessageStore';
import { takePendingRoomNav } from './src/services/pendingRoomNav';
import { takePendingCallNav } from './src/services/pendingCallNav';
import { markCallEnded, isCallEnded } from './src/services/callDedupe';
import { useAppStore } from './src/store/appStore';

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
        markCallEnded(data.callId);
        endCall(data.callId, 'reject').catch(() => {});
        cancelIncomingCallNotification(data.callId).catch(() => {});
        return;
      }

      // accept / press → open the IncomingCall screen so the existing flow
      // (joinCall, navigate to ActiveCall) handles the rest.
      cancelIncomingCallNotification(data.callId).catch(() => {});

      if (type === 'accept') {
        // Answering ends the "incoming" phase — stop any later transport from
        // re-ringing this call.
        markCallEnded(data.callId);
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
    // is tapped. On a COLD start the `ChatRoom` route only exists once the user
    // is authenticated, so a single navigate would no-op and leave the user on
    // the default screen — we retry until we actually land on the room.
    const navigateToRoomWhenReady = (
      d: Record<string, string>,
      attempt = 0,
    ) => {
      if (attempt > 150) return; // ~30s cap (covers auth loading on cold start)
      if (!navigationRef.isReady()) {
        setTimeout(() => navigateToRoomWhenReady(d, attempt + 1), 200);
        return;
      }
      const senderIdNum = d.senderId != null ? Number(d.senderId) : undefined;
      navigationRef.navigate('ChatRoom', {
        roomId: String(d.roomId),
        roomName: String(d.roomName ?? ''),
        otherUserId: senderIdNum && !Number.isNaN(senderIdNum) ? senderIdNum : undefined,
      });
      // The navigate above is a no-op until the authed stack (with ChatRoom) is
      // mounted. Keep retrying until the current route is actually the room.
      const current = navigationRef.getCurrentRoute();
      if (current?.name !== 'ChatRoom') {
        setTimeout(() => navigateToRoomWhenReady(d, attempt + 1), 200);
      }
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
      // "Mark as read" action — dismiss + send read receipts to the sender.
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'mark_read') {
        import('./src/services/notificationActionService')
          .then((m) => m.handleMarkReadEvent({ type, detail }))
          .catch(() => {});
        return;
      }
      if (type !== EventType.PRESS) return;
      const d = detail.notification?.data as Record<string, string> | undefined;
      console.log('[Notif] foreground PRESS', { type: d?.type, roomId: d?.roomId });
      if (!d || d.type !== 'new_message' || !d.roomId) return;
      navigateToRoomWhenReady(d);
    });

    // Cold start: if the app was launched by tapping a message notification,
    // route straight to the room.
    notifee.getInitialNotification().then((initial) => {
      const d = initial?.notification?.data as Record<string, string> | undefined;
      console.log('[Notif] getInitialNotification', { type: d?.type, roomId: d?.roomId });
      if (d?.type === 'new_message' && d.roomId) navigateToRoomWhenReady(d);
    }).catch(() => {});

    // A message notification pressed while BACKGROUNDED is delivered to the
    // background handler, which stashes the target. Consume it now (on mount)
    // and whenever the app returns to the foreground, then navigate.
    const consumePendingNav = () => {
      const pending = takePendingRoomNav();
      if (pending?.roomId) {
        console.log('[Notif] consuming pending nav →', pending.roomId);
        navigateToRoomWhenReady({
          type: 'new_message',
          roomId: pending.roomId,
          roomName: pending.roomName ?? '',
          ...(pending.senderId ? { senderId: pending.senderId } : {}),
        });
      }
    };
    // A call that arrived while backgrounded/killed launches the app via the
    // full-screen intent. Navigate straight to the full-screen IncomingCall
    // screen so it takes over instead of leaving a heads-up banner.
    const consumePendingCall = () => {
      const call = takePendingCallNav();
      if (!call?.callId) return;
      if (isCallEnded(call.callId)) return;
      console.log('[Notif] consuming pending call →', call.callId);
      const run = (attempt = 0) => {
        if (!navigationRef.isReady()) {
          if (attempt > 100) return;
          setTimeout(() => run(attempt + 1), 100);
          return;
        }
        const cur = useAppStore.getState().activeCall;
        if (cur && cur.callId === call.callId && cur.state !== 'ended') return;
        navigationRef.navigate('IncomingCall', {
          callId: call.callId,
          callerName: call.callerName,
          callerId: call.callerId,
          callType: call.callType,
          roomName: call.roomName,
        });
      };
      run();
    };
    consumePendingNav();
    consumePendingCall();
    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        consumePendingNav();
        consumePendingCall();
      }
    });

    // FCM notification taps (hybrid push backup floor). When the app is
    // killed/backgrounded the OS renders the FCM `notification` block directly;
    // tapping it is delivered HERE (not via the Expo/Notifee listeners), so we
    // ingest the message and navigate the same way. `data` carries both
    // camelCase and snake_case keys from the backend.
    const handleFcmOpen = (remoteMessage: any) => {
      const data = (remoteMessage?.data ?? {}) as Record<string, string>;
      if (!data || !data.type) return;
      if (data.type === 'new_message') {
        savePushMessage(data).catch(() => {});
        const roomId = data.roomId ?? data.room_id;
        if (roomId) {
          navigateToRoomWhenReady({
            ...data,
            roomId: String(roomId),
            roomName: String(data.roomName ?? data.room_name ?? ''),
            senderId: String(data.senderId ?? data.sender_id ?? ''),
          });
        }
      } else if (data.type === 'incoming_call') {
        const navCall = (attempt = 0) => {
          if (!navigationRef.isReady()) {
            if (attempt > 100) return;
            setTimeout(() => navCall(attempt + 1), 100);
            return;
          }
          navigationRef.navigate('IncomingCall', {
            callId: String(data.callId ?? data.call_id ?? ''),
            callerName: String(data.callerName ?? data.caller_name ?? 'Unknown'),
            callerId: Number(data.callerId ?? data.caller_id ?? 0),
            callType: (data.callType as 'voice' | 'video') ?? 'voice',
            roomName: String(data.roomName ?? data.room_name ?? ''),
          });
        };
        navCall();
      }
    };
    // Background → foreground tap.
    const unsubFcmOpened = onNotificationOpenedApp(getMessaging(), handleFcmOpen);
    // Cold start from a fully quit state.
    getInitialNotification(getMessaging()).then((m) => { if (m) handleFcmOpen(m); }).catch(() => {});

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
      unsubFcmOpened();
      appStateSub.remove();
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
                <AppUpdateGate />
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
