/* ------------------------------------------------------------------ */
/*  AppLifecycleBridge                                                 */
/*                                                                     */
/*  Mounts once at the root of the app and mirrors React Native's      */
/*  AppState (foreground/background) and NetInfo (online/offline)      */
/*  into the global Zustand store.                                     */
/*                                                                     */
/*  This component renders nothing — it is a pure side-effect bridge.  */
/* ------------------------------------------------------------------ */

import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { useAppStore, AppLifecycle, selectTotalUnread } from '../store/appStore';

function toLifecycle(s: AppStateStatus): AppLifecycle {
  if (s === 'active') return 'active';
  if (s === 'background') return 'background';
  if (s === 'inactive') return 'inactive';
  return 'unknown';
}

export function AppLifecycleBridge() {
  // Sync the OS app-icon badge with the total unread count from the store.
  // Subscribes outside React's render cycle so updates fire instantly,
  // and de-dupes by only writing when the value actually changes.
  const totalUnread = useAppStore(selectTotalUnread);
  useEffect(() => {
    Notifications.setBadgeCountAsync(totalUnread).catch(() => {});
  }, [totalUnread]);

  useEffect(() => {
    const store = useAppStore.getState();

    // Seed initial values
    store.setAppLifecycle(toLifecycle(AppState.currentState));

    // AppState subscription
    const sub = AppState.addEventListener('change', (next) => {
      useAppStore.getState().setAppLifecycle(toLifecycle(next));
    });

    // NetInfo subscription
    const unsubNet = NetInfo.addEventListener((state) => {
      const next = state.isConnected === false
        ? 'offline'
        : state.isConnected === true
          ? 'online'
          : 'unknown';
      useAppStore.getState().setNet(next);
    });

    // Prime NetInfo with current value
    NetInfo.fetch().then((state) => {
      const next = state.isConnected === false
        ? 'offline'
        : state.isConnected === true
          ? 'online'
          : 'unknown';
      useAppStore.getState().setNet(next);
    }).catch(() => {});

    // Prune expired typing entries every 2s so stuck indicators self-clear
    // even if the peer's "stop" message is lost.
    const typingPruneTimer = setInterval(() => {
      useAppStore.getState().pruneExpiredTyping();
    }, 2000);

    return () => {
      sub.remove();
      unsubNet();
      clearInterval(typingPruneTimer);
    };
  }, []);

  return null;
}
