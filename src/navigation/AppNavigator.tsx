/* ------------------------------------------------------------------ */
/*  Navigation — Auth stack  +  Main bottom tabs  +  Chat room stack   */
/*  Modern purple theme, incoming call & message listeners             */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef, useState } from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { Font, Spacing, Radius } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotificationContext, NotificationPayload } from '../contexts/NotificationContext';
import { playSound } from '../services/soundService';
import { useAppStore } from '../store/appStore';
import { isCallEnded } from '../services/callDedupe';
import { shouldHandleIncomingCallInApp, shouldShowInAppMessageToast } from '../services/notificationPresentationPolicy';
import { decideIncomingCallInApp, decideInAppMessageToast } from '../services/notificationPresentationPolicy';
import { markAppInteractive } from '../services/observability';
import { debugLog } from '../services/diagnostics';
import StartupScreen from '../components/startup-screen';

// Screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import VerifyPasswordResetScreen from '../screens/auth/VerifyPasswordResetScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import ChatListScreen from '../screens/chat/ChatListScreen';
import ChatRoomScreen from '../screens/chat/ChatRoomScreen';
import CallsScreen from '../screens/calls/CallsScreen';
import IncomingCallScreen from '../screens/calls/IncomingCallScreen';
import ActiveCallScreen from '../screens/calls/ActiveCallScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

import type { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/* ---- Tab icons ---- */
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const { colors: Colors } = useTheme();
  // Outline when inactive, filled when focused — matches the rest of the UI
  // and feels closer to the cyberpunk "glowing line" aesthetic.
  const iconMap: Record<string, [React.ComponentProps<typeof Ionicons>['name'], React.ComponentProps<typeof Ionicons>['name']]> = {
    Chats:   ['chatbubble-ellipses-outline', 'chatbubble-ellipses'],
    Calls:   ['call-outline',                'call'],
    Profile: ['person-outline',              'person'],
  };
  const [outline, filled] = iconMap[label] ?? ['ellipse-outline', 'ellipse'];
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons
        name={focused ? filled : outline}
        size={24}
        color={focused ? Colors.primary : Colors.textTertiary}
        style={{
          opacity: focused ? 1 : 0.7,
          transform: [{ scale: focused ? 1.05 : 1 }],
        }}
      />
    </View>
  );
}

/* ---- Bottom Tab Navigator ---- */
function MainTabs() {
  const { colors: Colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: {
          backgroundColor: Colors.headerBg,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: Colors.neonBorder,
        },
        headerTitleStyle: { fontWeight: '800', letterSpacing: 3, color: Colors.primary, fontSize: Font.size.lg },
        headerTintColor: Colors.primary,
        tabBarStyle: {
          backgroundColor: Colors.tabBarBg,
          borderTopColor: Colors.neonBorder,
          borderTopWidth: 1,
          // Grow the bar to host the system nav inset (3-button bar on
          // Android, home indicator on iOS) so labels/icons aren't
          // covered by the OS bar on devices without gesture nav.
          height: 62 + insets.bottom,
          paddingBottom: 10 + insets.bottom,
          paddingTop: 6,
          elevation: 12,
          shadowColor: Colors.primary,
          shadowOpacity: 0.15,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1 },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Chats" component={ChatListScreen} options={{ headerTitle: 'AXONIC' }} />
      <Tab.Screen name="Calls" component={CallsScreen} options={{ headerTitle: 'CALLS' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ headerTitle: 'PROFILE' }} />
    </Tab.Navigator>
  );
}

/* ---- Incoming call listener (active only when authenticated) ---- */
function IncomingCallListener() {
  const { subscribe } = useNotificationContext();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (!navigationRef.isReady()) return;
      const store = useAppStore.getState();
      const incomingDecision = decideIncomingCallInApp(payload, store);
      if (payload.event === 'incoming_call') {
        debugLog('[NotifPolicy] in_app_call', {
          allow: incomingDecision.allow,
          reason: incomingDecision.reason,
          call_id: String(payload.call_id ?? ''),
        });
      }
      if (!shouldHandleIncomingCallInApp(payload, store)) return;
      if (
        payload.event === 'incoming_call' &&
        payload.call_id &&
        payload.call_id !== handled.current
      ) {
        // Never re-open the incoming-call screen for a call the user already
        // declined / answered / that ended (a later transport may re-deliver).
        if (isCallEnded(payload.call_id)) return;
        const cur = useAppStore.getState().activeCall;
        if (cur && cur.callId === payload.call_id && cur.state !== 'ended') {
          return;
        }
        debugLog('[IncomingCallListener] incoming_call →', payload.call_id);
        handled.current = payload.call_id;

        const callerName = payload.caller ?? 'Unknown';
        const callerId = payload.caller_id ?? 0;
        const callType = payload.call_type ?? 'voice';
        const roomName = payload.room_name ?? '';

        // If we're already on an active call, surface the new incoming call
        // as an in-app banner instead of taking over the screen.
        const busy = !!cur && (cur.state === 'connected' || cur.state === 'connecting');
        if (busy) {
          useAppStore.getState().setIncomingCall({
            callId: payload.call_id,
            callerId,
            callerName,
            callType,
            roomName,
          });
          return;
        }

        navigationRef.navigate('IncomingCall', {
          callId: payload.call_id,
          callerName,
          callerId,
          callType,
          roomName,
        });
      }
    });
    return unsub;
  }, [subscribe]);

  return null;
}

