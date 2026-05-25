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
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { Font, Spacing, Radius } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotificationContext, NotificationPayload } from '../contexts/NotificationContext';
import { playSound } from '../services/soundService';
import ConnectionStatusBar from '../components/ui/ConnectionStatusBar';

// Screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
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

/* ---- Tab icons (emoji-based — swap for a vector icon lib later) ---- */
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const { colors: Colors } = useTheme();
  const icons: Record<string, string> = {
    Chats: '💬',
    Calls: '📞',
    Profile: '👤',
  };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.55 }}>
        {icons[label] ?? '•'}
      </Text>
    </View>
  );
}

/* ---- Bottom Tab Navigator ---- */
function MainTabs() {
  const { colors: Colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: {
          backgroundColor: Colors.headerBg,
          elevation: 0,
          shadowOpacity: 0,
        },
        headerTitleStyle: { ...Font.bold, color: Colors.headerText, fontSize: Font.size.xl },
        headerTintColor: Colors.headerText,
        tabBarStyle: {
          backgroundColor: Colors.tabBarBg,
          borderTopColor: Colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60,
          paddingBottom: 8,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: Font.size.xs, ...Font.semiBold },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Chats" component={ChatListScreen} options={{ headerTitle: 'Axonic' }} />
      <Tab.Screen name="Calls" component={CallsScreen} options={{ headerTitle: 'Calls' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
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
      if (
        payload.event === 'incoming_call' &&
        payload.call_id &&
        payload.call_id !== handled.current
      ) {
        console.log('[IncomingCallListener] incoming_call →', payload.call_id);
        handled.current = payload.call_id;
        navigationRef.navigate('IncomingCall', {
          callId: payload.call_id,
          callerName: payload.caller ?? 'Unknown',
          callerId: payload.caller_id ?? 0,
          callType: payload.call_type ?? 'voice',
          roomName: payload.room_name ?? '',
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
  content: string;
}

function MessageNotificationListener() {
  const { colors: Colors } = useTheme();
  const { subscribe } = useNotificationContext();
  const [toast, setToast] = useState<ToastData | null>(null);
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (payload.event !== 'new_message') return;

      // Don't show if we're already viewing that chat
      if (navigationRef.isReady()) {
        const current = navigationRef.getCurrentRoute();
        const params = current?.params as any;
        if (current?.name === 'ChatRoom' && params?.roomId === payload.room_id) {
          return;
        }
      }

      // Play notification sound
      playSound('message_received');

      // Show toast
      const data: ToastData = {
        roomId: payload.room_id ?? '',
        roomName: payload.room_name ?? payload.sender ?? 'Chat',
        sender: payload.sender ?? 'Unknown',
        content: payload.content ?? '',
      };
      setToast(data);

      // Slide in
      slideAnim.setValue(-120);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();

      // Auto-dismiss after 4 seconds
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => dismiss(), 4000);
    });
    return unsub;
  }, [subscribe]);

  const dismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setToast(null));
  };

  const handlePress = () => {
    if (!toast || !navigationRef.isReady()) return;
    const { roomId, roomName } = toast;
    dismiss();
    navigationRef.navigate('ChatRoom', { roomId, roomName });
  };

  if (!toast) return null;

  return (
    <Animated.View
      style={[toastStyles.container, { transform: [{ translateY: slideAnim }] }]}
    >
      <TouchableOpacity
        style={[toastStyles.inner, { backgroundColor: Colors.primaryDark, shadowColor: Colors.primary }]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <View style={[toastStyles.avatar, { backgroundColor: Colors.primaryLight }]}>
          <Text style={toastStyles.avatarText}>
            {toast.sender.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={toastStyles.textCol}>
          <Text style={[toastStyles.sender, { color: Colors.headerText }]} numberOfLines={1}>
            {toast.sender}
          </Text>
          <Text style={toastStyles.content} numberOfLines={1}>
            {toast.content}
          </Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Text style={toastStyles.close}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ---- Root Navigator ---- */
export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors: Colors, isDark } = useTheme();

  if (isLoading) {
    return (
      <View style={[styles.splash, { backgroundColor: Colors.primary }]}>
        <Text style={styles.splashLogo}>💬</Text>
        <Text style={[styles.splashTitle, { color: Colors.textInverse }]}>Axonic</Text>
        <ActivityIndicator size="large" color={Colors.textInverse} style={{ marginTop: Spacing.lg }} />
      </View>
    );
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
      {isAuthenticated && <ConnectionStatusBar />}
      <NavigationContainer ref={navigationRef} theme={navTheme}>
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
                  headerStyle: { backgroundColor: Colors.headerBg, elevation: 0, shadowOpacity: 0 },
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                }}
              />
              <Stack.Screen
                name="ChatRoom"
                component={ChatRoomScreen}
                options={({ route }) => ({
                  headerShown: true,
                  headerTitle: route.params.roomName,
                  headerStyle: { backgroundColor: Colors.headerBg, elevation: 0, shadowOpacity: 0 },
                  headerTitleStyle: { ...Font.semiBold, color: Colors.headerText },
                  headerTintColor: Colors.headerText,
                })}
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
            </>
          ) : (
            <>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen
                name="Register"
                component={RegisterScreen}
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

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashLogo: { fontSize: 80 },
  splashTitle: { fontSize: Font.size.title, marginTop: Spacing.sm, ...Font.bold },
});

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
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    ...Font.bold,
  },
  textCol: {
    flex: 1,
    marginRight: 8,
  },
  sender: {
    fontSize: Font.size.md,
    ...Font.semiBold,
  },
  content: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: Font.size.sm,
    marginTop: 2,
  },
  close: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    padding: 4,
  },
});
