/* ------------------------------------------------------------------ */
/*  Global App Store (Zustand)                                         */
/*                                                                     */
/*  Single source of truth for cross-cutting app state that needs to   */
/*  be observable from both React components AND module-level services */
/*  (WS managers, foreground service, background tasks).               */
/*                                                                     */
/*  Rules:                                                             */
/*   - DO NOT put non-serializable values here (sockets, timers,       */
/*     native handles). Those stay in their owning singleton; the      */
/*     singleton only mirrors STATUS into this store.                  */
/*   - Components read with selectors:                                 */
/*       const status = useAppStore(s => s.notifWs.status);            */
/*   - Services read/write outside React:                              */
/*       useAppStore.getState().setNotifWsStatus('connected');         */
/* ------------------------------------------------------------------ */

import { create } from 'zustand';
import { persist, createJSONStorage, PersistOptions } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../types';

/* Lazily dismiss the grouped OS notification for a room without coupling the
   store to the notifications module at load time (avoids heavy/circular deps). */
function dismissRoomNotificationSafe(roomId: string): void {
  import('../services/pushNotificationService')
    .then((m) => m.dismissRoomNotification(roomId))
    .catch(() => {});
}

/* ---- Connection status (mirrors notificationWsManager.ConnectionStatus
        and chatWsManager.RoomStatus, kept as a string union to avoid a
        circular import) ---- */
export type WsStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'no-internet';

export type AppLifecycle = 'active' | 'background' | 'inactive' | 'unknown';
export type NetStatus = 'online' | 'offline' | 'unknown';

export interface ActiveCall {
  callId: string;
  peerId: number;
  peerName: string;
  state: 'ringing' | 'connecting' | 'connected' | 'ended';
  callType: 'voice' | 'video';
}

/**
 * Distinct from `activeCall` — represents a *second* incoming call that
 * arrives while another call is already in progress. Surfaced in-app via the
 * IncomingCallBanner instead of the full-screen IncomingCallScreen.
 */
export interface IncomingCallPrompt {
  callId: string;
  callerId: number;
  callerName: string;
  callType: 'voice' | 'video';
  roomName: string;
}

export interface NotifWsState {
  status: WsStatus;
  authenticated: boolean;
  /** UNIX ms — when the connection last transitioned to 'connected' */
  connectedAt: number;
  /** UNIX ms — last time we received any inbound WS frame */
  lastInboundAt: number;
  /** Last close code observed (e.g. 1011) */
  lastCloseCode: number | null;
  /** UNIX ms until which reconnect attempts are suspended (1011 breaker) */
  suspendedUntil: number;
}

export interface ChatRoomWsState {
  status: WsStatus;
  authenticated: boolean;
}

export interface AppState {
  /* --- Auth --- */
  user: User | null;
  authLoading: boolean;

  /* --- Connectivity --- */
  net: NetStatus;
  notifWs: NotifWsState;
  /** Per-room chat WS status, keyed by roomId */
  chatRooms: Record<string, ChatRoomWsState>;

  /* --- App lifecycle --- */
  appLifecycle: AppLifecycle;
  foregroundServiceRunning: boolean;

  /* --- Chat context --- */
  /** The chat room the user is currently viewing (null if none) */
  activeRoomId: string | null;
  /** Unread message counts per room (for badges) */
  unreadByRoom: Record<string, number>;
  /** Last message preview per room (persisted — powers the chat list on cold start).
   *  `status` is only meaningful for outgoing messages (`sender_id === current user`):
   *  'pending' = queued/not yet acked by server, 'delivered' = server/peer received it,
   *  'read' = at least one recipient marked it read. */
  lastMessageByRoom: Record<
    string,
    {
      id?: string;
      content: string;
      created_at: string;
      sender?: string;
      sender_id?: number;
      status?: 'pending' | 'delivered' | 'read';
    }
  >;
  /** Active typers per room: roomId → array of { userId, username, expiresAt (ms) } */
  typingByRoom: Record<string, Array<{ userId: number; username: string; expiresAt: number }>>;
  /** Set of room IDs the user has muted (no local notif, no badge contribution) */
  mutedRooms: Record<string, true>;
  /** Map of user IDs the current user has added as contacts (acceptance set).
   *  Senders NOT in this map are treated as message-request senders. */
  contactIds: Record<number, true>;
  /** Map of user IDs the current user has blocked. */
  blockedIds: Record<number, true>;
  /** Monotonic counter bumped on any local mutation (used for UI refresh hints) */
  lastMutationAt: number;

  /* --- Calls --- */
  activeCall: ActiveCall | null;
  /** Secondary incoming-call prompt shown while `activeCall` is in progress. */
  incomingCall: IncomingCallPrompt | null;

