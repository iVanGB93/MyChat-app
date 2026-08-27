import { useAppStore, type UserPresenceState } from '../store/appStore';
import type { RoomMember, User } from '../types';
import {
  PRESENCE_DEFAULT_LEASE_SECONDS,
  toPresenceLease,
  type PresenceWireValue,
} from './presencePolicy';

// HTTP room/contact refreshes can overlap. Keep one desired subscription set
// and send only the delta for the current Axion session instead of requesting
// the same full presence snapshot after every response.
const desiredPresenceUserIds = new Set<number>();
const subscribedThisSession = new Set<number>();
let subscriptionFlushRunning = false;

async function flushPresenceSubscriptions(): Promise<void> {
  if (subscriptionFlushRunning) return;
  subscriptionFlushRunning = true;
  try {
    while (true) {
      const pending = [...desiredPresenceUserIds].filter((id) => !subscribedThisSession.has(id));
      if (!pending.length) return;
      const { sendRawNotif } = await import('./notificationWsManager');
      if (!sendRawNotif({ type: 'presence_subscribe', user_ids: pending })) return;
      pending.forEach((id) => subscribedThisSession.add(id));
    }
  } catch {
    // Authentication/reconnect will replay the desired set.
  } finally {
    subscriptionFlushRunning = false;
  }
}

/** A new Axion socket has no subscriptions; replay the deduplicated desired set. */
export function resetPresenceSessionSubscriptions(): void {
  subscribedThisSession.clear();
  void flushPresenceSubscriptions();
}

export function toPresenceState(value: PresenceWireValue): UserPresenceState {
  return toPresenceLease(value);
}

export function applyPresenceUpdate(value: PresenceWireValue): void {
  const userId = Number(value.user_id);
  if (!Number.isFinite(userId) || userId <= 0) return;
  useAppStore.getState().setUserPresence(userId, toPresenceState(value));
}

export function applyPresenceSnapshot(values: PresenceWireValue[]): void {
  const entries = values
    .map((value) => ({ userId: Number(value.user_id), presence: toPresenceState(value) }))
    .filter((entry) => Number.isFinite(entry.userId) && entry.userId > 0);
  useAppStore.getState().setPresenceSnapshot(entries);
}

/** Seed only from a fresh HTTP response—never from persisted room/contact caches. */
export function seedPresenceFromUsers(users: Array<Pick<User | RoomMember, 'id' | 'is_online'> & { last_seen?: string | null }>): void {
  const values = users.map((user) => ({
    user_id: user.id,
    is_online: user.is_online,
    presence: user.is_online ? 'active' as const : 'offline' as const,
    last_seen: user.last_seen ?? null,
    expires_in: PRESENCE_DEFAULT_LEASE_SECONDS,
  }));
  applyPresenceSnapshot(values);
  const userIds = [...new Set(users.map((user) => user.id).filter((id) => id > 0))];
  userIds.forEach((id) => desiredPresenceUserIds.add(id));
  if (userIds.length) void flushPresenceSubscriptions();
}

export function isUserOnline(userId: number | null | undefined): boolean {
  if (userId == null) return false;
  return useAppStore.getState().presenceByUserId[userId]?.isOnline ?? false;
}
