/* ------------------------------------------------------------------ */
/*  App version check                                                   */
/*                                                                      */
/*  Uses Google Play as the Android update source of truth. The backend */
/*  remains a minimum-supported-version policy and a compatibility       */
/*  fallback for older native builds and iOS.                            */
/* ------------------------------------------------------------------ */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { getPlayUpdateInfoAsync } from '../../modules/axonic-app-update';
import { BASE_URL } from './api';
import {
  compareVersions,
  isValidVersion,
  resolveUpdateStatus,
  type UpdateStatus,
} from './versionPolicy';

export { compareVersions } from './versionPolicy';

export interface VersionCheckResult {
  status: UpdateStatus;
  /** Version currently installed. */
  current: string;
  /** Newest published version reported by the backend. */
  latest: string;
  /** Stable identifier used for the per-update reminder cooldown. */
  updateId: string;
  /** Store link to open for the update. */
  storeUrl: string;
}

const REQUEST_TIMEOUT_MS = 6_000;
const REQUEST_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;
const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.axonic';

function getInstalledVersion(): string {
  const nativeVersion = Application.nativeApplicationVersion?.trim();
  if (nativeVersion && isValidVersion(nativeVersion)) return nativeVersion;

  const configuredVersion = Constants.expoConfig?.version?.trim();
  return configuredVersion && isValidVersion(configuredVersion) ? configuredVersion : '0.0.0';
}

function isValidStoreUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function requestVersionPolicy(platform: 'android' | 'ios'): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}/api/app/version/?platform=${platform}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Version check returned HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < REQUEST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

/**
 * Ask the backend whether an update is available. Never throws — on any error
 * (offline, endpoint unavailable) it resolves to `status: 'ok'` so the app is
 * never blocked by a failed check.
 */
export async function checkAppVersion(): Promise<VersionCheckResult> {
  const current = getInstalledVersion();
  const fallback: VersionCheckResult = {
    status: 'ok',
    current,
    latest: current,
    updateId: current,
    storeUrl: '',
  };
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const [policyResult, playResult] = await Promise.allSettled([
    requestVersionPolicy(platform),
    platform === 'android' ? getPlayUpdateInfoAsync() : Promise.resolve(null),
  ]);

  const data = policyResult.status === 'fulfilled'
    ? policyResult.value as Record<string, unknown>
    : {};
  const latest = isValidVersion(data.latest) ? data.latest.trim() : current;
  const minSupported = isValidVersion(data.min_supported)
    ? data.min_supported.trim()
    : '0.0.0';
  const storeUrl = isValidStoreUrl(data.store_url)
    ? data.store_url
    : platform === 'android' ? ANDROID_STORE_URL : '';

  if (platform === 'android' && playResult.status === 'fulfilled' && playResult.value) {
    const playInfo = playResult.value;
    const available = playInfo.availability === 'available'
      || playInfo.availability === 'in_progress';
    const forced = available && compareVersions(current, minSupported) < 0;
    const status: UpdateStatus = forced ? 'forced' : available ? 'optional' : 'ok';
    const buildCode = playInfo.availableVersionCode;
    return {
      status: storeUrl ? status : 'ok',
      current,
      latest,
      updateId: buildCode ? `android-build-${buildCode}` : `android-${latest}`,
      storeUrl,
    };
  }

  // Older/sideloaded builds may not contain the native Play module. Keep the
  // backend comparison as a safe compatibility fallback for those clients and iOS.
  if (policyResult.status === 'fulfilled') {
    const status = storeUrl
      ? resolveUpdateStatus(current, latest, minSupported)
      : 'ok';
    return { status, current, latest, updateId: latest, storeUrl };
  }

  if (__DEV__) {
    console.warn('[VersionCheck] Unable to check for an update', policyResult.reason);
  }
  return fallback;
}
