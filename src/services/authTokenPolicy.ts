const DEFAULT_REFRESH_MARGIN_MS = 30_000;

export function getJwtExpiryMs(token: string): number | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function tokenNeedsRefresh(
  accessToken: string,
  minValidityMs = DEFAULT_REFRESH_MARGIN_MS,
  now = Date.now(),
): boolean {
  const expiresAt = getJwtExpiryMs(accessToken);
  return expiresAt === null || expiresAt - now < minValidityMs;
}

