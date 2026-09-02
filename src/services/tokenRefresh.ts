import { fetch } from 'expo/fetch';
import { APP_CONFIG } from '../config/appConfig';
import { clearTokens, getTokens, saveTokens, type TokenPair } from './authTokens';
import { getJwtExpiryMs, tokenNeedsRefresh } from './authTokenPolicy';
import { invalidateSession } from './sessionInvalidation';

const REFRESH_URL = `${APP_CONFIG.SERVER_URL}/api/users/token/refresh/`;
const DEFAULT_REFRESH_MARGIN_MS = 30_000;

let refreshPromise: Promise<TokenPair> | null = null;

function isExplicitRejection(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

async function performRefresh(): Promise<TokenPair> {
  const current = await getTokens();
  if (!current?.refresh) throw new Error('No refresh token');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_500);
  try {
    const response = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: current.refresh }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`Token refresh failed (${response.status})`) as Error & { status?: number };
      error.status = response.status;
      if (isExplicitRejection(response.status)) {
        await clearTokens();
        invalidateSession('refresh_rejected');
      }
      throw error;
    }

    const data = await response.json() as { access?: string; refresh?: string };
    if (!data.access) throw new Error('Token refresh response did not include an access token');
    const next = { access: data.access, refresh: data.refresh ?? current.refresh };
    await saveTokens(next.access, next.refresh);
    return next;
  } finally {
    clearTimeout(timeout);
  }
}

export function refreshAccessToken(): Promise<TokenPair> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function getValidAccessToken(
  minValidityMs = DEFAULT_REFRESH_MARGIN_MS,
): Promise<string | null> {
  const current = await getTokens();
  if (!current?.access) return null;
  if (!tokenNeedsRefresh(current.access, minValidityMs)) return current.access;

  try {
    return (await refreshAccessToken()).access;
  } catch (error) {
    const status = (error as { status?: number })?.status;
    const expiresAt = getJwtExpiryMs(current.access);
    // A transient refresh failure should not disconnect an otherwise valid
    // session. The request/connection can still use the access token until it
    // actually expires.
    if (!status && expiresAt !== null && expiresAt > Date.now()) return current.access;
    throw error;
  }
}
