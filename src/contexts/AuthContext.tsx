/* ------------------------------------------------------------------ */
/*  Auth context — provides user state & auth actions across the app   */
/* ------------------------------------------------------------------ */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTokens, getTokens } from '../services/api';
import { getProfile, login as loginApi, register as registerApi, registerPushToken, unregisterPushToken } from '../services/authService';
import { getPushRegistrationPayload } from '../services/pushNotificationService';
import { onFcmTokenRefresh } from '../services/fcmService';
import {
  registerBackgroundTask,
  registerPushReceiveTask,
  unregisterBackgroundTask,
  unregisterPushReceiveTask,
} from '../services/backgroundNotificationService';
import { destroyWsManager } from '../services/notificationWsManager';
import { subscribeSessionInvalidation } from '../services/sessionInvalidation';
import { setCurrentUserId } from '../services/chatWsManager';
import { cacheContacts, cacheRelationshipSets, getCachedRelationshipSets, initDB } from '../services/localMessageStore';
import { getContacts, getBlockedUsers } from '../services/contactService';
import { useAppStore } from '../store/appStore';
import type { User } from '../types';

const USER_CACHE_KEY = '@axonic_user_cache';
const PUSH_SYNC_FRESH_MS = 6 * 60 * 60 * 1000;
const PUSH_SYNC_RETRY_DELAYS_MS = [0, 1_500, 5_000, 15_000] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthFailure(err: any): boolean {
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

async function getCachedUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

async function setCachedUser(user: User | null): Promise<void> {
  if (!user) {
    await AsyncStorage.removeItem(USER_CACHE_KEY);
    return;
  }
  await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName?: string) => Promise<void>;
  /**
   * Adopt a token pair that was minted server-side (e.g. by the
   * email-verification flow) and hydrate the authenticated state from
   * the profile endpoint.
   */
  loginWithTokens: () => Promise<void>;
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
  const pushSyncInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastPushSyncSuccessAtRef = useRef(0);

  // Mirror auth state into the global app store on every change.
  useEffect(() => {
    const store = useAppStore.getState();
    store.setUser(state.user);
    store.setAuthLoading(state.isLoading);
  }, [state.user, state.isLoading]);

  /** Register push token with backend after authentication */
  const syncPushToken = useCallback(async (force = false): Promise<boolean> => {
    if (!force && Date.now() - lastPushSyncSuccessAtRef.current < PUSH_SYNC_FRESH_MS) {
      return true;
    }
    if (pushSyncInFlightRef.current) return pushSyncInFlightRef.current;

    const task = (async () => {
      let payload: Awaited<ReturnType<typeof getPushRegistrationPayload>>;
      try {
        payload = await getPushRegistrationPayload();
      } catch (err) {
        console.warn('[Auth] push registration payload failed:', err);
        return false;
      }
      if (!payload) return false;

      for (let attempt = 0; attempt < PUSH_SYNC_RETRY_DELAYS_MS.length; attempt += 1) {
        const delay = PUSH_SYNC_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await wait(delay);
        if (await registerPushToken(payload)) {
          lastPushSyncSuccessAtRef.current = Date.now();
          return true;
        }
        if (attempt < PUSH_SYNC_RETRY_DELAYS_MS.length - 1) {
          console.log('[Auth] retrying push token registration', {
            attempt: attempt + 2,
            delay_ms: PUSH_SYNC_RETRY_DELAYS_MS[attempt + 1],
          });
        }
      }
      return false;
    })();

    pushSyncInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (pushSyncInFlightRef.current === task) pushSyncInFlightRef.current = null;
    }
  }, []);

  /** Load the last known state first so request banners are correct offline. */
  const loadCachedContactSets = useCallback(async (ownerUserId: number) => {
    try {
      const cached = await getCachedRelationshipSets(ownerUserId);
      const store = useAppStore.getState();
      store.setContactIds(cached.contactIds);
      store.setBlockedIds(cached.blockedIds);
    } catch (err) {
      console.warn('[Auth] cached relationship load failed:', err);
    }
  }, []);

  // FCM tokens can rotate without a logout or app update. Keep the current
  // installation row authoritative instead of waiting until the next launch.
  useEffect(() => {
    if (!state.isAuthenticated) return;
    return onFcmTokenRefresh(() => {
      console.log('[FCM] token refreshed — registering current installation');
      void syncPushToken(true);
    });
  }, [state.isAuthenticated, syncPushToken]);

  // A transient failure during startup must not leave this installation with
  // a stale server-side token until the next full app launch. Retry on the
  // next foreground transition, while the success timestamp prevents routine
  // app switching from generating unnecessary backend requests.
  useEffect(() => {
    if (!state.isAuthenticated) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void syncPushToken();
    });
    return () => sub.remove();
  }, [state.isAuthenticated, syncPushToken]);

  /** Background task registration is removed on logout. Re-install it after a
   * successful login in the same running process, otherwise a later account
   * would receive pushes but have no headless persistence/notification path. */
  const ensureBackgroundServices = useCallback(() => {
    registerBackgroundTask().catch(() => {});
    registerPushReceiveTask().catch(() => {});
  }, []);

  /** Refresh contact and blocked-user sets without wiping valid cache on a
   * transient network error. A successful pair is committed to SQLite. */
  const syncContactSets = useCallback(async (ownerUserId: number) => {
    try {
      const [contactsResult, blockedResult] = await Promise.allSettled([getContacts(), getBlockedUsers()]);
      const store = useAppStore.getState();
      const contacts = contactsResult.status === 'fulfilled' ? contactsResult.value : null;
      const blocked = blockedResult.status === 'fulfilled' ? blockedResult.value : null;
      if (contacts) store.setContactIds(contacts.map((c) => c.contact));
      if (blocked) store.setBlockedIds(blocked.map((b) => b.blocked));
      if (contacts) await cacheContacts(ownerUserId, contacts);
      if (contacts && blocked) {
        await cacheRelationshipSets(ownerUserId, contacts.map((c) => c.contact), blocked.map((b) => b.blocked));
      }
    } catch (err) {
      console.warn('[Auth] contact set sync failed:', err);
    }
  }, []);

  // Relationship changes made from another device should be reflected soon
  // after this app returns to the foreground, while still leaving cached state
  // visible if the network is unavailable.
  useEffect(() => {
    if (!state.user?.id) return;
    const ownerUserId = state.user.id;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncContactSets(ownerUserId);
    });
    return () => sub.remove();
  }, [state.user?.id, syncContactSets]);

  // Try to restore session on mount
  useEffect(() => {
    (async () => {
      await initDB().catch(() => {});
      try {
        const tokens = await getTokens();
        if (tokens?.access) {
          const cachedUser = await getCachedUser();
          if (cachedUser) {
            setCurrentUserId(cachedUser.id, cachedUser.username);
            setState({ user: cachedUser, isLoading: false, isAuthenticated: true });
            loadCachedContactSets(cachedUser.id);
            ensureBackgroundServices();
          }
          try {
            const user = await getProfile();
            await setCachedUser(user);
            setCurrentUserId(user.id, user.username);
            setState({ user, isLoading: false, isAuthenticated: true });
            loadCachedContactSets(user.id);
            // Register push token with backend on session restore
            syncPushToken(true);
            ensureBackgroundServices();
            syncContactSets(user.id);
          } catch (err) {
            if (cachedUser && !isAuthFailure(err)) {
              // Keep user logged in with cached profile on transient failures.
              setState({ user: cachedUser, isLoading: false, isAuthenticated: true });
              syncPushToken(true);
              syncContactSets(cachedUser.id);
            } else {
              await clearTokens();
              await setCachedUser(null);
              setState({ user: null, isLoading: false, isAuthenticated: false });
            }
          }
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        // Do not clear persisted auth on generic startup errors.
        // If a cached user exists, keep the session and retry lazily later.
        const cachedUser = await getCachedUser();
        if (cachedUser) {
          setCurrentUserId(cachedUser.id, cachedUser.username);
          setState({ user: cachedUser, isLoading: false, isAuthenticated: true });
        } else {
          await clearTokens();
          await setCachedUser(null);
          setState({ user: null, isLoading: false, isAuthenticated: false });
        }
      }
    })();
  }, [ensureBackgroundServices, loadCachedContactSets, syncPushToken, syncContactSets]);

  const login = useCallback(async (username: string, password: string) => {
    await loginApi(username, password);
    const user = await getProfile();
    await setCachedUser(user);
    setCurrentUserId(user.id, user.username);
    setState({ user, isLoading: false, isAuthenticated: true });
    loadCachedContactSets(user.id);
    // Register push token with backend after login
    syncPushToken(true);
    ensureBackgroundServices();
    syncContactSets(user.id);
  }, [ensureBackgroundServices, loadCachedContactSets, syncPushToken, syncContactSets]);

  const register = useCallback(async (username: string, email: string, password: string, displayName?: string) => {
    await registerApi(username, email, password, displayName);
    await loginApi(username, password);
    const user = await getProfile();
    await setCachedUser(user);
    setCurrentUserId(user.id, user.username);
    setState({ user, isLoading: false, isAuthenticated: true });
    loadCachedContactSets(user.id);
    // Register push token with backend after registration
    syncPushToken(true);
    ensureBackgroundServices();
    syncContactSets(user.id);
  }, [ensureBackgroundServices, loadCachedContactSets, syncPushToken, syncContactSets]);

  const logout = useCallback(async () => {
    destroyWsManager();
    await unregisterPushToken();
    lastPushSyncSuccessAtRef.current = 0;
    await clearTokens();
    await setCachedUser(null);
    await unregisterBackgroundTask();
    await unregisterPushReceiveTask();
    setState({ user: null, isLoading: false, isAuthenticated: false });
    useAppStore.getState().reset();
  }, []);

  // A rejected refresh token is an authentication state, not a transient
  // socket error. Transport modules report it here so the app cleanly returns
  // to login rather than retrying WebSocket authentication forever.
  useEffect(() => subscribeSessionInvalidation(() => {
    logout().catch(() => {});
  }), [logout]);

  const refreshUser = useCallback(async () => {
    try {
      const user = await getProfile();
      await setCachedUser(user);
      setState((s) => ({ ...s, user }));
    } catch { /* ignore */ }
  }, []);

  /** Hydrate auth state from tokens already persisted (e.g. by the
   *  email-verification verify call which returns and saves a fresh
   *  access/refresh pair). */
  const loginWithTokens = useCallback(async () => {
    const user = await getProfile();
    await setCachedUser(user);
    setCurrentUserId(user.id, user.username);
    setState({ user, isLoading: false, isAuthenticated: true });
    loadCachedContactSets(user.id);
    syncPushToken(true);
    ensureBackgroundServices();
    syncContactSets(user.id);
  }, [ensureBackgroundServices, loadCachedContactSets, syncPushToken, syncContactSets]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, loginWithTokens, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
