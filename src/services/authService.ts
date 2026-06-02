/* ------------------------------------------------------------------ */
/*  Auth API — register, login, profile                                */
/* ------------------------------------------------------------------ */

import api, { saveTokens } from './api';
import type { TokenPair, User } from '../types';

export async function register(username: string, email: string, password: string) {
  const { data } = await api.post<User>('/api/users/register/', { username, email, password });
  return data;
}

export async function login(username: string, password: string): Promise<TokenPair> {
  const { data } = await api.post<TokenPair>('/api/users/token/', { username, password });
  await saveTokens(data.access, data.refresh);
  return data;
}

export async function getProfile(): Promise<User> {
  const { data } = await api.get<User>('/api/users/profile/');
  return data;
}

export async function updateProfile(fields: Partial<User>): Promise<User> {
  const { data } = await api.patch<User>('/api/users/profile/', fields);
  return data;
}

/**
 * Upload a new avatar image. `localUri` is a file URI from
 * expo-image-picker. `mimeType` defaults to image/jpeg.
 */
export async function uploadAvatar(localUri: string, mimeType: string = 'image/jpeg'): Promise<User> {
  // Derive a sensible filename from the URI.
  const guessedExt = (mimeType.split('/')[1] || 'jpg').toLowerCase();
  const filename = localUri.split('/').pop() || `avatar.${guessedExt}`;

  const form = new FormData();
  // React Native's FormData accepts the `{ uri, name, type }` object shape.
  form.append('avatar', {
    uri: localUri,
    name: filename,
    type: mimeType,
  } as any);

  const { data } = await api.patch<User>('/api/users/profile/', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (d) => d,
  });
  return data;
}

/**
 * Change the user's password. Backend issues a fresh token pair (the
 * password change bumps `token_version`, invalidating the current
 * token) — we persist those so the caller stays logged in.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data } = await api.post<{ status: string; access: string; refresh: string }>(
    '/api/users/profile/change-password/',
    { current_password: currentPassword, new_password: newPassword },
  );
  if (data?.access && data?.refresh) {
    await saveTokens(data.access, data.refresh);
  }
}

/**
 * Permanently delete the authenticated user's account. Requires the
 * current password as a confirmation step.
 */
export async function deleteAccount(password: string): Promise<void> {
  await api.delete('/api/users/profile/delete/', { data: { password } });
}

/**
 * Invalidate every JWT previously issued for this account (every other
 * device + this one). The caller should clear local tokens immediately
 * after — the in-flight token is no longer valid.
 */
export async function logoutAllSessions(): Promise<void> {
  await api.post('/api/users/profile/logout-all/', {});
}

export async function searchUsers(query: string): Promise<User[]> {
  const { data } = await api.get<{ results: User[] } | User[]>('/api/users/search/', { params: { q: query } });
  // Backend uses PageNumberPagination → response is { count, results: [...] }
  if (Array.isArray(data)) return data;
  return (data as { results: User[] }).results ?? [];
}

/**
 * Register the device's Expo push token with the backend.
 * Should be called after every login/register and when the token refreshes.
 */
export async function registerPushToken(token: string): Promise<void> {
  try {
    await api.post('/api/users/push-token/', { token });
    console.log('[Auth] Push token registered with backend');
  } catch (err) {
    console.warn('[Auth] Failed to register push token:', err);
  }
}
