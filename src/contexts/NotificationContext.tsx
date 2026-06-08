/* ------------------------------------------------------------------ */
/*  Notification Context — thin React wrapper around the singleton     */
/*  WebSocket manager (notificationWsManager).                         */
/*                                                                     */
/*  The actual WS lives in a module-level singleton so it survives     */
/*  React unmounts (e.g. when the Activity is swiped away but the     */
/*  foreground service keeps the process alive).                       */
/* ------------------------------------------------------------------ */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { useAuth } from './AuthContext';
import { checkPendingNotifications } from '../services/backgroundNotificationService';
import { startForegroundService, stopForegroundService } from '../services/foregroundService';
import {
  initWsManager,
  destroyWsManager,
  subscribeEvents,
  subscribeStatus,
  sendWsSignal,
  reconnectWsNow,
  type ConnectionStatus,
  type NotificationPayload,
} from '../services/notificationWsManager';
import { useAppStore, selectNotifWsConnected } from '../store/appStore';

type Listener = (payload: NotificationPayload) => void;

interface NotificationContextType {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  reconnectAttempt: number;
  sendSignal: (targetUserId: number, signalType: string, data: any) => void;
  subscribe: (fn: Listener) => () => void;
  reconnectNow: () => void;
}

const NotificationContext = createContext<NotificationContextType>({
  connected: false,
  connectionStatus: 'disconnected',
  reconnectAttempt: 0,
  sendSignal: () => {},
  subscribe: () => () => {},
  reconnectNow: () => {},
});

export type { ConnectionStatus, NotificationPayload };

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const connected = useAppStore(selectNotifWsConnected);

  /* ---- Init / destroy WS manager based on auth ---- */
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      initWsManager(user.id);
      startForegroundService();
    } else {
      destroyWsManager();
      stopForegroundService();
    }
    // NOTE: NO cleanup that destroys the WS — we want it to survive unmounts.
    // destroyWsManager is only called when isAuthenticated becomes false (logout).
  }, [isAuthenticated, user?.id]);

  /* ---- Subscribe to status changes from the singleton ---- */
  useEffect(() => {
    const unsub = subscribeStatus((status) => {
      setConnectionStatus(status);
    });
    return unsub;
  }, []);

  /* ---- Check pending notifications when opening the app ---- */
  useEffect(() => {
    if (isAuthenticated) {
      checkPendingNotifications().catch(() => {});
    }
  }, [isAuthenticated]);

  /* ---- Expose subscribe / sendSignal from the singleton ---- */
  const subscribe = useCallback((fn: Listener) => {
    return subscribeEvents(fn);
  }, []);

  const sendSignal = useCallback(
    (targetUserId: number, signalType: string, data: any) => {
      sendWsSignal(targetUserId, signalType, data);
    },
    [],
  );

  const reconnectNow = useCallback(() => {
    reconnectWsNow();
  }, []);

  return (
    <NotificationContext.Provider
      value={{ connected, connectionStatus, reconnectAttempt: 0, sendSignal, subscribe, reconnectNow }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext() {
  return useContext(NotificationContext);
}