  /* ============================================================
   * Actions — called by services (outside React) and components.
   * Keep actions thin; no async work here.
   * ============================================================ */

  // Auth
  setUser: (user: User | null) => void;
  setAuthLoading: (loading: boolean) => void;

  // Net
  setNet: (net: NetStatus) => void;

  // Notification WS
  setNotifWsStatus: (status: WsStatus) => void;
  setNotifWsAuthenticated: (authenticated: boolean) => void;
  setNotifWsInboundAt: (at?: number) => void;
  setNotifWsClose: (code: number | null) => void;
  setNotifWsSuspendedUntil: (until: number) => void;

  // Chat room WS
  setChatRoomStatus: (roomId: string, status: WsStatus) => void;
  setChatRoomAuthenticated: (roomId: string, authenticated: boolean) => void;
  removeChatRoom: (roomId: string) => void;

  // App lifecycle
  setAppLifecycle: (lifecycle: AppLifecycle) => void;
  setForegroundServiceRunning: (running: boolean) => void;

  // Chat context
  setActiveRoom: (roomId: string | null) => void;
  setRoomUnread: (roomId: string, count: number) => void;
  incrementRoomUnread: (roomId: string, by?: number) => void;
  clearRoomUnread: (roomId: string) => void;
  clearAllUnread: () => void;
  setRoomLastMessage: (
    roomId: string,
    msg: {
      id?: string;
      content: string;
      created_at: string;
      sender?: string;
      sender_id?: number;
      status?: 'pending' | 'delivered' | 'read';
    },
  ) => void;
  /** Bump the status of the room's last outgoing message if its id matches.
   *  No-op when the last message has changed (e.g. peer replied in the meantime). */
  setRoomLastMessageStatus: (
    roomId: string,
    messageId: string,
    status: 'pending' | 'delivered' | 'read',
  ) => void;
  setRoomTyping: (
    roomId: string,
    userId: number,
    username: string,
    isTyping: boolean,
  ) => void;
  pruneExpiredTyping: () => void;
  setRoomMuted: (roomId: string, muted: boolean) => void;
  toggleRoomMuted: (roomId: string) => void;
  /** Wipe per-room derived state (unread / last-message / typing / mute).
   *  Used when the user deletes a chat from the chat list. */
  clearRoomState: (roomId: string) => void;

  // Contact / blocked sets
  setContactIds: (ids: number[]) => void;
  addContactId: (id: number) => void;
  removeContactId: (id: number) => void;
  setBlockedIds: (ids: number[]) => void;
  addBlockedId: (id: number) => void;
  removeBlockedId: (id: number) => void;

  bumpMutation: () => void;

  // Calls
  setActiveCall: (call: ActiveCall | null) => void;
  updateActiveCallState: (state: ActiveCall['state']) => void;
  setIncomingCall: (prompt: IncomingCallPrompt | null) => void;

  /** Hard reset (used on logout) */
  reset: () => void;
}

const initialNotifWs: NotifWsState = {
  status: 'disconnected',
  authenticated: false,
  connectedAt: 0,
  lastInboundAt: 0,
  lastCloseCode: null,
  suspendedUntil: 0,
};

