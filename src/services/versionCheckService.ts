/* ------------------------------------------------------------------ */
/*  App version check                                                   */
/*                                                                      */
/*  Polls the backend on launch to decide whether to suggest (optional) */
/*  or force (breaking change) an update. The backend owns the version  */
/*  policy (config.views.app_version_view), so we can gate old clients   */
/*  without shipping a new build.                                        */
/* ------------------------------------------------------------------ */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { BASE_URL } from './api';

export type UpdateStatus = 'ok' | 'optional' | 'forced';

export interface VersionCheckResult {
  status: UpdateStatus;
  /** Version currently installed. */
  current: string;
  /** Newest published version reported by the backend. */
  latest: string;
  /** Store link to open for the update. */
  storeUrl: string;
}

/** Compare two dotted version strings. Returns -1, 0 or 1 (a vs b). */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Ask the backend whether an update is available. Never throws — on any error
 * (offline, endpoint unavailable) it resolves to `status: 'ok'` so the app is
 * never blocked by a failed check.
 */
export async function checkAppVersion(): Promise<VersionCheckResult> {
  const current = Constants.expoConfig?.version ?? '0.0.0';
  const fallback: VersionCheckResult = { status: 'ok', current, latest: current, storeUrl: '' };
  try {
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const res = await fetch(`${BASE_URL}/api/app/version/?platform=${platform}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const latest = String(data.latest ?? current);
    const minSupported = String(data.min_supported ?? '0.0.0');
    const storeUrl = String(data.store_url ?? '');

    let status: UpdateStatus = 'ok';
    if (compareVersions(current, minSupported) < 0) {
      status = 'forced';
    } else if (compareVersions(current, latest) < 0) {
      status = 'optional';
    }
    return { status, current, latest, storeUrl };
  } catch {
    return fallback;
  }
}
