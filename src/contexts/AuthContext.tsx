/* ------------------------------------------------------------------ */
/*  Auth context — provides user state & auth actions across the app   */
/* ------------------------------------------------------------------ */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { clearTokens, getTokens } from '../services/api';
import { getProfile, login as loginApi, register as registerApi, registerPushToken } from '../services/authService';
import { registerForPushNotifications } from '../services/pushNotificationService';
import { unregisterBackgroundTask } from '../services/backgroundNotificationService';
import { stopForegroundService } from '../services/foregroundService';
import { destroyWsManager } from '../services/notificationWsManager';
import { setCurrentUserId } from '../services/chatWsManager';
import { initDB } from '../services/localMessageStore';
import { useAppStore } from '../store/appStore';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Mirror auth state into the global app store on every change.
  useEffect(() => {
    const store = useAppStore.getState();
    store.setUser(state.user);
    store.setAuthLoading(state.isLoading);
  }, [state.user, state.isLoading]);

  /** Register push token with backend after authentication */
  const syncPushToken = useCallback(async () => {
    try {
      const token = await registerForPushNotifications();
      if (token) {
        await registerPushToken(token);
      }
    } catch (err) {
      console.warn('[Auth] push token sync failed:', err);
    }
  }, []);

  // Try to restore session on mount
  useEffect(() => {
    (async () => {
      initDB().catch(() => {}); // ensure DB is ready
      try {
        const tokens = await getTokens();
        if (tokens?.access) {
          const user = await getProfile();
          setCurrentUserId(user.id, user.username);
          setState({ user, isLoading: false, isAuthenticated: true });
          // Register push token with backend on session restore
          syncPushToken();
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        await clearTokens();
        setState({ user: null, isLoading: false, isAuthenticated: false });
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await loginApi(username, password);
    const user = await getProfile();
    setCurrentUserId(user.id, user.username);
    setState({ user, isLoading: false, isAuthenticated: true });
    // Register push token with backend after login
    syncPushToken();
  }, [syncPushToken]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    await registerApi(username, email, password);
    await loginApi(username, password);
    const user = await getProfile();
    setCurrentUserId(user.id, user.username);
    setState({ user, isLoading: false, isAuthenticated: true });
    // Register push token with backend after registration
    syncPushToken();
  }, [syncPushToken]);

  const logout = useCallback(async () => {
    destroyWsManager();
    await stopForegroundService();
    await clearTokens();
    await unregisterBackgroundTask();
    setState({ user: null, isLoading: false, isAuthenticated: false });
    useAppStore.getState().reset();
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await getProfile();
      setState((s) => ({ ...s, user }));
    } catch { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