const initialState = {
  user: null as User | null,
  authLoading: true,
  net: 'unknown' as NetStatus,
  notifWs: initialNotifWs,
  chatRooms: {} as Record<string, ChatRoomWsState>,
  appLifecycle: 'unknown' as AppLifecycle,
  foregroundServiceRunning: false,
  activeRoomId: null as string | null,
  unreadByRoom: {} as Record<string, number>,
  lastMessageByRoom: {} as Record<
    string,
    {
      id?: string;
      content: string;
      created_at: string;
      sender?: string;
      sender_id?: number;
      status?: 'pending' | 'delivered' | 'read';
    }
  >,
  typingByRoom: {} as Record<string, Array<{ userId: number; username: string; expiresAt: number }>>,
  mutedRooms: {} as Record<string, true>,
  contactIds: {} as Record<number, true>,
  blockedIds: {} as Record<number, true>,
  lastMutationAt: 0,
  activeCall: null as ActiveCall | null,
  incomingCall: null as IncomingCallPrompt | null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
  ...initialState,

  /* --- Auth --- */
  setUser: (user) => set({ user }),
  setAuthLoading: (authLoading) => set({ authLoading }),

  /* --- Net --- */
  setNet: (net) => set({ net }),

  /* --- Notification WS --- */
  setNotifWsStatus: (status) =>
    set((s) => ({
      notifWs: {
        ...s.notifWs,
        status,
        connectedAt: status === 'connected' ? Date.now() : s.notifWs.connectedAt,
      },
    })),
  setNotifWsAuthenticated: (authenticated) =>
    set((s) => ({ notifWs: { ...s.notifWs, authenticated } })),
  setNotifWsInboundAt: (at) =>
    set((s) => ({ notifWs: { ...s.notifWs, lastInboundAt: at ?? Date.now() } })),
  setNotifWsClose: (code) =>
    set((s) => ({ notifWs: { ...s.notifWs, lastCloseCode: code, authenticated: false } })),
  setNotifWsSuspendedUntil: (until) =>
    set((s) => ({ notifWs: { ...s.notifWs, suspendedUntil: until } })),

  /* --- Chat room WS --- */
  setChatRoomStatus: (roomId, status) =>
    set((s) => ({
      chatRooms: {
        ...s.chatRooms,
        [roomId]: {
          status,
          authenticated: s.chatRooms[roomId]?.authenticated ?? false,
        },
      },
    })),
  setChatRoomAuthenticated: (roomId, authenticated) =>
    set((s) => ({
      chatRooms: {
        ...s.chatRooms,
        [roomId]: {
          status: s.chatRooms[roomId]?.status ?? 'disconnected',
          authenticated,
        },
      },
    })),
  removeChatRoom: (roomId) =>
    set((s) => {
      if (!(roomId in s.chatRooms)) return s;
      const next = { ...s.chatRooms };
      delete next[roomId];
      return { chatRooms: next };
    }),

  /* --- App lifecycle --- */
  setAppLifecycle: (appLifecycle) => set({ appLifecycle }),
  setForegroundServiceRunning: (foregroundServiceRunning) =>
    set({ foregroundServiceRunning }),

  /* --- Chat context --- */
  setActiveRoom: (activeRoomId) => {
    set({ activeRoomId });
    // Entering a room clears its unread badge.
    if (activeRoomId) get().clearRoomUnread(activeRoomId);
  },
  setRoomUnread: (roomId, count) =>
    set((s) => ({ unreadByRoom: { ...s.unreadByRoom, [roomId]: count } })),
  incrementRoomUnread: (roomId, by = 1) =>
    set((s) => ({
      unreadByRoom: {
        ...s.unreadByRoom,
        [roomId]: (s.unreadByRoom[roomId] ?? 0) + by,
      },
    })),
  clearRoomUnread: (roomId) =>
    set((s) => {
      // Also clear the grouped OS notification for this conversation.
      dismissRoomNotificationSafe(roomId);
      if (!(roomId in s.unreadByRoom)) return s;
      const next = { ...s.unreadByRoom };
      delete next[roomId];
      return { unreadByRoom: next };
    }),
  clearAllUnread: () =>
    set((s) => {
      Object.keys(s.unreadByRoom).forEach(dismissRoomNotificationSafe);
      return { unreadByRoom: {} };
    }),
  setRoomLastMessage: (roomId, msg) =>
    set((s) => {
      const prev = s.lastMessageByRoom[roomId];
      // Skip update if the incoming message is older than what we already have
      if (prev && new Date(prev.created_at) >= new Date(msg.created_at)) return s;
      return {
        lastMessageByRoom: { ...s.lastMessageByRoom, [roomId]: msg },
      };
    }),
  setRoomLastMessageStatus: (roomId, messageId, status) =>
    set((s) => {
      const prev = s.lastMessageByRoom[roomId];
      if (!prev || prev.id !== messageId) return s;
      // Never downgrade: pending → sent → read
      const order = { pending: 0, delivered: 1, read: 2 } as const;
      if (prev.status && order[prev.status] >= order[status]) return s;
      return {
        lastMessageByRoom: {
          ...s.lastMessageByRoom,
          [roomId]: { ...prev, status },
        },
      };
    }),
  setRoomTyping: (roomId, userId, username, isTyping) =>
    set((s) => {
      const current = s.typingByRoom[roomId] ?? [];
      const others = current.filter((t) => t.userId !== userId);
      if (isTyping) {
        // 5-second TTL — the sender re-pings or we auto-expire
        others.push({ userId, username, expiresAt: Date.now() + 5000 });
      }
      if (others.length === 0) {
        if (!(roomId in s.typingByRoom)) return s;
        const next = { ...s.typingByRoom };
        delete next[roomId];
        return { typingByRoom: next };
      }
      return { typingByRoom: { ...s.typingByRoom, [roomId]: others } };
    }),
  pruneExpiredTyping: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const next: typeof s.typingByRoom = {};
      for (const [rid, list] of Object.entries(s.typingByRoom)) {
        const kept = list.filter((t) => t.expiresAt > now);
        if (kept.length !== list.length) changed = true;
        if (kept.length > 0) next[rid] = kept;
        else if (rid in s.typingByRoom) changed = true;
      }
      return changed ? { typingByRoom: next } : s;
    }),
  setRoomMuted: (roomId, muted) =>
    set((s) => {
      const isMuted = !!s.mutedRooms[roomId];
      if (isMuted === muted) return s;
      const next = { ...s.mutedRooms };
      if (muted) next[roomId] = true;
      else delete next[roomId];
      return { mutedRooms: next };
    }),
  toggleRoomMuted: (roomId) =>
    set((s) => {
      const next = { ...s.mutedRooms };
      if (next[roomId]) delete next[roomId];
      else next[roomId] = true;
      return { mutedRooms: next };
    }),

  clearRoomState: (roomId) =>
    set((s) => {
      const nextUnread = { ...s.unreadByRoom };       delete nextUnread[roomId];
      const nextLast   = { ...s.lastMessageByRoom };  delete nextLast[roomId];
      const nextTyping = { ...s.typingByRoom };       delete nextTyping[roomId];
      const nextMuted  = { ...s.mutedRooms };         delete nextMuted[roomId];
      const nextChat   = { ...s.chatRooms };          delete nextChat[roomId];
      return {
        unreadByRoom:      nextUnread,
        lastMessageByRoom: nextLast,
        typingByRoom:      nextTyping,
        mutedRooms:        nextMuted,
        chatRooms:         nextChat,
      };
    }),

  /* --- Contact / blocked sets --- */
  setContactIds: (ids) =>
    set(() => {
      const next: Record<number, true> = {};
      for (const id of ids) next[id] = true;
      return { contactIds: next };
    }),
  addContactId: (id) =>
    set((s) => (s.contactIds[id] ? s : { contactIds: { ...s.contactIds, [id]: true } })),
  removeContactId: (id) =>
    set((s) => {
      if (!s.contactIds[id]) return s;
      const next = { ...s.contactIds };
      delete next[id];
      return { contactIds: next };
    }),
  setBlockedIds: (ids) =>
    set(() => {
      const next: Record<number, true> = {};
      for (const id of ids) next[id] = true;
      return { blockedIds: next };
    }),
  addBlockedId: (id) =>
    set((s) => (s.blockedIds[id] ? s : { blockedIds: { ...s.blockedIds, [id]: true } })),
  removeBlockedId: (id) =>
    set((s) => {
      if (!s.blockedIds[id]) return s;
      const next = { ...s.blockedIds };
      delete next[id];
      return { blockedIds: next };
    }),

  bumpMutation: () => set({ lastMutationAt: Date.now() }),

  /* --- Calls --- */
  setActiveCall: (activeCall) => set({ activeCall }),
  updateActiveCallState: (state) =>
    set((s) =>
      s.activeCall ? { activeCall: { ...s.activeCall, state } } : s,
    ),
  setIncomingCall: (incomingCall) => set({ incomingCall }),

  /* --- Reset --- */
  reset: () => set({ ...initialState }),
    }),
    {
      name: 'axonic-app-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist serializable, durable data. Connection statuses, app lifecycle
      // and active room are recomputed on every launch.
      partialize: (s) => ({
        unreadByRoom: s.unreadByRoom,
        lastMessageByRoom: s.lastMessageByRoom,
        mutedRooms: s.mutedRooms,
        contactIds: s.contactIds,
        blockedIds: s.blockedIds,
      }) as Partial<AppState>,
      version: 1,
    } as PersistOptions<AppState, Pick<AppState, 'unreadByRoom' | 'lastMessageByRoom' | 'mutedRooms' | 'contactIds' | 'blockedIds'>>,
  ),
);

