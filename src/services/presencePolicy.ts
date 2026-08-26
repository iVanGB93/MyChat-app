export type PresenceStatus = 'active' | 'background' | 'offline' | 'unknown';

export interface PresenceLease {
  isOnline: boolean;
  status: PresenceStatus;
  lastSeen: string | null;
  observedAt: number;
  expiresAt: number;
}

export interface PresenceWireValue {
  user_id?: number | string;
  is_online?: boolean;
  presence?: PresenceStatus | 'connected' | 'stale';
  last_seen?: string | null;
  expires_in?: number;
}

const DEFAULT_LEASE_SECONDS = 70;
const LEASE_GRACE_MS = 15_000;

function normalizeStatus(value: PresenceWireValue): PresenceStatus {
  if (value.is_online || value.presence === 'active') return 'active';
  if (value.presence === 'background' || value.presence === 'connected') return 'background';
  if (value.presence === 'offline') return 'offline';
  return 'unknown';
}

export function toPresenceLease(value: PresenceWireValue, observedAt = Date.now()): PresenceLease {
  const status = normalizeStatus(value);
  const liveLease = status === 'active' || status === 'background';
  const leaseSeconds = Math.max(10, Number(value.expires_in) || DEFAULT_LEASE_SECONDS);
  return {
    isOnline: status === 'active',
    status,
    lastSeen: value.last_seen ?? null,
    observedAt,
    expiresAt: liveLease ? observedAt + leaseSeconds * 1000 + LEASE_GRACE_MS : 0,
  };
}

export function expirePresenceLease(presence: PresenceLease, at = Date.now()): PresenceLease {
  if (
    presence.expiresAt <= 0 ||
    presence.expiresAt > at ||
    (!presence.isOnline && presence.status !== 'background')
  ) return presence;
  return { ...presence, isOnline: false, status: 'offline', observedAt: at, expiresAt: 0 };
}

export const PRESENCE_DEFAULT_LEASE_SECONDS = DEFAULT_LEASE_SECONDS;
