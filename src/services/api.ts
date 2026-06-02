/* ------------------------------------------------------------------ */
/*  Axios instance with JWT interceptor                                */
/* ------------------------------------------------------------------ */

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_CONFIG } from '../config/appConfig';

const TOKEN_KEY = '@axonic_tokens';

export const BASE_URL = APP_CONFIG.SERVER_URL;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ---- Token helpers ----
export async function getTokens() {
  const raw = await AsyncStorage.getItem(TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveTokens(access: string, refresh: string) {
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({ access, refresh }));
}

export async function clearTokens() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

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
  const tokens = await getTokens();
  if (tokens?.access) {
    config.headers.Authorization = `Bearer ${tokens.access}`;
  }
  return config;
});

// ---- Response interceptor — refresh on 401 ----
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

function processQueue(error: any, token: string | null = null) {
  failedQueue.forEach((p) => {
    if (error) p.reject(error);
    else p.resolve(token);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const tokens = await getTokens();
        if (!tokens?.refresh) throw new Error('No refresh token');

        const { data } = await axios.post(`${BASE_URL}/api/users/token/refresh/`, {
          refresh: tokens.refresh,
        });

        await saveTokens(data.access, data.refresh ?? tokens.refresh);
        processQueue(null, data.access);

        original.headers.Authorization = `Bearer ${data.access}`;
        return api(original);
      } catch (err) {
        processQueue(err, null);
        await clearTokens();
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
