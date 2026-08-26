/* ------------------------------------------------------------------ */
/*  Auth API — register, login, profile                                */
/* ------------------------------------------------------------------ */

import api, { saveTokens } from './api';
import { getInstallationId } from './installationIdentity';
import type { PushRegistrationPayload } from './pushNotificationService';
import type { TokenPair, User } from '../types';
import { seedPresenceFromUsers } from './presenceService';

export async function register(
  username: string,
  email: string,
  password: string,
  displayName?: string,
) {
  const payload: Record<string, string> = { username, email, password };
  const trimmed = (displayName ?? '').trim();
  if (trimmed) payload.display_name = trimmed;
  const { data } = await api.post<User>('/api/users/register/', payload);
  return data;
}

/* ------------------------------------------------------------------ */
/*  Email-verification registration flow                                */
/* ------------------------------------------------------------------ */

export interface RegistrationRequestResult {
  email: string;
  expires_in: number;
}

export interface RegistrationVerifyResult {
  user: User;
  access: string;
  refresh: string;
}

/** Step 1: validate inputs and have the server email a 6-digit code. */
export async function requestRegistration(
  username: string,
  email: string,
  password: string,
  displayName?: string,
): Promise<RegistrationRequestResult> {
  const payload: Record<string, string> = { username, email, password };
  const trimmed = (displayName ?? '').trim();
  if (trimmed) payload.display_name = trimmed;
  const { data } = await api.post<RegistrationRequestResult>(
    '/api/users/register/request/',
    payload,
  );
  return data;
}

/** Step 1.5: ask the server to email a fresh code (cooldown enforced). */
export async function resendRegistrationCode(
  email: string,
): Promise<RegistrationRequestResult> {
  const { data } = await api.post<RegistrationRequestResult>(
    '/api/users/register/resend/',
    { email },
  );
  return data;
}

/**
 * Step 2: confirm the 6-digit code. On success the server creates the
 * User and returns a fresh access/refresh pair so we can sign in
 * immediately without a follow-up password round-trip.
 */
export async function verifyRegistration(
  email: string,
  code: string,
): Promise<RegistrationVerifyResult> {
  const { data } = await api.post<RegistrationVerifyResult>(
    '/api/users/register/verify/',
    { email, code },
  );
  await saveTokens(data.access, data.refresh);
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

export interface PasswordResetRequestResult {
  email: string;
  expires_in: number;
}

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const { data } = await api.post<PasswordResetRequestResult>(
    '/api/users/password/reset/request/',
    { email },
  );
  return data;
}

export async function resendPasswordResetCode(email: string): Promise<PasswordResetRequestResult> {
  const { data } = await api.post<PasswordResetRequestResult>(
    '/api/users/password/reset/resend/',
    { email },
  );
  return data;
}

export interface PasswordResetVerifyResult {
  email: string;
  status: string;
}

export async function verifyPasswordReset(email: string, code: string): Promise<PasswordResetVerifyResult> {
  const { data } = await api.post<PasswordResetVerifyResult>(
    '/api/users/password/reset/verify/',
    { email, code },
  );
  return data;
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  await api.post('/api/users/password/reset/confirm/', {
    email,
    code,
    new_password: newPassword,
  });
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
  const users = Array.isArray(data) ? data : ((data as { results: User[] }).results ?? []);
  seedPresenceFromUsers(users);
  return users;
}

/**
 * Register the device's Expo push token with the backend.
 * Should be called after every login/register and when the token refreshes.
 */
export async function registerPushToken(payload: PushRegistrationPayload): Promise<void> {
  try {
    await api.post('/api/users/push-token/', payload);
    console.log('[Auth] Push token registered with backend');
  } catch (err) {
    console.warn('[Auth] Failed to register push token:', err);
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    const installation_id = await getInstallationId();
    await api.post('/api/users/push-token/unregister/', { installation_id });
    console.log('[Auth] Push token unregistered from backend');
  } catch (err) {
    console.warn('[Auth] Failed to unregister push token:', err);
  }
}