/* ---- In-app message notification toast ---- */
interface ToastData {
  roomId: string;
  roomName: string;
  sender: string;
  senderId?: number;
  content: string;
  /** Number of notifications grouped into this toast from the same sender. */
  count: number;
}

function MessageNotificationListener() {
  const { colors: Colors } = useTheme();
  const { subscribe } = useNotificationContext();
  const [toast, setToast] = useState<ToastData | null>(null);
  // Ref mirrors state so the subscribe closure never goes stale
  const toastRef = useRef<ToastData | null>(null);
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateToast = (data: ToastData) => {
    toastRef.current = data;
    setToast(data);
  };

  const dismiss = () => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      toastRef.current = null;
      setToast(null);
    });
  };

  useEffect(() => {
    const unsub = subscribe((payload) => {
      // ── Helper: fresh slide-in toast ──────────────────────────────────
      const showToast = (data: ToastData) => {
        updateToast(data);
        slideAnim.setValue(-120);
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => dismiss(), 4000);
      };

      // ── Helper: group into existing toast (same sender, same room) ────
      const groupOrShow = (data: Omit<ToastData, 'count'>) => {
        const cur = toastRef.current;
        if (cur && cur.roomId === data.roomId && cur.sender === data.sender) {
          // Same sender already visible — update content + bump count, reset timer
          const updated: ToastData = { ...cur, content: data.content, count: cur.count + 1 };
          updateToast(updated);
          if (dismissTimer.current) clearTimeout(dismissTimer.current);
          dismissTimer.current = setTimeout(() => dismiss(), 4000);
        } else {
          showToast({ ...data, count: 1 });
        }
      };

      // ── New message ───────────────────────────────────────────────────
      if (payload.event === 'new_message') {
        const store = useAppStore.getState();
        const toastDecision = decideInAppMessageToast(payload, store);
        debugLog('[NotifPolicy] in_app_message', {
          allow: toastDecision.allow,
          reason: toastDecision.reason,
          room_id: String(payload.room_id ?? ''),
          message_id: String(payload.message_id ?? ''),
        });
        if (!shouldShowInAppMessageToast(payload, store)) return;
        playSound('message_received');
        groupOrShow({
          roomId:   payload.room_id ?? '',
          roomName: payload.room_name ?? payload.sender ?? 'Chat',
          sender:   payload.sender ?? 'Unknown',
          senderId: typeof payload.sender_id === 'number' ? payload.sender_id : undefined,
          content:  payload.content ?? '',
        });
        return;
      }

      // ── Message update (reaction / delete / edit) ─────────────────────
      if (payload.event === 'message_update' && payload.from_username) {
        const store = useAppStore.getState();
        const toastDecision = decideInAppMessageToast(payload, store);
        debugLog('[NotifPolicy] in_app_message_update', {
          allow: toastDecision.allow,
          reason: toastDecision.reason,
          room_id: String(payload.room_id ?? ''),
        });
        if (!shouldShowInAppMessageToast(payload, store)) return;
        const updates: Array<{ message_id: string; changes: Record<string, any> }> =
          (payload as any).updates ?? [];
        let summary = '';
        for (const u of updates) {
          if (u.changes.reacted_emoji) { summary = `reacted ${u.changes.reacted_emoji}`; break; }
          if (u.changes.is_deleted)    { summary = 'deleted a message';                  break; }
          if (u.changes.content)       { summary = 'edited a message';                   break; }
        }
        if (!summary) return; // is_read only — no banner needed
        groupOrShow({
          roomId:   payload.room_id ?? '',
          roomName: payload.room_name ?? String(payload.from_username),
          sender:   String(payload.from_username),
          content:  summary,
        });
        return;
      }
    });
    return unsub;
  }, [subscribe]);

  const handlePress = () => {
    if (!toast || !navigationRef.isReady()) return;
    const { roomId, roomName, senderId } = toast;
    dismiss();
    navigationRef.navigate('ChatRoom', { roomId, roomName, otherUserId: senderId });
  };

  if (!toast) return null;

  return (
    <Animated.View
      style={[toastStyles.container, { transform: [{ translateY: slideAnim }] }]}
    >
      <TouchableOpacity
        style={[toastStyles.inner, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder, shadowColor: Colors.primary }]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <View style={[toastStyles.avatar, { backgroundColor: Colors.highlight, borderColor: Colors.primary }]}>
          <Text style={[toastStyles.avatarText, { color: Colors.primary }]}>
            {toast.sender.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={toastStyles.textCol}>
          <Text style={[toastStyles.sender, { color: Colors.primary }]} numberOfLines={1}>
            {toast.sender}
            {toast.count > 1 && (
              <Text style={{ color: Colors.textTertiary, fontWeight: '400' }}>
                {' '}· {toast.count} notifications
              </Text>
            )}
          </Text>
          <Text style={[toastStyles.content, { color: Colors.textSecondary }]} numberOfLines={1}>
            {toast.content}
          </Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Text style={[toastStyles.close, { color: Colors.textTertiary }]}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ---- Root Navigator ---- */
export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors: Colors, isDark } = useTheme();

  useEffect(() => {
    if (!isLoading) markAppInteractive(isAuthenticated);
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    return <StartupScreen />;
  }

  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    dark: isDark,
    colors: {
      ...baseTheme.colors,
      primary: Colors.primary,
      background: Colors.background,
      card: Colors.surface,
      text: Colors.text,
      border: Colors.border,
      notification: Colors.primary,
    },
  };

  return (
    <>
      {isAuthenticated && <IncomingCallListener />}
      <NavigationContainer
        ref={navigationRef}
        theme={navTheme}
        linking={{
          // Custom URL scheme declared in app.json (`scheme: "axonic"`).
          // Supported deep links:
          //   axonic://add/<user_tag>   → Contacts screen with the tag pre-filled
          prefixes: ['axonic://'],
          config: {
            screens: {
              Contacts: {
                path: 'add/:prefillTag',
                parse: { prefillTag: (t: string) => t.toUpperCase() },
              },
            },
          },
        }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {isAuthenticated ? (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen
                name="Contacts"
                component={require('../screens/contacts/ContactsScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'New Chat',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="ScanTag"
                component={require('../screens/contacts/ScanTagScreen').default}
                options={{ headerShown: false, presentation: 'fullScreenModal' }}
              />
              <Stack.Screen
                name="ChatRoom"
                component={ChatRoomScreen}
                options={({ route }) => ({
                  headerShown: true,
                  headerTitle: route.params.roomName,
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                })}
              />
              <Stack.Screen
                name="EditAccount"
                component={require('../screens/profile/EditAccountScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Edit account',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="GroupCreate"
                component={require('../screens/chat/GroupCreateScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'New group',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="GroupInfo"
                component={require('../screens/chat/GroupInfoScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Group info',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="UserInfo"
                component={require('../screens/chat/user-info-screen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Contact info',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="ChatStorage"
                component={require('../screens/profile/ChatStorageScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Chat storage',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="ChatStorageMedia"
                component={require('../screens/profile/ChatStorageMediaScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Chat media',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="ChangePassword"
                component={require('../screens/profile/ChangePasswordScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Change password',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="BlockedUsers"
                component={require('../screens/profile/BlockedUsersScreen').default}
                options={{
                  headerShown: true,
                  headerTitle: 'Blocked users',
                  headerStyle: { backgroundColor: Colors.headerBg },
                  headerShadowVisible: false,
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="IncomingCall"
                component={IncomingCallScreen}
                options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
              />
              <Stack.Screen
                name="ActiveCall"
                component={ActiveCallScreen}
                options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
              />
              <Stack.Screen
                name="ShareTarget"
                component={require('../screens/chat/ShareTargetScreen').default}
                options={{ headerShown: false, presentation: 'modal' }}
              />
            </>
          ) : (
            <>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen
                name="Register"
                component={RegisterScreen}
                options={{ headerShown: true, headerTitle: '', headerTransparent: true, headerTintColor: Colors.primary }}
              />
              <Stack.Screen
                name="VerifyEmail"
                component={VerifyEmailScreen}
                options={{ headerShown: true, headerTitle: '', headerTransparent: true, headerTintColor: Colors.primary }}
              />
              <Stack.Screen
                name="ForgotPassword"
                component={ForgotPasswordScreen}
                options={{ headerShown: true, headerTitle: '', headerTransparent: true, headerTintColor: Colors.primary }}
              />
              <Stack.Screen
                name="VerifyPasswordReset"
                component={VerifyPasswordResetScreen}
                options={{ headerShown: true, headerTitle: '', headerTransparent: true, headerTintColor: Colors.primary }}
              />
              <Stack.Screen
                name="ResetPassword"
                component={ResetPasswordScreen}
                options={{ headerShown: true, headerTitle: '', headerTransparent: true, headerTintColor: Colors.primary }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {isAuthenticated && <MessageNotificationListener />}
    </>
  );
}

const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 10,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textCol: {
    flex: 1,
    marginRight: 8,
  },
  sender: {
    fontSize: Font.size.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    fontSize: Font.size.sm,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  close: {
    fontSize: 14,
    padding: 4,
  },
});
