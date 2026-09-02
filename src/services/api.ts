/* ------------------------------------------------------------------ */
/*  Axios instance with JWT interceptor                                */
/* ------------------------------------------------------------------ */

import axios from 'axios';
import { APP_CONFIG } from '../config/appConfig';
import { getValidAccessToken, refreshAccessToken } from './tokenRefresh';

export { clearTokens, getTokens, saveTokens } from './authTokens';

export const BASE_URL = APP_CONFIG.SERVER_URL;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Resolve a relative media URL (e.g. "/media/avatars/foo.jpg" or
 * "media/avatars/foo.jpg") returned by the Django backend into a full
 * absolute URL the React Native Image component can load.
 *
 * Returns null/undefined unchanged, and full URLs (http(s)://...)
 * unchanged.
 */
export function resolveMediaUrl(uri?: string | null): string | null {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri;
  // Add a leading slash if missing so we don't double-up
  const path = uri.startsWith('/') ? uri : `/${uri}`;
  return `${BASE_URL}${path}`;
}

// ---- Request interceptor — attach access token ----
api.interceptors.request.use(async (config) => {
  const access = await getValidAccessToken();
  if (access) {
    config.headers.Authorization = `Bearer ${access}`;
  }
  return config;
});

// Endpoints that never had an authenticated session to refresh — a 401/400
// here means bad credentials or an invalid code, not an expired token, so
// the refresh-and-retry flow must not run for them.
const NO_REFRESH_RETRY_PATHS = [
  '/api/users/token/',
  '/api/users/token/refresh/',
  '/api/users/register/',
  '/api/users/password/reset/',
];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const url: string = original?.url ?? '';
    const isAuthEndpoint = NO_REFRESH_RETRY_PATHS.some((p) => url.includes(p));

    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;

      try {
        const tokens = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${tokens.access}`;
        return api(original);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