/* ------------------------------------------------------------------ */
/*  Convenience selectors (stable references)                          */
/*  Usage: const isOnline = useAppStore(selectIsOnline);               */
/* ------------------------------------------------------------------ */

export const selectIsAuthenticated = (s: AppState) => s.user !== null;
export const selectIsOnline = (s: AppState) => s.net === 'online';
export const selectNotifWsStatus = (s: AppState) => s.notifWs.status;
const NOTIF_WS_STALE_MS = 35_000;
const NOTIF_WS_CONNECT_GRACE_MS = 12_000;
export const selectNotifWsConnected = (s: AppState) =>
  s.notifWs.status === 'connected' &&
  s.notifWs.authenticated &&
  (() => {
    const now = Date.now();
    const inboundFresh = s.notifWs.lastInboundAt > 0 && (now - s.notifWs.lastInboundAt) <= NOTIF_WS_STALE_MS;
    const connectGrace = s.notifWs.connectedAt > 0 && (now - s.notifWs.connectedAt) <= NOTIF_WS_CONNECT_GRACE_MS;
    return inboundFresh || connectGrace;
  })();
export const selectActiveRoomId = (s: AppState) => s.activeRoomId;
export const selectTotalUnread = (s: AppState) =>
  Object.entries(s.unreadByRoom).reduce(
    (a, [rid, c]) => a + (s.mutedRooms[rid] ? 0 : c),
    0,
  );
