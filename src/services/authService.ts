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
