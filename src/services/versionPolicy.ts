export type UpdateStatus = 'ok' | 'optional' | 'forced';

export const UPDATE_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateDismissal {
  version: string;
  dismissedAt: number;
}

export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+)*$/.test(value.trim());
}

/** Compare dotted numeric versions. Returns -1, 0, or 1 (a vs b). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function resolveUpdateStatus(
  current: string,
  latest: string,
  minSupported: string,
): UpdateStatus {
  if (compareVersions(current, minSupported) < 0) return 'forced';
  if (compareVersions(current, latest) < 0) return 'optional';
  return 'ok';
}

export function serializeUpdateDismissal(version: string, dismissedAt = Date.now()): string {
  return JSON.stringify({ version, dismissedAt } satisfies UpdateDismissal);
}

export function shouldShowOptionalUpdate(
  latest: string,
  storedDismissal: string | null,
  now = Date.now(),
): boolean {
  if (!storedDismissal) return true;

  try {
    const parsed = JSON.parse(storedDismissal) as Partial<UpdateDismissal>;
    if (parsed.version !== latest || typeof parsed.dismissedAt !== 'number') return true;
    return now - parsed.dismissedAt >= UPDATE_REMINDER_INTERVAL_MS;
  } catch {
    // Older builds stored only the dismissed version, without a timestamp.
    // Show it again so a legacy dismissal cannot suppress an update forever.
    return true;
  }
}
